import { Codex, type ThreadEvent, type ThreadItem, type ThreadOptions } from '@openai/codex-sdk';
import type { AgentConfig, McpServerConfig } from '../agents/config.js';
import { buildCodexChildEnvironment, resolveApprovedProviderKey } from '../agents/environment-policy.js';
import { deriveCodexSandbox, deriveCodexNetworkAccess } from '../execution/codex-safety.js';
import { expandHome } from '../agents/file-watcher.js';
import type { ExecutionResult, ToolCallTrace } from '../execution/executor.js';
import { truncate } from '../execution/executor.js';
import type { Reporter } from '../execution/runner.js';
import { parseInteractionBlock } from '../interaction/parser.js';

type ExecuteCodexExtra = {
  abortController?: AbortController;
  /**
   * Path to the user's installed Codex executable. When set, Codex uses it
   * instead of the codex-sdk's bundled binary. Undefined keeps the default.
   */
  codexExecutablePath?: string;
  disableMcpServers?: boolean;
};

type CodexState = {
  threadId?: string;
  turnCount: number;
  lastMessage: string;
  toolsUsed: Set<string>;
  filesWritten: Set<string>;
  commandsRun: string[];
  toolCalls: ToolCallTrace[];
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
};

/** Runs an agent through the local Codex runtime and its existing ChatGPT login. */
export async function executeCodexAgent(
  agent: AgentConfig,
  reporter: Reporter,
  extra?: ExecuteCodexExtra,
): Promise<ExecutionResult> {
  const startedAt = performance.now();
  const state = createState();
  const codex = new Codex({
    env: buildCodexChildEnvironment(),
    config: extra?.disableMcpServers ? { mcp_servers: {} } : getCodexConfig(agent),
    // Use the user's installed Codex binary when discovery found one;
    // undefined falls back to the codex-sdk's bundled binary.
    codexPathOverride: extra?.codexExecutablePath,
    // A custom provider points Codex at an OpenAI-compatible endpoint (e.g.
    // Moonshot for Kimi K2) instead of the ChatGPT subscription. Without a
    // provider these stay undefined and the ChatGPT login is used.
    ...getProviderOptions(agent),
  });
  const thread = codex.startThread(getThreadOptions(agent));
  const { events } = await thread.runStreamed(agent.prompt, {
    signal: extra?.abortController?.signal,
  });

  for await (const event of events) {
    handleEvent(event, state, reporter);
  }

  return buildResult(state, performance.now() - startedAt, getStringField(agent, 'model'));
}

function getThreadOptions(agent: AgentConfig): ThreadOptions {
  // Codex ignores the Claude tool allowlist, so the UI capability toggles are
  // translated into Codex's own safety knobs here: read-only vs workspace-write
  // sandbox from whether the agent may write/run, and network access from an
  // explicit web-tool grant. This keeps the toggles meaningful on Codex.
  const sandboxMode = deriveCodexSandbox(agent);
  const networkAccessEnabled = deriveCodexNetworkAccess(agent);
  if ((agent.file_access?.length ?? 0) > 0) {
    throw new Error('Codex cannot enforce exact file access. Use the Claude Code runtime for this agent.');
  }

  const workingDirectory = agent.working_directory
    ? expandHome(agent.working_directory)
    : process.env.HOME ?? process.cwd();

  return {
    workingDirectory,
    skipGitRepoCheck: true,
    model: getStringField(agent, 'model'),
    sandboxMode,
    approvalPolicy: 'never',
    networkAccessEnabled,
    webSearchMode: 'disabled',
  };
}

/**
 * Resolve a custom provider into Codex constructor options. `base_url` is a
 * literal URL; `api_key` is resolved from `.env` via its `${VAR}` reference so
 * the secret never lives in the agent file. Returns an empty object when the
 * agent has no provider, so the ChatGPT subscription is used.
 */
function getProviderOptions(agent: AgentConfig): { baseUrl?: string; apiKey?: string } {
  const provider = agent.provider;
  if (!provider) return {};

  const apiKey = resolveApprovedProviderKey(provider);
  return {
    baseUrl: provider.base_url,
    ...(apiKey ? { apiKey } : {}),
  };
}

function getCodexConfig(agent: AgentConfig): Record<string, Record<string, CodexMcpServer>> | undefined {
  const servers = Object.fromEntries(
    Object.entries(agent.mcp_servers ?? {}).map(([name, config]) => [name, normalizeMcpServer(name, config)]),
  );
  const eventKitBin = process.env.AGENT_SERVER_EVENTKIT_BIN;
  if (eventKitBin && !servers.eventkit) {
    const scope = agent.calendar_access?.map(({ id, access }) => ({ id, access }));
    servers.eventkit = {
      command: eventKitBin,
      ...(scope && scope.length > 0
        ? { env: { AGENT_SERVER_CALENDAR_SCOPE: JSON.stringify(scope) } }
        : {}),
      enabled: true,
      required: true,
    };
  }
  if (Object.keys(servers).length === 0) return undefined;
  return {
    mcp_servers: servers,
  };
}

type CodexMcpServer = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  http_headers?: Record<string, string>;
  enabled: boolean;
  required: boolean;
};

function normalizeMcpServer(name: string, config: McpServerConfig): CodexMcpServer {
  if ('command' in config) {
    if (config.env && Object.keys(config.env).length > 0) {
      throw new Error(`Codex MCP server "${name}" contains credentials; use a token-backed adapter`);
    }
    return {
      command: config.command,
      ...(config.args ? { args: config.args } : {}),
      enabled: true,
      required: true,
    };
  }
  if (config.headers && Object.keys(config.headers).length > 0) {
    throw new Error(`Codex MCP server "${name}" contains credentials; use a token-backed adapter`);
  }
  return {
    url: config.url,
    enabled: true,
    required: true,
  };
}

function getStringField(agent: AgentConfig, field: string): string | undefined {
  const value = (agent as Record<string, unknown>)[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function createState(): CodexState {
  return {
    turnCount: 0,
    lastMessage: '',
    toolsUsed: new Set(),
    filesWritten: new Set(),
    commandsRun: [],
    toolCalls: [],
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
  };
}

function handleEvent(event: ThreadEvent, state: CodexState, reporter: Reporter): void {
  switch (event.type) {
    case 'thread.started':
      state.threadId = event.thread_id;
      return;
    case 'turn.started':
      state.turnCount += 1;
      return;
    case 'turn.completed':
      state.inputTokens += event.usage.input_tokens;
      state.outputTokens += event.usage.output_tokens;
      state.cachedInputTokens += event.usage.cached_input_tokens;
      state.reasoningTokens += event.usage.reasoning_output_tokens;
      return;
    case 'turn.failed':
      throw new Error(event.error.message);
    case 'error':
      throw new Error(event.message);
    case 'item.completed':
      handleItem(event.item, state, reporter);
      return;
    case 'item.started':
    case 'item.updated':
      return;
  }
}

function handleItem(item: ThreadItem, state: CodexState, reporter: Reporter): void {
  if (item.type === 'agent_message') {
    state.lastMessage = item.text;
    void reporter.progress(truncate(item.text), progressMetadata(state));
    return;
  }
  if (item.type === 'command_execution') {
    state.toolsUsed.add(item.type);
    state.commandsRun.push(item.command);
    state.toolCalls.push({ name: item.type, input: { command: item.command }, output: item.aggregated_output });
    void reporter.progress(`Using tool: ${item.type}`, progressMetadata(state));
    return;
  }
  if (item.type === 'file_change') {
    state.toolsUsed.add(item.type);
    for (const change of item.changes) state.filesWritten.add(change.path);
    return;
  }
  if (item.type === 'mcp_tool_call') {
    const name = `mcp__${item.server}__${item.tool}`;
    state.toolsUsed.add(name);
    state.toolCalls.push({ name, input: item.arguments, output: item.result ?? item.error });
    void reporter.progress(`Using tool: ${name}`, progressMetadata(state));
    return;
  }
  state.toolsUsed.add(item.type);
}

function progressMetadata(state: CodexState): Record<string, unknown> {
  return {
    turns_completed: state.turnCount,
    tools_used: [...state.toolsUsed],
    files_written: [...state.filesWritten],
    commands_run: state.commandsRun.length,
  };
}

function buildResult(state: CodexState, durationMs: number, model?: string): ExecutionResult {
  const roundedDuration = Math.round(durationMs);
  return {
    summary: state.lastMessage || 'Agent completed',
    output: {},
    usage: {
      input_tokens: state.inputTokens,
      output_tokens: state.outputTokens,
      total_tokens: state.inputTokens + state.outputTokens,
      cache_read_input_tokens: state.cachedInputTokens,
      reasoning_output_tokens: state.reasoningTokens,
      thread_id: state.threadId,
      cost_source: 'subscription-not-reported',
      duration_ms: roundedDuration,
    },
    turnCount: state.turnCount,
    toolsUsed: [...state.toolsUsed],
    filesRead: [],
    filesWritten: [...state.filesWritten],
    commandsRun: state.commandsRun,
    interaction: parseInteractionBlock(state.lastMessage),
    model,
    durationMs: roundedDuration,
    toolCalls: state.toolCalls.length > 0 ? state.toolCalls : undefined,
  };
}
