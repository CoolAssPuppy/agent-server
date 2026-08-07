import type { ThreadEvent, ThreadItem } from '@openai/codex-sdk';
import type { AgentConfig, McpServerConfig } from '../agents/config.js';
import { buildCodexChildEnvironment, resolveApprovedProviderKey } from '../agents/environment-policy.js';
import type { ExecutionResult, ToolCallTrace } from '../execution/executor.js';
import { truncate } from '../execution/executor.js';
import type { Reporter } from '../execution/runner.js';
import { parseInteractionBlock } from '../interaction/parser.js';
import { nativeServiceGrantEnvironment } from '../agents/native-services.js';
import { resolveSavedConnectionValues } from '../connections/runtime-resolution.js';
import { runtimeCodexAppPolicies } from '../connections/runtime-policy.js';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  credentialBrokerSocketPath,
  type CredentialBrokerPlan,
} from './credential-broker.js';
import { buildMcpPolicyRelayCommand } from './mcp-relay-runtime.js';
import {
  buildScopedCodexInvocation,
  streamScopedCodex,
  type ScopedCodexInvocation,
} from './codex-cli.js';

type ExecuteCodexExtra = {
  abortController?: AbortController;
  /**
   * Path to the user's installed Codex executable. The app passes this key
   * even when discovery fails so the executor can return setup guidance.
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
  if (extra && Object.hasOwn(extra, 'codexExecutablePath') && !extra.codexExecutablePath) {
    throw new Error('Codex is not installed. Install Codex or choose another coding agent.');
  }
  const startedAt = performance.now();
  const state = createState();
  const environment = buildCodexChildEnvironment();
  const codexMcp = extra?.disableMcpServers
    ? { config: { mcp_servers: {} }, credentialBroker: undefined }
    : getCodexMcpRuntime(agent);
  const provider = getProviderOptions(agent);
  const invocation = buildScopedCodexInvocation({
    agent,
    config: codexMcp.config,
    environment,
    credentialBroker: codexMcp.credentialBroker,
    codexExecutablePath: extra?.codexExecutablePath,
    ...provider,
  });
  const eventStream = extra?.scopedEventStream ?? streamScopedCodex;
  for await (const event of eventStream(invocation, agent.prompt, extra?.abortController?.signal)) {
    handleEvent(event, state, reporter);
  }

  return buildResult(state, performance.now() - startedAt, getStringField(agent, 'model'));
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

function getCodexMcpRuntime(agent: AgentConfig): {
  config: Record<string, unknown> | undefined;
  credentialBroker: CredentialBrokerPlan | undefined;
} {
  const credentialBroker: CredentialBrokerPlan = {
    socketPath: credentialBrokerSocketPath(),
    grants: {},
  };
  const servers = Object.fromEntries(
    Object.entries(agent.mcp_servers ?? {}).map(([name, config]) => {
      const normalized = normalizeMcpServer(agent, name, config, credentialBroker);
      return [name, normalized.server];
    }),
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
      default_tools_approval_mode: 'approve',
      ...mcpToolFilters(agent, 'eventkit'),
    };
  }
  const apps = codexAppConfig(agent);
  const config = {
    ...(Object.keys(servers).length > 0 ? { mcp_servers: servers } : {}),
    ...(apps ? { features: { apps: true }, apps } : {}),
  };
  return {
    config: Object.keys(config).length === 0 ? undefined : config,
    credentialBroker: Object.keys(credentialBroker.grants).length > 0
      ? credentialBroker
      : undefined,
  };
}

function codexAppConfig(agent: AgentConfig): Record<string, unknown> | undefined {
  const policies = runtimeCodexAppPolicies(agent);
  if (Object.keys(policies).length === 0) return undefined;
  return {
    _default: {
      enabled: false,
      default_tools_enabled: false,
      destructive_enabled: false,
      open_world_enabled: false,
    },
    ...Object.fromEntries(Object.entries(policies).map(([appId, policy]) => [appId, {
      enabled: true,
      default_tools_enabled: true,
      destructive_enabled: Object.values(policy.tools).some(({ effect }) => effect === 'write'),
      open_world_enabled: true,
      tools: Object.fromEntries(policy.availableTools.map((tool) => [tool,
        policy.tools[tool]
          ? { enabled: true, approval_mode: 'approve' }
          : { enabled: false },
      ])),
    }])),
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
  default_tools_approval_mode: 'approve';
  enabled_tools?: string[];
  disabled_tools?: string[];
};

function normalizeMcpServer(
  agent: AgentConfig,
  name: string,
  config: McpServerConfig,
  credentialBroker: CredentialBrokerPlan,
): { server: CodexMcpServer } {
  if ('command' in config) {
    const savedEnvironment = config.env
      ? resolveSavedConnectionValues(agent, name, config.env)
      : undefined;
    if (config.env && !savedEnvironment && Object.keys(config.env).length > 0) {
      throw new Error(`Codex MCP server "${name}" contains credentials; use a token-backed adapter`);
    }
    const relay = buildMcpPolicyRelayCommand(
      agent,
      name,
      config,
      savedEnvironment ?? {},
      credentialBroker,
    );
    if (relay) {
      return { server: {
        ...relay,
        enabled: true,
        required: true,
        default_tools_approval_mode: 'approve',
        ...mcpToolFilters(agent, name),
      } };
    }
    if (!savedEnvironment || Object.keys(savedEnvironment).length === 0) {
      return { server: {
        command: config.command,
        ...(config.args ? { args: config.args } : {}),
        enabled: true,
        required: true,
        default_tools_approval_mode: 'approve',
        ...mcpToolFilters(agent, name),
      } };
    }
    const grant = randomUUID();
    credentialBroker.grants[grant] = savedEnvironment;
    const launcherPayload = JSON.stringify({
      command: config.command,
      args: config.args ?? [],
      credential_broker: credentialBroker.socketPath,
      credential_grant: grant,
    });
    return { server: {
      command: process.execPath,
      args: [fileURLToPath(new URL('./mcp-credential-launcher.js', import.meta.url)), launcherPayload],
      enabled: true,
      required: true,
      default_tools_approval_mode: 'approve',
      ...mcpToolFilters(agent, name),
    } };
  }
  const savedHeaders = config.headers
    ? resolveSavedConnectionValues(agent, name, config.headers)
    : undefined;
  if (config.headers && !savedHeaders && Object.keys(config.headers).length > 0) {
    throw new Error(`Codex MCP server "${name}" contains credentials; use a token-backed adapter`);
  }
  const relay = buildMcpPolicyRelayCommand(
    agent,
    name,
    config,
    savedHeaders ?? {},
    credentialBroker,
  );
  if (relay) {
    return { server: {
      ...relay,
      enabled: true,
      required: true,
      default_tools_approval_mode: 'approve',
      ...mcpToolFilters(agent, name),
    } };
  }
  if (savedHeaders && Object.keys(savedHeaders).length > 0) {
    throw new Error(
      `Codex MCP server "${name}" uses HTTP credentials that require the local credential relay`,
    );
  }
  return { server: {
    url: config.url,
    enabled: true,
    required: true,
    default_tools_approval_mode: 'approve',
    ...mcpToolFilters(agent, name),
  } };
}

function mcpToolFilters(
  agent: AgentConfig,
  serverName: string,
): Pick<CodexMcpServer, 'enabled_tools' | 'disabled_tools'> {
  const prefix = `mcp__${serverName}__`;
  const enabledTools = exactServerTools(agent.permissions?.allow, prefix);
  const disabledTools = exactServerTools(agent.permissions?.deny, prefix);
  return {
    ...(enabledTools.length > 0 ? { enabled_tools: enabledTools } : {}),
    ...(disabledTools.length > 0 ? { disabled_tools: disabledTools } : {}),
  };
}

function exactServerTools(patterns: readonly string[] | undefined, prefix: string): string[] {
  return [...new Set((patterns ?? []).flatMap((pattern) => {
    if (!pattern.startsWith(prefix)) return [];
    const tool = pattern.slice(prefix.length);
    return tool.length > 0 && !tool.includes('*') ? [tool] : [];
  }))];
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
