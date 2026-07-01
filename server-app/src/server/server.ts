import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { hostname, homedir } from 'os';
import { join } from 'path';
import type { ServerConfig } from '../platform/config.js';
import type { AgentConfig } from '../agents/config.js';
import type { Reporter } from '../execution/runner.js';
import { createApi } from './api.js';
import { discoverAgents } from '../agents/discovery.js';
import { RunStore } from '../reporting/store.js';
import { runAgent } from '../execution/runner.js';
import { executeAgent } from '../plugins/claude-code.js';
import { ExecutorRegistry } from '../execution/executor-registry.js';
import type { McpServerInfo } from '../execution/executor.js';
import { createReporter } from '../reporting/reporter-factory.js';
import { createPanelClient } from '../reporting/panel-client.js';
import { seedRunStoreFromPanel } from './seed-run-store.js';
import { replayPendingTerminals } from '../reporting/reporter.js';
import { ScheduleSync } from '../reporting/sync-schedule.js';
import { SseClient } from '../reporting/sse-client.js';
import { TriggerHandler } from '../execution/trigger-handler.js';
import type { DecisionContext } from '../execution/decision-handler.js';
import { shouldRun, hasMissedRun } from '../agents/scheduler.js';
import { evaluateTriggers } from '../agents/triggers.js';
import { FileWatcher, extractWatchConfigs } from '../agents/file-watcher.js';
import { ChannelDispatcher } from '../channels/dispatcher.js';
import { InteractionStore } from '../interaction/store.js';
import { ConversationStore } from '../conversation/store.js';
import { formatConversationHistory } from '../conversation/history-formatter.js';
import type { InteractionRequest } from '../interaction/schema.js';
import { createTelegramChannel } from '../channels/telegram.js';
import { formatAgentListMessage, type NotificationData } from '../interaction/notification.js';
import { routeMessage } from '../channels/router.js';
import { randomUUID } from 'crypto';
import { ProgressBroadcaster, type ProgressEvent } from './websocket.js';
import { sanitizeProgressEvent, sanitizeText } from './security-utils.js';
import { parseDuration } from '../agents/duration.js';

export type ServerInstance = {
  stop: () => Promise<void> | void;
};

/**
 * Periodic replay of persisted pending-terminal events. Long-lived daemons
 * that suffer a panel outage will eventually drain the queue without needing
 * a restart.
 */
const PENDING_REPLAY_INTERVAL_MS = 10 * 60 * 1000;

/** Max time to wait for active runs to emit terminals on shutdown. */
const SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;
/** Per-run wait inside the overall drain budget. */
const SHUTDOWN_PER_RUN_TIMEOUT_MS = 3_000;

const DEFAULT_INTERACTION_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_CONVERSATION_TTL_MS = 30 * 60 * 1000;

function isNeedsAuthMcpServer(value: unknown): value is McpServerInfo {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Partial<McpServerInfo>;
  return s.status === 'needs-auth' && typeof s.name === 'string';
}

export function extractMcpNeedsAuthServers(meta: Record<string, unknown> | undefined): string[] {
  if (!meta) return [];
  const servers = meta.mcp_servers;
  if (!Array.isArray(servers)) return [];
  return servers.filter(isNeedsAuthMcpServer).map((s) => s.name);
}

/**
 * Resolves the wall-clock run timeout in order of precedence: the agent's
 * `timeout` field wins when present and valid, otherwise the server default
 * from `AGENT_SERVER_RUN_TIMEOUT_MS`. Returns `undefined` (no timeout)
 * when the server default is 0 or negative and the agent does not declare
 * its own.
 */
function resolveRunTimeoutMs(agent: AgentConfig, config: ServerConfig): number | undefined {
  if (agent.timeout) {
    const parsed = parseDuration(agent.timeout, 0);
    if (parsed > 0) return parsed;
  }
  return config.runTimeoutMs > 0 ? config.runTimeoutMs : undefined;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
}



export function isAllowedOrigin(originHeader: string | undefined, host: string): boolean {
  if (!originHeader) return true;

  try {
    const origin = new URL(originHeader);
    const originHost = origin.hostname.toLowerCase();
    const normalizedHost = host.trim().toLowerCase();

    if (originHost === normalizedHost) return true;
    if (isLoopbackHost(originHost) && isLoopbackHost(normalizedHost)) return true;
    return false;
  } catch {
    return false;
  }
}

export function validateNetworkExposure(host: string, apiKey?: string): void {
  const trimmedApiKey = apiKey?.trim();

  if (!trimmedApiKey && !isLoopbackHost(host)) {
    throw new Error('Refusing to bind to a non-loopback host without AGENT_SERVER_API_KEY');
  }

  if (trimmedApiKey && trimmedApiKey.length < 16) {
    throw new Error('AGENT_SERVER_API_KEY must be at least 16 characters long');
  }
}

export function shouldSendTelegramRunNotification(
  agent: AgentConfig,
  status: 'completed' | 'failed',
): boolean {
  const notification = agent.notification;
  if (!notification || notification.channel !== 'telegram') {
    return true;
  }

  if (status === 'completed') {
    return notification.on_complete !== true;
  }

  return notification.on_failure !== true;
}

/**
 * Sentinel summary produced by plugins/claude-code.ts when the agent's final
 * message is empty. Treating this as "silent mode" lets agents opt out of a
 * completion notification by returning an empty final message. See the guard
 * in {@link shouldDispatchNotification}.
 */
export const SILENT_COMPLETION_SUMMARY = 'Agent completed';

/**
 * Decides whether a run-completion or run-failure notification should be
 * dispatched to the agent's configured channel.
 *
 * Silent-mode behavior: when an agent returns an empty final message, the
 * claude-code plugin fills in the fallback string `"Agent completed"`. That
 * fallback is not a meaningful summary — it means the agent had nothing to
 * report — so completion notifications with that exact summary are suppressed.
 * Failure notifications are never silenced by this rule.
 */
export function shouldDispatchNotification(
  agent: AgentConfig,
  data: Pick<NotificationData, 'status' | 'summary'>,
): boolean {
  if (!agent.notification) return false;

  const shouldNotify = data.status === 'completed'
    ? agent.notification.on_complete
    : agent.notification.on_failure;

  if (!shouldNotify) return false;

  if (data.status === 'completed' && data.summary === SILENT_COMPLETION_SUMMARY) {
    return false;
  }

  return true;
}

type StartServerOptions = {
  anthropicApiKey?: string;
};

export function startServer(config: ServerConfig, options?: StartServerOptions): ServerInstance {
  validateNetworkExposure(config.host, config.apiKey);

  const startedAt = new Date().toISOString();
  const serverId = `${hostname()}-${process.pid}`;
  const panelClient = createPanelClient(config);

  const store = new RunStore();
  const interactionStore = new InteractionStore();
  const conversationStore = new ConversationStore();
  const channelDispatcher = new ChannelDispatcher();
  const port = config.port;

  const executorRegistry = new ExecutorRegistry();
  executorRegistry.register('claude-code', executeAgent);
  executorRegistry.setDefault('claude-code');

  const activeControllers = new Map<string, AbortController>();
  // Resolvers that fire when the reporter wrapper observes a terminal event
  // for a run. Used by shutdown() to wait until the panel has been notified.
  const terminalWaiters = new Map<string, Promise<void>>();
  const terminalResolvers = new Map<string, () => void>();
  const broadcaster = new ProgressBroadcaster();
  let wsClientCount = 0;

  // ---------------------------------------------------------------------------
  // Panel SSE wiring (run triggers + decision resolutions + schedule sync)
  //
  // When panelUrl + panelApiKey are both configured we open a persistent SSE
  // connection to the panel. This receives:
  //   - run_trigger events (manual panel-initiated runs)
  //   - decision_resolved events (resume paused runs)
  //   - agent_file_poke events (panel asks us to resync the agent catalog)
  //
  // ScheduleSync keeps the panel's view of each agent's next_run_at current.
  // TriggerHandler bridges run_trigger events into the local triggerRun path
  // so concurrency caps and RunStore bookkeeping stay consistent.
  // ---------------------------------------------------------------------------
  const panelConfigured = Boolean(config.panelUrl && config.panelApiKey);
  const scheduleSync = panelConfigured
    ? new ScheduleSync({
        agentsDir: config.agentsDir,
        panelUrl: config.panelUrl!,
        panelApiKey: config.panelApiKey!,
      })
    : undefined;
  const sseClient = panelConfigured
    ? new SseClient({
        panelUrl: config.panelUrl!,
        panelApiKey: config.panelApiKey!,
        cursorPath: join(homedir(), '.agent-server', 'sse-cursor'),
      })
    : undefined;

  function buildDecisionContext(runId: string): DecisionContext | undefined {
    if (!sseClient || !config.panelUrl || !config.panelApiKey) return undefined;
    return {
      runId,
      panelUrl: config.panelUrl,
      panelApiKey: config.panelApiKey,
      eventBus: sseClient.events,
      conversationDir: join(homedir(), '.agent-server', 'runs'),
    };
  }

  async function handleInteractionResult(
    runId: string,
    agent: AgentConfig,
    interaction: InteractionRequest,
  ): Promise<void> {
    if (!agent.interaction) return;

    const interactionId = randomUUID();
    const timeoutMs = parseDuration(agent.interaction.timeout, DEFAULT_INTERACTION_TIMEOUT_MS);

    interactionStore.add({
      id: interactionId,
      runId,
      agentId: agent.id,
      replyAgentId: agent.interaction.on_reply,
      request: interaction,
      channel: agent.interaction.channel,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + timeoutMs),
    });

    await channelDispatcher.dispatch(interactionId, agent.interaction.channel, interaction);
  }

  function sendNotification(agent: AgentConfig, runId: string, data: Omit<NotificationData, 'agentName'>): void {
    if (!shouldDispatchNotification(agent, data)) return;
    if (!agent.notification) return;

    const storedRun = store.get(runId);
    const notificationData: NotificationData = {
      agentName: agent.name,
      ...data,
      turnCount: data.turnCount ?? storedRun?.turnCount,
      toolsUsed: data.toolsUsed ?? storedRun?.toolsUsed,
      filesWritten: data.filesWritten ?? storedRun?.filesWritten,
      durationMs: storedRun?.startedAt
        ? Date.now() - storedRun.startedAt.getTime()
        : undefined,
    };

    channelDispatcher.notify(agent.notification.channel, notificationData)
      .catch((err) => console.error(`[notification] Failed for ${agent.id}:`, err));
  }

  async function fireDownstreamTriggers(sourceAgentId: string, status: 'completed' | 'failed'): Promise<void> {
    try {
      const agents = await discoverAgents(config.agentsDir);
      const downstream = evaluateTriggers(agents, sourceAgentId, status);
      for (const agent of downstream) {
        console.log(`[triggers] ${status} ${sourceAgentId} -> triggering ${agent.id}`);
        triggerRunForAgent(agent);
      }
    } catch (err) {
      console.error(`[triggers] Failed to evaluate triggers for ${sourceAgentId}:`, err);
    }
  }

  type RunDoneCallback = (result: { status: 'completed' | 'failed'; summary?: string; error?: string }) => void;

  type TriggerRunOptions = {
    promptSuffix?: string;
    onDone?: RunDoneCallback;
    conversationId?: string;
  };

  function triggerRunForAgent(agent: AgentConfig, optionsOrSuffix?: string | TriggerRunOptions, onDoneArg?: RunDoneCallback): string {
    const opts: TriggerRunOptions = typeof optionsOrSuffix === 'string'
      ? { promptSuffix: optionsOrSuffix, onDone: onDoneArg }
      : optionsOrSuffix ?? {};
    const { promptSuffix, onDone, conversationId } = opts;
    if (activeControllers.size >= config.maxConcurrentRuns) {
      throw new Error('Too many active runs. Please retry later.');
    }

    const runId = randomUUID();
    const abortController = new AbortController();
    activeControllers.set(runId, abortController);
    terminalWaiters.set(runId, new Promise<void>((resolve) => {
      terminalResolvers.set(runId, resolve);
    }));

    const now = new Date();
    store.add({
      runId,
      agentId: agent.id,
      agentName: agent.name,
      status: 'running',
      startedAt: now,
      turnCount: 0,
      toolsUsed: [],
      filesRead: [],
      filesWritten: [],
      commandsRun: [],
      progressMessages: [],
      conversationId,
    });

    broadcaster.emit(sanitizeProgressEvent({
      type: 'run_started',
      runId,
      agentId: agent.id,
      timestamp: now.toISOString(),
    }));

    runAgent({
      agent,
      lockDir: config.lockDir,
      buildDecisionContext,
      execute: async (a, reporter) => {
        // The Claude Code executor publishes mcp_servers on most progress
        // events. Without dedup, every turn would re-broadcast the same
        // needs-auth list, firing a duplicate mcp_status notification on
        // every tick until the user re-authenticates. Track the last-sent
        // set per run and only broadcast on change.
        let lastNeedsAuthKey: string | null = null;
        const wrappedReporter: Reporter = {
          start: () => reporter.start(),
          progress: (msg, meta) => {
            store.addProgress(runId, msg);
            if (meta) {
              const rawTools = meta.tools_used;
              const toolsUsed = Array.isArray(rawTools)
                ? rawTools.filter((t): t is string => typeof t === 'string')
                : [];
              store.update(runId, {
                turnCount: typeof meta.turns_completed === 'number' ? meta.turns_completed : 0,
                toolsUsed,
              });
            }
            broadcaster.emit(sanitizeProgressEvent({
              type: 'run_progress',
              runId,
              agentId: agent.id,
              message: msg,
              metadata: meta,
              timestamp: new Date().toISOString(),
            }));

            const mcpNeedsAuth = extractMcpNeedsAuthServers(meta);
            if (mcpNeedsAuth.length > 0) {
              const key = [...mcpNeedsAuth].sort().join('|');
              if (key !== lastNeedsAuthKey) {
                lastNeedsAuthKey = key;
                broadcaster.emit(sanitizeProgressEvent({
                  type: 'mcp_status',
                  runId,
                  agentId: agent.id,
                  mcp_needs_auth_servers: mcpNeedsAuth,
                  timestamp: new Date().toISOString(),
                }));
              }
            }

            return reporter.progress(msg, meta);
          },
          complete: (result) => reporter.complete(result),
          fail: (error) => reporter.fail(error),
          stop: () => reporter.stop(),
        };
        const executor = executorRegistry.resolve(a);
        const result = await executor(a, wrappedReporter, { abortController });
        // Pull token / cost telemetry from ExecutionResult.usage so the
        // local server's /runs response can render duration and cost in the
        // macOS app without round-tripping through the panel.
        const usage = (result.usage ?? {}) as Record<string, unknown>;
        const coerceNumber = (value: unknown): number | undefined =>
          typeof value === 'number' && Number.isFinite(value) ? value : undefined;
        store.update(runId, {
          status: 'completed',
          completedAt: new Date(),
          summary: result.summary,
          turnCount: result.turnCount,
          toolsUsed: result.toolsUsed,
          filesRead: result.filesRead,
          filesWritten: result.filesWritten,
          commandsRun: result.commandsRun,
          durationMs: coerceNumber(result.durationMs) ?? coerceNumber(usage.duration_ms),
          estimatedCostUsd: coerceNumber(usage.estimated_cost_usd),
          inputTokens: coerceNumber(usage.input_tokens),
          outputTokens: coerceNumber(usage.output_tokens),
          model: typeof result.model === 'string' ? result.model : undefined,
        });
        if (result.interaction && agent.interaction) {
          void handleInteractionResult(runId, agent, result.interaction);
        }
        broadcaster.emit(sanitizeProgressEvent({
          type: 'run_completed',
          runId,
          agentId: agent.id,
          summary: result.summary,
          timestamp: new Date().toISOString(),
        }));
        sendNotification(agent, runId, {
          status: 'completed',
          summary: result.summary,
          turnCount: result.turnCount,
          toolsUsed: result.toolsUsed,
          filesWritten: result.filesWritten,
        });
        onDone?.({ status: 'completed', summary: result.summary });
        void fireDownstreamTriggers(agent.id, 'completed');
        return result;
      },
      createReporter: (rid, name, convId) => createReporter(config, rid, name, {
        serverId,
        conversationId: convId ?? conversationId,
        agentTelemetry: agent.telemetry,
      }),
      promptSuffix,
      timeoutMs: resolveRunTimeoutMs(agent, config),
      abortController,
    }).then((result) => {
      if (result.status === 'skipped') {
        store.update(runId, {
          status: 'skipped',
          completedAt: new Date(),
        });
        return;
      }
      if (result.status === 'failed') {
        emitRunFailure(result.error ?? 'Unknown error', result.code);
      }
    }).catch((err) => {
      const errorMsg = err instanceof Error ? err.message : String(err);
      emitRunFailure(errorMsg);
    }).finally(() => {
      // Cleanup bookkeeping on every terminal path — success, failure, throw.
      activeControllers.delete(runId);
      terminalResolvers.get(runId)?.();
      terminalResolvers.delete(runId);
      terminalWaiters.delete(runId);
    });

    // Shared failure-emit used by both the `.then()` branch (runner returned a
    // failed result) and `.catch()` branch (runner threw). Centralizing
    // eliminates drift between the two paths.
    function emitRunFailure(errorMsg: string, code?: string): void {
      store.update(runId, {
        status: 'failed',
        completedAt: new Date(),
        error: errorMsg,
      });
      broadcaster.emit(sanitizeProgressEvent({
        type: 'run_failed',
        runId,
        agentId: agent.id,
        error: errorMsg,
        code,
        timestamp: new Date().toISOString(),
      }));
      sendNotification(agent, runId, { status: 'failed', error: errorMsg });
      onDone?.({ status: 'failed', error: errorMsg });
      void fireDownstreamTriggers(agent.id, 'failed');
    }

    return runId;
  }

  async function triggerRun(agentId: string, promptSuffix?: string): Promise<string> {
    const agents = await discoverAgents(config.agentsDir);
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    return triggerRunForAgent(agent, promptSuffix);
  }

  function cancelRun(runId: string): boolean {
    const controller = activeControllers.get(runId);
    if (!controller) return false;

    // Abort only — the runner's finally block invokes reporter.cancel(),
    // which posts the canonical `canceled` state to the panel. The `.then()`
    // continuation then updates the local RunStore. Writing `failed` here
    // would double-write and report a different status than the panel sees.
    controller.abort();
    return true;
  }

  let lastCheckedAt = new Date();
  const SLEEP_GAP_MULTIPLIER = 2;

  async function runDueAgents(): Promise<void> {
    const agents = await discoverAgents(config.agentsDir);
    const now = new Date();

    if (config.catchUp) {
      const gap = now.getTime() - lastCheckedAt.getTime();
      if (gap > SLEEP_GAP_MULTIPLIER * config.checkIntervalMs) {
        console.log(`[catch-up] Detected sleep gap of ${Math.round(gap / 1000)}s, checking for missed agents`);
        const missedAgents = agents.filter((agent) => hasMissedRun(agent, lastCheckedAt, now));
        for (const agent of missedAgents) {
          try {
            console.log(`[catch-up] Triggering missed agent: ${agent.id}`);
            triggerRunForAgent(agent);
          } catch (err) {
            console.error(`[catch-up] ${agent.id}: error - ${err}`);
          }
        }
      }
    }

    lastCheckedAt = now;

    const dueAgents = agents.filter((agent) => shouldRun(agent, now));
    if (dueAgents.length === 0) return;

    console.log(`[${now.toISOString()}] ${dueAgents.length} agent(s) due: ${dueAgents.map((a) => a.id).join(', ')}`);

    for (const agent of dueAgents) {
      try {
        triggerRunForAgent(agent);
      } catch (err) {
        console.error(`  ${agent.id}: error - ${err}`);
      }
    }
  }

  const app = createApi({
    getAgents: () => discoverAgents(config.agentsDir),
    store,
    triggerRun,
    cancelRun,
    cleanupFn: panelClient
      ? () => panelClient.failOrphanedRuns(serverId)
      : undefined,
    apiKey: config.apiKey,
    startedAt,
    host: config.host,
  });

  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  app.get('/ws', upgradeWebSocket((c) => {
    let listener: ((event: ProgressEvent) => void) | undefined;

    // When an API key is configured, require it on WebSocket upgrade too.
    // Browsers cannot set custom headers on the WS handshake, so accept the
    // key either via `Authorization: Bearer …` / `x-agent-server-key` (for
    // native clients) or a `?key=` query string (for browsers).
    const configuredKey = config.apiKey?.trim();
    const headerKey =
      c.req.header('authorization')?.replace(/^Bearer\s+/i, '').trim() ||
      c.req.header('x-agent-server-key')?.trim();
    const queryKey = c.req.query('key')?.trim();
    const providedKey = headerKey || queryKey;
    const authOk = !configuredKey || providedKey === configuredKey;

    return {
      onOpen(event, ws) {
        if (!authOk) {
          ws.close(1008, 'Unauthorized');
          return;
        }

        const origin = (event as { req?: { raw?: Request } })?.req?.raw?.headers.get('origin');
        if (!isAllowedOrigin(origin ?? undefined, config.host)) {
          ws.close(1008, 'Origin not allowed');
          return;
        }

        if (wsClientCount >= config.maxWebSocketClients) {
          ws.close(1013, 'Server busy');
          return;
        }

        wsClientCount += 1;
        listener = (progressEvent: ProgressEvent) => {
          ws.send(JSON.stringify(sanitizeProgressEvent(progressEvent)));
        };
        broadcaster.subscribe(listener);
      },
      onClose() {
        if (listener) {
          broadcaster.unsubscribe(listener);
          listener = undefined;
        }
        if (wsClientCount > 0) wsClientCount -= 1;
      },
      onError(err) {
        console.error('[ws] connection error:', sanitizeText(String(err), 300));
      },
    };
  }));

  const httpServer = serve({ fetch: app.fetch, port, hostname: config.host });
  injectWebSocket(httpServer);
  console.log(`Agent Server API listening on http://${config.host}:${port}`);

  if (panelClient) {
    void panelClient.failOrphanedRuns(serverId)
      .then((cleaned) => {
        if (cleaned > 0) {
          console.log(`[startup] Cleaned up ${cleaned} orphaned run(s) from previous server instance`);
        }
      })
      .catch((err) => {
        console.warn(`[startup] Failed to clean up orphaned runs: ${sanitizeText(String(err), 300)}`);
      });
  }

  // Drain any terminal events that never reached the panel during a prior
  // daemon lifetime (network blip, crash, forced shutdown). Without this,
  // runs completed by the last daemon will sit as `working` on the panel
  // until the stale-sweep reclassifies them as failed.
  const replayKey = config.panelApiKey;
  const runReplay = (): void => {
    replayPendingTerminals({ getApiKey: () => replayKey, panelUrl: config.panelUrl })
      .catch((err) => {
        console.warn(`[replay] pending-terminal replay failed: ${sanitizeText(String(err), 300)}`);
      });
  };
  if (replayKey) {
    runReplay();
  }
  const pendingReplayInterval = replayKey
    ? setInterval(runReplay, PENDING_REPLAY_INTERVAL_MS)
    : null;

  // Bridge panel SSE run_trigger events into the local triggerRun path so
  // the concurrency cap, RunStore, and activeControllers bookkeeping stay
  // consistent with the scheduler-driven and HTTP-API-driven paths.
  const triggerHandler = panelConfigured && sseClient
    ? new TriggerHandler({
        agentsDir: config.agentsDir,
        panelUrl: config.panelUrl!,
        panelApiKey: config.panelApiKey!,
        sseEvents: sseClient.events,
        invokeRun: async ({ agent, promptSuffix, onRunStart }) => {
          try {
            const runId = triggerRunForAgent(agent, { promptSuffix });
            await onRunStart(runId);
            // TriggerHandler expects to report a terminal state to the panel
            // after invokeRun resolves; wait for this run's terminal waiter.
            await terminalWaiters.get(runId);
            const stored = store.get(runId);
            if (!stored) return { status: 'failed', error: 'run record disappeared' };
            if (stored.status === 'completed') return { runId, status: 'completed' };
            return { runId, status: 'failed', error: stored.error };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { status: 'failed', error: message };
          }
        },
      })
    : undefined;

  // Seed the in-memory RunStore from the panel so the macOS app's Feed /
  // Artifacts cards are populated on daemon restart. We don't block on this:
  // start the scheduler after the seed finishes OR a 2-second timeout, so a
  // slow or offline panel doesn't delay daemon readiness.
  const SEED_TIMEOUT_MS = 2_000;
  const seedPromise: Promise<void> = panelClient
    ? seedRunStoreFromPanel({ panelClient, store })
        .then((result) => {
          console.log(
            `[seed] Seeded RunStore from panel: inserted=${result.inserted}, skipped=${result.skipped}, fetched=${result.fetched}`,
          );
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[seed] Failed to seed RunStore from panel: ${message}`);
        })
    : Promise.resolve();

  const seedOrTimeout = Promise.race([
    seedPromise,
    new Promise<void>((resolve) => setTimeout(resolve, SEED_TIMEOUT_MS)),
  ]);

  let interval: NodeJS.Timeout | undefined;

  void seedOrTimeout.then(() => {
    if (scheduleSync) void scheduleSync.start();
    if (triggerHandler) triggerHandler.start();
    if (sseClient) void sseClient.start();

    void runDueAgents();
    interval = setInterval(() => {
      void runDueAgents();
    }, config.checkIntervalMs);
  });

  async function setupFileWatchers(): Promise<FileWatcher | null> {
    const agents = await discoverAgents(config.agentsDir);
    const watchConfigs = extractWatchConfigs(agents);
    if (watchConfigs.length === 0) return null;

    console.log(`  File watches: ${watchConfigs.length} path(s)`);
    const watcher = new FileWatcher({
      watches: watchConfigs,
      onChange: (agentId, filePath) => {
        console.log(`[file-watch] ${filePath} changed, triggering ${agentId}`);
        void triggerRun(agentId).catch((err) => {
          console.error(`[file-watch] Failed to trigger ${agentId}: ${err}`);
        });
      },
    });
    watcher.start();
    return watcher;
  }

  const fileWatcherPromise = setupFileWatchers();

  async function setupTelegram(): Promise<void> {
    if (!config.telegramBotToken) {
      console.log('Telegram bot disabled (no AGENT_SERVER_TELEGRAM_BOT_TOKEN set)');
      return;
    }

    const chatIdPath = join(config.agentsDir, '..', 'telegram.json');
    const telegramChannel = await createTelegramChannel({
      botToken: config.telegramBotToken,
      chatIdPath,
      allowedChatId: config.telegramAllowedChatId,
    });

    telegramChannel.onReply((reply) => {
      const interaction = interactionStore.get(reply.interactionId);
      if (!interaction || interaction.status !== 'pending') return;

      interactionStore.markActed(reply.interactionId);
      const promptSuffix = reply.selectedValue ?? reply.freeText;
      if (!promptSuffix) return;

      console.log(`[telegram] Reply for ${interaction.agentId}, triggering ${interaction.replyAgentId}`);
      void triggerRun(interaction.replyAgentId, promptSuffix).catch((err) => {
        console.error(`[telegram] Failed to trigger ${interaction.replyAgentId}: ${err}`);
      });
    });

    telegramChannel.onMessage((text) => {
      void (async () => {
        try {
          const chatId = telegramChannel.getChatId();
          if (!chatId) return;

          const activeConv = conversationStore.findActiveByChat(chatId);
          if (activeConv) {
            const agents = await discoverAgents(config.agentsDir);
            const agent = agents.find((a) => a.id === activeConv.agentId);
            if (!agent) {
              conversationStore.expire(activeConv.id);
              await telegramChannel.notifyText('Conversation expired (agent not found).');
              return;
            }

            conversationStore.addMessage(activeConv.id, 'user', text);
            const history = formatConversationHistory(activeConv.messages.concat([{ role: 'user', content: text, createdAt: new Date() }]));
            const contextSuffix = `${history}\n\nUser's latest message: ${text}`;

            await telegramChannel.notifyText(`Running ${agent.name}...`);

            triggerRunForAgent(agent, {
              promptSuffix: contextSuffix,
              conversationId: activeConv.id,
              onDone: (done) => {
                if (done.status === 'completed' && done.summary) {
                  conversationStore.addMessage(activeConv.id, 'assistant', done.summary);
                }
                const data: NotificationData = done.status === 'completed'
                  ? { agentName: agent.name, status: 'completed', summary: done.summary }
                  : { agentName: agent.name, status: 'failed', error: done.error };
                if (shouldSendTelegramRunNotification(agent, done.status)) {
                  void telegramChannel.notify(data);
                }
              },
            });
            return;
          }

          const agents = await discoverAgents(config.agentsDir);
          const result = await routeMessage(text, agents, { apiKey: options?.anthropicApiKey });

          if (result.type === 'list') {
            await telegramChannel.notifyText(formatAgentListMessage(agents));
            return;
          }

          if (result.type === 'none') {
            await telegramChannel.notifyText('No matching agent found for your message.');
            return;
          }

          const { agent } = result;
          const isConversational = agent.conversation?.enabled === true;
          let convId: string | undefined;

          if (isConversational) {
            const ttlMs = parseDuration(agent.conversation?.ttl, DEFAULT_CONVERSATION_TTL_MS);
            const conv = conversationStore.create(chatId, agent.id, ttlMs);
            convId = conv.id;
            conversationStore.addMessage(conv.id, 'user', text);
          }

          await telegramChannel.notifyText(`Running ${agent.name}...`);

          triggerRunForAgent(agent, {
            promptSuffix: result.context,
            conversationId: convId,
            onDone: (done) => {
              if (convId && done.status === 'completed' && done.summary) {
                conversationStore.addMessage(convId, 'assistant', done.summary);
              }
              const data: NotificationData = done.status === 'completed'
                ? { agentName: agent.name, status: 'completed', summary: done.summary }
                : { agentName: agent.name, status: 'failed', error: done.error };
              if (shouldSendTelegramRunNotification(agent, done.status)) {
                void telegramChannel.notify(data);
              }
            },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[telegram] Message routing failed: ${msg}`);
          void telegramChannel.notifyText(`Error: ${msg}`);
        }
      })();
    });

    channelDispatcher.register(telegramChannel);
    await telegramChannel.start();
    console.log('  Telegram: connected');
  }

  const telegramPromise = setupTelegram();

  const expiryInterval = setInterval(() => {
    const expiredConvs = conversationStore.expireStale();
    if (expiredConvs.length > 0) {
      console.log(`[conversations] Expired ${expiredConvs.length} stale conversation(s)`);
    }

    const expiredIds = interactionStore.expireStale();
    if (expiredIds.length > 0) {
      console.log(`[interactions] Expired ${expiredIds.length} stale interaction(s)`);
      const expiredWithChannels = expiredIds
        .map((id) => {
          const interaction = interactionStore.get(id);
          return interaction ? { id, channel: interaction.channel } : null;
        })
        .filter((item): item is { id: string; channel: string } => item !== null);

      void channelDispatcher.expireInteractions(expiredWithChannels);
    }
  }, 60_000);

  async function drainActiveRuns(): Promise<void> {
    const runIds = [...activeControllers.keys()];
    if (runIds.length === 0) return;

    console.log(`[shutdown] Aborting ${runIds.length} active run(s); draining terminals`);
    for (const [, controller] of activeControllers) {
      try { controller.abort(); } catch { /* ignore */ }
    }

    const waiters = runIds
      .map((id) => terminalWaiters.get(id))
      .filter((p): p is Promise<void> => Boolean(p));

    const perRun = waiters.map((p) => Promise.race([
      p,
      new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_PER_RUN_TIMEOUT_MS)),
    ]));

    await Promise.race([
      Promise.all(perRun),
      new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_DRAIN_TIMEOUT_MS)),
    ]);
  }

  return {
    stop: async () => {
      if (interval) clearInterval(interval);
      clearInterval(expiryInterval);
      if (pendingReplayInterval) clearInterval(pendingReplayInterval);
      scheduleSync?.stop();
      triggerHandler?.stop();
      sseClient?.stop();
      await drainActiveRuns();
      httpServer.close();
      void fileWatcherPromise.then((w) => w?.stop());
      void telegramPromise.then(() => channelDispatcher.stopAll());
      console.log('Agent Server stopped.');
    },
  };
}
