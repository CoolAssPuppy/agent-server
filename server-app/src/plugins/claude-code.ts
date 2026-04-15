import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options, Query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentConfig } from '../agents/config.js';
import { resolveEnvVars } from '../agents/config.js';
import type { Reporter } from '../execution/runner.js';
import {
  truncate,
  WRITE_TOOLS,
  type ExecutionResult,
  type McpServerInfo,
  type ToolCallTrace,
} from '../execution/executor.js';
import { expandHome } from '../agents/file-watcher.js';
import { parseInteractionBlock, parseDecisionBlock } from '../interaction/parser.js';
import { buildCanUseTool } from '../execution/permissions.js';
import { runDecisionCycle, type DecisionContext } from '../execution/decision-handler.js';

type ExecuteAgentExtra = {
  abortController?: AbortController;
  decisionContext?: DecisionContext;
  runId?: string;
};

export async function executeAgent(
  agent: AgentConfig,
  reporter: Reporter,
  extra?: ExecuteAgentExtra,
): Promise<ExecutionResult> {
  const cwd = agent.working_directory
    ? expandHome(agent.working_directory)
    : process.env.HOME ?? process.cwd();

  const permissionMode = agent.permission_mode ?? 'bypassPermissions';

  const options: Options = {
    maxTurns: agent.max_turns,
    cwd,
    permissionMode,
    allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions' ? true : undefined,
    allowedTools: agent.tools.length > 0 ? agent.tools : undefined,
    disallowedTools: agent.disallowed_tools && agent.disallowed_tools.length > 0
      ? agent.disallowed_tools
      : undefined,
    canUseTool: agent.permissions ? buildCanUseTool(agent.permissions) : undefined,
    abortController: extra?.abortController,
    mcpServers: buildMcpServers(agent),
  };

  let turnCount = 0;
  const toolsUsed = new Set<string>();
  const allFilesRead = new Set<string>();
  const allFilesWritten = new Set<string>();
  const allCommandsRun: string[] = [];
  let lastAssistantText = '';
  let lastToolName: string | null = null;
  let mcpServers: McpServerInfo[] = [];
  let currentPrompt = agent.prompt;
  const resumptionHistory: string[] = [];

  // Accumulators that survive decision-resume segments (Fix 5).
  let totalNumTurns = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreationTokens = 0;
  let totalCostUsd = 0;
  let lastModel: string | undefined;
  let lastStopReason: string | undefined;
  let lastDurationMs: number | undefined;
  let lastDurationApiMs: number | undefined;

  // Per-run tool-call tracking for Fix 3. Key: tool_use id.
  const toolStarts = new Map<string, { name: string; input: unknown; startedAt: number }>();
  const completedToolCalls: ToolCallTrace[] = [];

  // Outer loop runs one SDK invocation per paused-and-resumed segment. Each
  // `query()` call emits an assistant stream; if a decision block appears
  // mid-stream, we pause, await resolution, and restart the SDK with the
  // resumption text appended to the prompt. Without a decisionContext this
  // loop runs exactly once (backward compatible).
  while (true) {
    const stream = query({ prompt: currentPrompt, options });

    mcpServers = await handleMcpServerStatus(stream, reporter);

    let decisionHandled = false;
    let resultPayload: ExecutionResult | undefined;
    // Track cumulative usage reported within this segment by assistant
    // messages. The SDK reports the segment's running totals on each
    // assistant turn; if the segment is interrupted before a `result`
    // message arrives (decision pause), this is the only source of truth
    // for the tokens consumed so far.
    let segmentAssistantInput = 0;
    let segmentAssistantOutput = 0;
    let segmentAssistantCacheRead = 0;
    let segmentAssistantCacheCreation = 0;
    let segmentHadResult = false;
    let segmentTurnsFromAssistants = 0;

    for await (const message of stream) {
      if (message.type === 'user') {
        // Pair tool_use with tool_result to compute per-call duration (Fix 3).
        const userContent = message.message?.content;
        if (Array.isArray(userContent)) {
          for (const block of userContent) {
            if (
              typeof block === 'object' &&
              block !== null &&
              'type' in block &&
              (block as { type: unknown }).type === 'tool_result' &&
              'tool_use_id' in block
            ) {
              const id = (block as { tool_use_id: unknown }).tool_use_id;
              if (typeof id !== 'string') continue;
              const started = toolStarts.get(id);
              if (!started) continue;
              const output = 'content' in block
                ? (block as { content: unknown }).content
                : undefined;
              completedToolCalls.push({
                name: started.name,
                input: started.input,
                output,
                duration_ms: Math.max(0, performance.now() - started.startedAt),
              });
              toolStarts.delete(id);
            }
          }
        }
      }

      if (message.type === 'assistant') {
        turnCount++;
        const content = message.message?.content;
        if (!Array.isArray(content)) continue;

        const textParts: string[] = [];
        const turnStartedAt = performance.now();

        for (const block of content) {
          if (block.type === 'text' && 'text' in block && typeof block.text === 'string') {
            textParts.push(block.text);
          }

          if (block.type === 'tool_use' && 'name' in block && typeof block.name === 'string') {
            const name = block.name;
            toolsUsed.add(name);
            lastToolName = name;

            const rawInput = 'input' in block ? block.input : {};
            const input: Record<string, unknown> =
              rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
                ? (rawInput as Record<string, unknown>)
                : {};
            const toolUseId = 'id' in block && typeof block.id === 'string' ? block.id : null;
            if (toolUseId) {
              toolStarts.set(toolUseId, {
                name,
                input,
                startedAt: turnStartedAt,
              });
            }
            const filePath = typeof input.file_path === 'string' ? input.file_path : null;

            if (name === 'Read' && filePath) {
              allFilesRead.add(filePath);
            } else if (WRITE_TOOLS.has(name) && filePath) {
              allFilesWritten.add(filePath);
            } else if (name === 'Bash' && typeof input.command === 'string') {
              allCommandsRun.push(input.command);
            }
          }
        }

        if (textParts.length > 0) {
          lastAssistantText = textParts.join('\n');
        }

        // Per-turn usage + cost deltas (Fix 2). Track both cumulative
        // segment totals (used as a fallback source for Fix 5 when a segment
        // is interrupted without emitting a `result`) and per-turn deltas.
        const assistantUsage = extractAssistantUsage(message);
        const turnModel = extractAssistantModel(message);
        if (turnModel) lastModel = turnModel;

        let deltaInput = 0;
        let deltaOutput = 0;
        if (assistantUsage) {
          deltaInput = Math.max(0, assistantUsage.inputTokens - segmentAssistantInput);
          deltaOutput = Math.max(0, assistantUsage.outputTokens - segmentAssistantOutput);
          segmentAssistantInput = Math.max(segmentAssistantInput, assistantUsage.inputTokens);
          segmentAssistantOutput = Math.max(segmentAssistantOutput, assistantUsage.outputTokens);
          segmentAssistantCacheRead = Math.max(segmentAssistantCacheRead, assistantUsage.cacheReadTokens);
          segmentAssistantCacheCreation = Math.max(segmentAssistantCacheCreation, assistantUsage.cacheCreationTokens);
        }
        segmentTurnsFromAssistants += 1;

        const summary = textParts.length > 0
          ? truncate(textParts.join(' '))
          : lastToolName
            ? `Using tool: ${lastToolName}`
            : null;

        const progressMetadata: Record<string, unknown> = {
          turns_completed: turnCount,
          tools_used: [...toolsUsed],
          files_written: [...allFilesWritten],
          commands_run: allCommandsRun.length,
        };
        if (assistantUsage) {
          progressMetadata.tokens_delta = {
            input: deltaInput,
            output: deltaOutput,
          };
          // Per-turn cost is not exposed directly by the SDK assistant
          // message. The final `result` message carries total_cost_usd which
          // we already accumulate. Leaving cost_delta_usd undefined here is
          // intentional -- downstream code handles a missing per-turn cost.
        }
        if (turnModel) {
          progressMetadata.model = turnModel;
        }
        if (completedToolCalls.length > 0) {
          progressMetadata.tool_calls = [...completedToolCalls];
        }

        if (summary) {
          void reporter.progress(summary, progressMetadata);
        }

        if (extra?.decisionContext && textParts.length > 0) {
          const joined = textParts.join('\n');
          const decision = parseDecisionBlock(joined);
          if (decision) {
            try {
              await stream.interrupt();
            } catch {
              // Some SDK builds may not support interrupt; ignore.
            }
            const outcome = await runDecisionCycle(decision, extra.decisionContext);
            if (outcome.status === 'timeout') {
              throw new Error('Decision timed out');
            }
            resumptionHistory.push(outcome.resumptionText);
            currentPrompt = buildResumptionPrompt(agent.prompt, resumptionHistory);
            decisionHandled = true;
            break;
          }
        }
      }

      if (message.type === 'result') {
        segmentHadResult = true;
        // Accumulate usage across decision-resume segments (Fix 5). We must
        // do this even for the non-success subtype so that a failure after
        // a successful segment keeps the prior telemetry.
        const usage = extractResultUsage(message);
        totalInputTokens += usage.inputTokens;
        totalOutputTokens += usage.outputTokens;
        totalCacheReadTokens += usage.cacheReadTokens;
        totalCacheCreationTokens += usage.cacheCreationTokens;
        if (typeof message.total_cost_usd === 'number') {
          totalCostUsd += message.total_cost_usd;
        }
        if (typeof message.num_turns === 'number') {
          totalNumTurns += message.num_turns;
        }
        if (typeof message.stop_reason === 'string' && message.stop_reason) {
          lastStopReason = message.stop_reason;
        }
        if (typeof message.duration_ms === 'number') {
          lastDurationMs = (lastDurationMs ?? 0) + message.duration_ms;
        }
        if (typeof message.duration_api_ms === 'number') {
          lastDurationApiMs = (lastDurationApiMs ?? 0) + message.duration_api_ms;
        }
        const resolvedModel = extractModelFromResult(message) ?? lastModel;
        if (resolvedModel) lastModel = resolvedModel;

        if (message.subtype !== 'success') {
          const rawErrors = 'errors' in message ? message.errors : [];
          const errors = Array.isArray(rawErrors)
            ? rawErrors.filter((e): e is string => typeof e === 'string')
            : [];
          throw new Error(errors.join('; ') || `Agent failed: ${message.subtype}`);
        }

        const resultText =
          'result' in message && typeof message.result === 'string' ? message.result : '';

        resultPayload = buildResult({
          summary: resultText || 'Agent completed',
          turnCount: totalNumTurns,
          toolsUsed,
          allFilesRead,
          allFilesWritten,
          allCommandsRun,
          lastAssistantText,
          mcpServers,
          totalInputTokens,
          totalOutputTokens,
          totalCacheReadTokens,
          totalCacheCreationTokens,
          totalCostUsd,
          model: lastModel,
          stopReason: lastStopReason,
          durationMs: lastDurationMs,
          durationApiMs: lastDurationApiMs,
          toolCalls: completedToolCalls,
        });
        break;
      }
    }

    if (!segmentHadResult) {
      // Segment ended without a final `result` (decision interrupt or
      // stream ended). Fold observed assistant usage into the running
      // totals so subsequent segments add on top.
      totalInputTokens += segmentAssistantInput;
      totalOutputTokens += segmentAssistantOutput;
      totalCacheReadTokens = Math.max(totalCacheReadTokens, segmentAssistantCacheRead);
      totalCacheCreationTokens = Math.max(totalCacheCreationTokens, segmentAssistantCacheCreation);
      totalNumTurns += segmentTurnsFromAssistants;
    }

    if (resultPayload) return resultPayload;
    if (decisionHandled) continue;

    // Stream ended without emitting a terminal `result` message. Treat this
    // as a failure so the reporter marks the run failed instead of silently
    // claiming success — otherwise the panel's stale-run sweep would flag it.
    throw new Error('Claude SDK stream ended without a result message');
  }
}

type AssistantUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

function extractAssistantUsage(message: unknown): AssistantUsage | null {
  if (typeof message !== 'object' || message === null) return null;
  const msg = (message as { message?: unknown }).message;
  if (typeof msg !== 'object' || msg === null) return null;
  const usage = (msg as { usage?: unknown }).usage;
  if (typeof usage !== 'object' || usage === null) return null;
  const u = usage as Record<string, unknown>;
  const toNum = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    inputTokens: toNum(u.input_tokens),
    outputTokens: toNum(u.output_tokens),
    cacheReadTokens: toNum(u.cache_read_input_tokens),
    cacheCreationTokens: toNum(u.cache_creation_input_tokens),
  };
}

function extractAssistantModel(message: unknown): string | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  const msg = (message as { message?: unknown }).message;
  if (typeof msg !== 'object' || msg === null) return undefined;
  const model = (msg as { model?: unknown }).model;
  return typeof model === 'string' && model.length > 0 ? model : undefined;
}

function extractResultUsage(message: unknown): AssistantUsage {
  if (typeof message !== 'object' || message === null) {
    return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  }
  const u = (message as { usage?: unknown }).usage;
  if (typeof u !== 'object' || u === null) {
    return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  }
  const obj = u as Record<string, unknown>;
  const toNum = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    inputTokens: toNum(obj.input_tokens),
    outputTokens: toNum(obj.output_tokens),
    cacheReadTokens: toNum(obj.cache_read_input_tokens),
    cacheCreationTokens: toNum(obj.cache_creation_input_tokens),
  };
}

function extractModelFromResult(message: unknown): string | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  const mu = (message as { modelUsage?: unknown }).modelUsage;
  if (typeof mu !== 'object' || mu === null) return undefined;
  // modelUsage is Record<modelName, {...}>; pick the first populated key.
  for (const key of Object.keys(mu as Record<string, unknown>)) {
    if (key) return key;
  }
  return undefined;
}

function buildResumptionPrompt(originalPrompt: string, history: string[]): string {
  if (history.length === 0) return originalPrompt;
  const historyBlock = history.map((h, i) => `[Resumption ${i + 1}] ${h}`).join('\n');
  return `${originalPrompt}\n\nConversation updates since you last paused:\n${historyBlock}\n\nContinue the task.`;
}

function buildResult(params: {
  summary: string;
  turnCount: number;
  toolsUsed: Set<string>;
  allFilesRead: Set<string>;
  allFilesWritten: Set<string>;
  allCommandsRun: string[];
  lastAssistantText: string;
  mcpServers: McpServerInfo[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalCostUsd: number;
  model?: string;
  stopReason?: string;
  durationMs?: number;
  durationApiMs?: number;
  toolCalls: ToolCallTrace[];
}): ExecutionResult {
  const interaction = parseInteractionBlock(params.lastAssistantText);
  const totalTokens = params.totalInputTokens + params.totalOutputTokens;

  const usage: Record<string, unknown> = {
    // Legacy fields retained for backward compat with Panel queries.
    turns: params.turnCount,
    files_read: params.allFilesRead.size,
    files_written: params.allFilesWritten.size,
    commands_run: params.allCommandsRun.length,
    // Rich usage (Fix 1 + Fix 5).
    input_tokens: params.totalInputTokens,
    output_tokens: params.totalOutputTokens,
    total_tokens: totalTokens,
    estimated_cost_usd: Number(params.totalCostUsd.toFixed(6)),
    cache_read_input_tokens: params.totalCacheReadTokens,
    cache_creation_input_tokens: params.totalCacheCreationTokens,
    turn_count: params.turnCount,
  };
  if (params.stopReason) usage.stop_reason = params.stopReason;
  if (typeof params.durationMs === 'number') usage.duration_ms = params.durationMs;
  if (typeof params.durationApiMs === 'number') usage.duration_api_ms = params.durationApiMs;
  if (params.model) usage.model = params.model;

  return {
    summary: params.summary,
    output: {},
    usage,
    turnCount: params.turnCount,
    toolsUsed: [...params.toolsUsed],
    filesRead: [...params.allFilesRead],
    filesWritten: [...params.allFilesWritten],
    commandsRun: params.allCommandsRun,
    interaction,
    mcpServers: params.mcpServers.length > 0 ? params.mcpServers : undefined,
    model: params.model,
    stopReason: params.stopReason,
    durationMs: params.durationMs,
    durationApiMs: params.durationApiMs,
    toolCalls: params.toolCalls.length > 0 ? [...params.toolCalls] : undefined,
  };
}

export const RECONNECT_DELAY_MS = 3000;
export const MAX_RECONNECT_ATTEMPTS = 2;

function logMcpStatus(servers: McpServerInfo[]): void {
  const connected = servers.filter((s) => s.status === 'connected').map((s) => s.name);
  const failed = servers.filter((s) => s.status === 'failed');
  const needsAuth = servers.filter((s) => s.status === 'needs-auth').map((s) => s.name);
  const pending = servers.filter((s) => s.status === 'pending').map((s) => s.name);
  const disabled = servers.filter((s) => s.status === 'disabled').map((s) => s.name);

  if (connected.length > 0) {
    console.log(`[mcp] Connected: ${connected.join(', ')}`);
  }
  if (failed.length > 0) {
    console.error(`[mcp] Failed: ${failed.map((s) => `${s.name}${s.error ? ` (${s.error})` : ''}`).join(', ')}`);
  }
  if (needsAuth.length > 0) {
    console.error(`[mcp] Needs auth: ${needsAuth.join(', ')} -- re-authenticate in Claude Code`);
  }
  if (pending.length > 0) {
    console.log(`[mcp] Pending: ${pending.join(', ')}`);
  }
  if (disabled.length > 0) {
    console.log(`[mcp] Disabled: ${disabled.join(', ')}`);
  }
}

async function fetchMcpStatus(stream: Query): Promise<McpServerInfo[]> {
  try {
    const statuses = await stream.mcpServerStatus();
    return statuses.map((s) => ({
      name: s.name,
      status: s.status,
      error: s.error,
    }));
  } catch {
    return [];
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleMcpServerStatus(
  stream: Query,
  reporter: Reporter,
): Promise<McpServerInfo[]> {
  const servers = await fetchMcpStatus(stream);
  if (servers.length === 0) return [];

  logMcpStatus(servers);

  const failedServers = servers.filter((s) => s.status === 'failed');

  if (failedServers.length > 0) {
    for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
      console.log(`[mcp] Reconnecting failed servers (attempt ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS})...`);

      for (const server of failedServers) {
        try {
          await stream.reconnectMcpServer(server.name);
        } catch {
          console.error(`[mcp] Reconnect failed for ${server.name}`);
        }
      }

      await delay(RECONNECT_DELAY_MS);
      const updated = await fetchMcpStatus(stream);
      const stillFailed = updated.filter((s) => s.status === 'failed');

      if (stillFailed.length === 0) {
        console.log('[mcp] All servers reconnected successfully');
        logMcpStatus(updated);
        reportMcpStatus(updated, reporter);
        return updated;
      }

      if (attempt === MAX_RECONNECT_ATTEMPTS - 1) {
        console.error(`[mcp] Servers still failed after ${MAX_RECONNECT_ATTEMPTS} attempts: ${stillFailed.map((s) => s.name).join(', ')}`);
        logMcpStatus(updated);
        reportMcpStatus(updated, reporter);
        return updated;
      }
    }
  }

  reportMcpStatus(servers, reporter);
  return servers;
}

function reportMcpStatus(servers: McpServerInfo[], reporter: Reporter): void {
  const connected = servers.filter((s) => s.status === 'connected').length;
  const failed = servers.filter((s) => s.status === 'failed').length;
  const needsAuth = servers.filter((s) => s.status === 'needs-auth').length;

  const parts: string[] = [];
  if (connected > 0) parts.push(`${connected} connected`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (needsAuth > 0) parts.push(`${needsAuth} needs auth`);

  if (parts.length > 0) {
    void reporter.progress(`[mcp] ${parts.join(', ')}`, {
      mcp_servers: servers,
    });
  }
}

export function buildMcpServers(agent: AgentConfig): Options['mcpServers'] {
  const servers: NonNullable<Options['mcpServers']> = {};

  if (agent.mcp_servers) {
    for (const [name, config] of Object.entries(agent.mcp_servers)) {
      if ('command' in config) {
        servers[name] = {
          ...config,
          env: config.env ? resolveEnvVars(config.env) : undefined,
        };
      } else if ('url' in config) {
        servers[name] = {
          ...config,
          headers: config.headers ? resolveEnvVars(config.headers) : undefined,
        };
      }
    }
  }

  const eventKitBin = process.env.AGENT_SERVER_EVENTKIT_BIN;
  if (eventKitBin && !servers.eventkit) {
    servers.eventkit = {
      type: 'stdio',
      command: eventKitBin,
      args: [],
    };
  }

  return Object.keys(servers).length > 0 ? servers : undefined;
}
