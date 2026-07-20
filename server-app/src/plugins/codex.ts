import { Codex, type ThreadEvent, type ThreadItem, type ThreadOptions } from '@openai/codex-sdk';
import type { AgentConfig, McpServerConfig } from '../agents/config.js';
import { buildCodexChildEnvironment, resolveApprovedProviderKey } from '../agents/environment-policy.js';
import { deriveCodexSandbox, deriveCodexNetworkAccess } from '../execution/codex-safety.js';
import { expandHome } from '../agents/file-watcher.js';
import type { ExecutionResult, ToolCallTrace } from '../execution/executor.js';
import { truncate } from '../execution/executor.js';
import type { Reporter } from '../execution/runner.js';
import { parseInteractionBlock } from '../interaction/parser.js';
import { nativeServiceGrantEnvironment } from '../agents/native-services.js';
import { resolveSavedConnectionValues } from '../connections/runtime-resolution.js';
import {
  buildScopedCodexInvocation,
  streamScopedCodex,
  type ScopedCodexInvocation,
} from './codex-cli.js';

type ExecuteCodexExtra = {
  abortController?: AbortController;
  /**
   * Path to the user's installed Codex executable. When set, Codex uses it
   * instead of the codex-sdk's bundled binary. Undefined keeps the default.
   */
  codexExecutablePath?: string;
  disableMcpServers?: boolean;
  scopedEventStream?: (
    invocation: ScopedCodexInvocation,
    prompt: string,
    signal?: AbortSignal,
  ) => AsyncIterable<ThreadEvent>;
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
  const environment = buildCodexChildEnvironment();
  const config = extra?.disableMcpServers ? { mcp_servers: {} } : getCodexConfig(agent);
  const provider = getProviderOptions(agent);
  if ((agent.file_access?.length ?? 0) > 0) {
    const invocation = buildScopedCodexInvocation({
      agent,
      environment,
      config,
      codexExecutablePath: extra?.codexExecutablePath,
      ...provider,
    });
    const eventStream = extra?.scopedEventStream ?? streamScopedCodex;
    for await (const event of eventStream(invocation, agent.prompt, extra?.abortController?.signal)) {
      handleEvent(event, state, reporter);
    }
    return buildResult(state, performance.now() - startedAt, getStringField(agent, 'model'));
  }
  const codex = new Codex({
    env: environment,
    config,
    // Use the user's installed Codex binary when discovery found one;
    // undefined falls back to the codex-sdk's bundled binary.
    codexPathOverride: extra?.codexExecutablePath,
    // A custom provider points Codex at an OpenAI-compatible endpoint (e.g.
    // Moonshot for Kimi K3) instead of the ChatGPT subscription. Without a
    // provider these stay undefined and the ChatGPT login is used.
    ...provider,
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
    Object.entries(agent.mcp_servers ?? {}).map(([name, config]) => [
      name,
      normalizeMcpServer(agent, name, config),
    ]),
  );
  const eventKitBin = process.env.AGENT_SERVER_EVENTKIT_BIN;
  if (eventKitBin && !servers.eventkit) {
    const grants = nativeServiceGrantEnvironment(agent);
    servers.eventkit = {
      command: eventKitBin,
      ...(grants !== undefined
        ? { env: { AGENT_SERVER_NATIVE_SERVICE_GRANTS: grants } }
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

function normalizeMcpServer(agent: AgentConfig, name: string, config: McpServerConfig): CodexMcpServer {
  if ('command' in config) {
    const savedEnvironment = config.env
      ? resolveSavedConnectionValues(agent, name, config.env)
      : undefined;
    if (config.env && !savedEnvironment && Object.keys(config.env).length > 0) {
      throw new Error(`Codex MCP server "${name}" contains credentials; use a token-backed adapter`);
    }
    return {
      command: config.command,
      ...(config.args ? { args: config.args } : {}),
      ...(savedEnvironment ? { env: savedEnvironment } : {}),
      enabled: true,
      required: true,
    };
  }
  const savedHeaders = config.headers
    ? resolveSavedConnectionValues(agent, name, config.headers)
    : undefined;
  if (config.headers && !savedHeaders && Object.keys(config.headers).length > 0) {
    throw new Error(`Codex MCP server "${name}" contains credentials; use a token-backed adapter`);
  }
  return {
    url: config.url,
    ...(savedHeaders ? { http_headers: savedHeaders } : {}),
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
    state.toolCalls.push({
      name: item.type,
      status: item.status === 'completed' && item.exit_code === 0 ? 'succeeded' : 'failed',
      input: { command: item.command },
      output: item.aggregated_output,
    });
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
    state.toolCalls.push({
      name,
      status: item.status === 'completed' ? 'succeeded' : 'failed',
      input: item.arguments,
      output: item.result ?? item.error,
    });
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
