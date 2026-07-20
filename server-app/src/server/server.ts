import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { hostname, homedir } from 'os';
import { join } from 'path';
import type { ServerConfig } from '../platform/config.js';
import type { AgentConfig } from '../agents/config.js';
import { createApi } from './api.js';
import { discoverAgents } from '../agents/discovery.js';
import { createAgentWriter } from '../agents/writer.js';
import { ConnectionCache } from '../connections/cache.js';
import { ConnectionProfileStore } from '../connections/profile-store.js';
import { createConnectionResolvingExecutor } from '../connections/connection-executor.js';
import { loadEnvFile } from '../platform/config.js';
import type { RunStoreLike } from '../reporting/store.js';
import { RunStore } from '../reporting/store.js';
import { SqliteRunStore } from '../reporting/sqlite-store.js';
import { failOrphanedLocalRuns } from '../reporting/local-reconcile.js';
import { probeMcpServers } from '../plugins/claude-code.js';
import { createDefaultExecutorRegistry } from '../execution/default-executors.js';
import { discoverRuntimePaths } from '../execution/runtime-discovery.js';
import { createReporter } from '../reporting/reporter-factory.js';
import { createPanelClient } from '../reporting/panel-client.js';
import { replayPendingTerminals } from '../reporting/reporter.js';
import { ScheduleSync } from '../reporting/sync-schedule.js';
import { RealtimeClient } from '../reporting/realtime-client.js';
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
import { createSlackChannel } from '../channels/slack.js';
import { formatAgentListMessage, type NotificationData } from '../interaction/notification.js';
import { routeMessage } from '../channels/router.js';
import { randomUUID } from 'crypto';
import { ProgressBroadcaster, type ProgressEvent } from './websocket.js';
import { sanitizeProgressEvent, sanitizeText } from './security-utils.js';
import { parseDuration } from '../agents/duration.js';
import { toErrorMessage } from '../util/errors.js';
import { createAnalysisRuntime } from '../analysis/runtime.js';
import { createGuidanceApi } from '../creation/guidance-api.js';
import { createLocalStructuredModel } from '../creation/local-structured-model.js';
import { createRunPreflightGate } from '../analysis/run-preflight-gate.js';
import { PreflightSkipRecorder } from '../analysis/preflight-skip-recorder.js';
import type { RunTriggerSource } from '../analysis/run-preflight.js';
import { createSafeTestTrigger } from '../creation/safe-test.js';
import {
  createRunLifecycle,
  type TriggerRunOptions,
} from './run-lifecycle.js';
import { buildServiceRegistry } from '../services/registry.js';

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

export { extractMcpNeedsAuthServers } from './run-lifecycle.js';

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

/**
 * Whether an ad-hoc run triggered by a chat message should send its own
 * completion/failure notice on `channelName`. Returns false only when the agent
 * already declares a `notification` block for this same channel that will fire,
 * so we don't double-notify.
 */
export function shouldSendChannelRunNotification(
  agent: AgentConfig,
  status: 'completed' | 'failed',
  channelName: string,
): boolean {
  const notification = agent.notification;
  if (!notification || notification.channel !== channelName) {
    return true;
  }

  if (status === 'completed') {
    return notification.on_complete !== true;
  }

  return notification.on_failure !== true;
}

export function shouldSendTelegramRunNotification(
  agent: AgentConfig,
  status: 'completed' | 'failed',
): boolean {
  return shouldSendChannelRunNotification(agent, status, 'telegram');
}

/**
 * A stable positive integer key for a string channel id (Slack DMs are keyed by
 * string; the conversation store keys by number). djb2 hash — collisions across
 * one user's handful of DMs are not a practical concern.
 */
export function chatKeyFromString(id: string): number {
  let hash = 5381;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) + hash + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
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
  /**
   * Override the run-history store. Defaults to a durable `SqliteRunStore` at
   * `config.runDbPath`. Injected in tests to avoid touching the real database.
   */
  store?: RunStoreLike;
};

/**
 * Build the durable run store, falling back to an in-memory store if SQLite
 * cannot be opened (corrupt file, read-only volume). Run history is valuable
 * but never worth blocking the server from starting, so a failure degrades to
 * ephemeral history with a warning rather than crashing.
 */
function createRunStore(runDbPath: string): RunStoreLike {
  try {
    return new SqliteRunStore({ path: runDbPath });
  } catch (err) {
    const message = toErrorMessage(err);
    console.warn(
      `[runs] Failed to open run database at ${runDbPath}; falling back to in-memory history: ${message}`,
    );
    return new RunStore();
  }
}

export function startServer(config: ServerConfig, options?: StartServerOptions): ServerInstance {
  validateNetworkExposure(config.host, config.apiKey);
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    throw new Error('AGENT_SERVER_API_KEY is required. Run agent-server init to generate one.');
  }

  const startedAt = new Date().toISOString();
  const serverId = `${hostname()}-${process.pid}`;
  const panelClient = createPanelClient(config);

  const store = options?.store ?? createRunStore(config.runDbPath);
  const interactionStore = new InteractionStore();
  const conversationStore = new ConversationStore();
  const channelDispatcher = new ChannelDispatcher();
  const port = config.port;

  const executorRegistry = createDefaultExecutorRegistry();
  const connectionProfileStore = new ConnectionProfileStore(join(config.agentsDir, '..', 'connections.json'));

  // Discover the user's installed Claude Code, Codex, and Kimi Code binaries once at startup so
  // runs use the runtimes (and subscription logins) they already have, falling
  // back to the SDK's bundled runtimes when none is found. Resolved once — a
  // `which` lookup per run would be wasteful.
  const runtimePaths = discoverRuntimePaths();
  if (runtimePaths.claudeExecutablePath) {
    console.log(`  Claude runtime: ${runtimePaths.claudeExecutablePath} (installed)`);
  }
  if (runtimePaths.codexExecutablePath) {
    console.log(`  Codex runtime: ${runtimePaths.codexExecutablePath} (installed)`);
  }
  if (runtimePaths.kimiExecutablePath) {
    console.log(`  Kimi runtime: ${runtimePaths.kimiExecutablePath} (installed)`);
  }

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
  const realtimeClient = panelConfigured
    ? new RealtimeClient({
        panelUrl: config.panelUrl!,
        panelApiKey: config.panelApiKey!,
        cursorPath: join(homedir(), '.agent-server', 'sse-cursor'),
      })
    : undefined;

  function buildDecisionContext(runId: string): DecisionContext | undefined {
    if (!realtimeClient || !config.panelUrl || !config.panelApiKey) return undefined;
    return {
      runId,
      panelUrl: config.panelUrl,
      panelApiKey: config.panelApiKey,
      eventBus: realtimeClient.events,
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
        await checkedTriggerRunForAgent(agent, {}, 'chain');
      }
    } catch (err) {
      console.error(`[triggers] Failed to evaluate triggers for ${sourceAgentId}:`, err);
    }
  }

  const runLifecycle = createRunLifecycle({
    maxConcurrentRuns: config.maxConcurrentRuns,
    lockDir: config.lockDir,
    runTimeoutMs: config.runTimeoutMs,
    store,
    broadcaster,
    execute: createConnectionResolvingExecutor(
      connectionProfileStore,
      (agent) => async (resolvedAgent, reporter, executorOptions) => executorRegistry.resolve(agent)(
        resolvedAgent,
        reporter,
        {
        ...executorOptions,
        claudeExecutablePath: runtimePaths.claudeExecutablePath,
        codexExecutablePath: runtimePaths.codexExecutablePath,
        kimiExecutablePath: runtimePaths.kimiExecutablePath,
        },
      ),
    ),
    createReporter: (runId, name, conversationId, agent) => createReporter(config, runId, name, {
      serverId,
      conversationId,
      agentTelemetry: agent.telemetry,
    }),
    buildDecisionContext,
    resolveTimeoutMs: (agent) => resolveRunTimeoutMs(agent, config),
    notify: sendNotification,
    onInteraction: handleInteractionResult,
    onTerminal: (agent, status) => fireDownstreamTriggers(agent.id, status),
  });

  function triggerRunForAgent(agent: AgentConfig, options: TriggerRunOptions = {}): string {
    return runLifecycle.trigger(agent, options);
  }

  async function triggerRun(
    agentId: string,
    promptSuffix?: string,
    security?: { confirmedContentHash?: string },
  ): Promise<string> {
    const agents = await discoverAgents(config.agentsDir);
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    const runId = await checkedTriggerRunForAgent(
      agent,
      { promptSuffix },
      'manual',
      security?.confirmedContentHash,
    );
    if (!runId) throw new Error('Security review is required before this run.');
    return runId;
  }

  async function triggerAutomaticRun(
    agentId: string,
    promptSuffix: string | undefined,
    source: Exclude<RunTriggerSource, 'manual' | 'safe_test'>,
  ): Promise<string | undefined> {
    const agents = await discoverAgents(config.agentsDir);
    const agent = agents.find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    return checkedTriggerRunForAgent(agent, { promptSuffix }, source);
  }

  async function triggerGuidanceRetry(
    agentId: string,
    metadata: { retryOfRunId: string; repairId?: string; confirmedContentHash?: string },
  ): Promise<string> {
    const agents = await discoverAgents(config.agentsDir);
    const agent = agents.find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    const runId = await checkedTriggerRunForAgent(
      agent,
      { retryOfRunId: metadata.retryOfRunId, repairId: metadata.repairId },
      'manual',
      metadata.confirmedContentHash,
    );
    if (!runId) throw new Error('Security review is required before this retry.');
    return runId;
  }

  const triggerSafeTest = createSafeTestTrigger({
    getAgent: async (agentId) => (await discoverAgents(config.agentsDir))
      .find((agent) => agent.id === agentId),
    triggerAgent: (agent) => triggerRunForAgent(agent, { mode: 'safe_test' }),
  });

  function cancelRun(runId: string): boolean {
    return runLifecycle.cancel(runId);
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
            await checkedTriggerRunForAgent(agent, {}, 'schedule');
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
        await checkedTriggerRunForAgent(agent, {}, 'schedule');
      } catch (err) {
        console.error(`  ${agent.id}: error - ${err}`);
      }
    }
  }

  // App-wide, regenerable cache of the MCP discovery probe. Warmed in the
  // background at boot so the first capability read has connectors populated;
  // the app can force a re-probe via POST /connections/refresh.
  const connectionCache = new ConnectionCache(() => probeMcpServers());
  void connectionCache.refresh().catch(() => {});
  const agentWriter = createAgentWriter(config.agentsDir, {
    connections: () => connectionCache.servers(),
  });
  const guidanceModel = createLocalStructuredModel({
    codexExecutablePath: runtimePaths.codexExecutablePath,
  });
  const analysisRuntime = createAnalysisRuntime({
    agentsDir: config.agentsDir,
    model: guidanceModel,
  });
  const runPreflightGate = createRunPreflightGate<TriggerRunOptions>({
    preflight: (agent) => analysisRuntime.preflight(agent),
    trigger: (agent, triggerOptions) => triggerRunForAgent(agent, triggerOptions),
    skipRecorder: new PreflightSkipRecorder(store),
    onAutomaticSkip: (agent, outcome, runId) => {
      console.warn(`[security] Skipped automatic run for ${agent.id}: ${outcome.message}`);
      broadcaster.emit(sanitizeProgressEvent({
        type: 'run_failed',
        runId,
        agentId: agent.id,
        error: outcome.message,
        code: `security_preflight_${outcome.code}`,
        timestamp: new Date().toISOString(),
      }));
    },
  });

  async function checkedTriggerRunForAgent(
    agent: AgentConfig,
    triggerOptions: TriggerRunOptions,
    source: RunTriggerSource,
    confirmedContentHash?: string,
  ): Promise<string | undefined> {
    return runPreflightGate.run(agent, triggerOptions, { source, confirmedContentHash });
  }
  const getAgents = (): Promise<AgentConfig[]> => discoverAgents(config.agentsDir);
  const guidanceApi = createGuidanceApi({
    model: guidanceModel,
    writer: agentWriter,
    getAgents,
    store,
    security: analysisRuntime.security,
    content: analysisRuntime.content,
    triggerRun: triggerGuidanceRetry,
    getServiceRegistry: async () => buildServiceRegistry({
      agents: await getAgents(),
      environment: loadEnvFile(join(config.agentsDir, '..'), process.env),
      discovered: connectionCache.servers(),
      profiles: await connectionProfileStore.list(),
    }),
  });

  const app = createApi({
    getAgents,
    store,
    triggerRun,
    triggerSafeTest,
    preflightRun: async (agentId) => {
      const agent = (await getAgents()).find((candidate) => candidate.id === agentId);
      if (!agent) throw new Error(`Agent not found: ${agentId}`);
      return analysisRuntime.preflight(agent);
    },
    cancelRun,
    cleanupFn: panelClient
      ? () => panelClient.failOrphanedRuns(serverId)
      : undefined,
    getPendingDecisions: realtimeClient
      ? () => realtimeClient.getPendingDecisions()
      : undefined,
    agentWriter,
    // Fresh .env read per request so keys saved via the app's Connect flow
    // are visible to capability checks without a server restart.
    getEnv: () => loadEnvFile(join(config.agentsDir, '..'), process.env),
    connections: {
      get: () => connectionCache.get(),
      refresh: () => connectionCache.refresh(),
    },
    connectionProfiles: connectionProfileStore,
    apiKey,
    startedAt,
    host: config.host,
    analysisApi: analysisRuntime.api,
    guidanceApi,
  });

  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  app.get('/ws', upgradeWebSocket(() => {
    let listener: ((event: ProgressEvent) => void) | undefined;

    return {
      onOpen(event, ws) {
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

  // Local ghost-run cleanup. A fresh process owns no in-flight runs, so any run
  // left `running` in the durable store belongs to a previous instance that was
  // killed mid-run. Fail them locally so the macOS app never shows a run
  // "working" forever. This needs no panel — the server owns its own runs.
  const orphaned = failOrphanedLocalRuns(store);
  if (orphaned.length > 0) {
    console.log(`[startup] Failed ${orphaned.length} local run(s) left in progress by a previous server instance`);
  }

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

  // Bridge panel SSE run_trigger events into the local trigger path so the
  // concurrency cap, run history, and lifecycle bookkeeping stay consistent
  // with scheduler-driven and HTTP-API-driven runs.
  const triggerHandler = realtimeClient
    ? new TriggerHandler({
        agentsDir: config.agentsDir,
        panelUrl: config.panelUrl!,
        panelApiKey: config.panelApiKey!,
        sseEvents: realtimeClient.events,
        invokeRun: async ({ agent, promptSuffix, onRunStart }) => {
          try {
            const runId = await checkedTriggerRunForAgent(agent, { promptSuffix }, 'panel');
            if (!runId) {
              return { status: 'skipped', error: 'Security review is required before this panel run.' };
            }
            await onRunStart(runId);
            // TriggerHandler expects to report a terminal state to the panel
            // after invokeRun resolves; wait for this run's terminal waiter.
            await runLifecycle.waitForTerminal(runId);
            const stored = store.get(runId);
            if (!stored) return { status: 'failed', error: 'run record disappeared' };
            if (stored.status === 'completed') return { runId, status: 'completed' };
            return { runId, status: 'failed', error: stored.error };
          } catch (err) {
            const message = toErrorMessage(err);
            return { status: 'failed', error: message };
          }
        },
      })
    : undefined;

  // Run history lives in the durable local SQLite store, so there is nothing to
  // seed from the panel on boot and no seed to wait on — the scheduler starts
  // immediately. When a panel is configured, ScheduleSync / RealtimeClient /
  // TriggerHandler still run as optional, config-gated integrations.
  if (scheduleSync) void scheduleSync.start();
  if (triggerHandler) triggerHandler.start();
  if (realtimeClient) void realtimeClient.start();

  void runDueAgents();
  const interval: NodeJS.Timeout = setInterval(() => {
    void runDueAgents();
  }, config.checkIntervalMs);

  async function setupFileWatchers(): Promise<FileWatcher | null> {
    const agents = await discoverAgents(config.agentsDir);
    const watchConfigs = extractWatchConfigs(agents);
    if (watchConfigs.length === 0) return null;

    console.log(`  File watches: ${watchConfigs.length} path(s)`);
    const watcher = new FileWatcher({
      watches: watchConfigs,
      onChange: (agentId, filePath) => {
        console.log(`[file-watch] ${filePath} changed, triggering ${agentId}`);
        void triggerAutomaticRun(agentId, undefined, 'watcher').catch((err) => {
          console.error(`[file-watch] Failed to trigger ${agentId}: ${err}`);
        });
      },
    });
    watcher.start();
    return watcher;
  }

  const fileWatcherPromise = setupFileWatchers();

  // Where a chat message routes to. Shared by Telegram and Slack so both drive
  // the same conversation/routing/notification flow; only the transport differs.
  type ChatChannelSink = {
    channelName: 'slack' | 'telegram';
    chatKey: number;
    notifyText: (msg: string) => Promise<unknown>;
    notify: (data: NotificationData) => Promise<unknown>;
  };

  async function handleChannelMessage(text: string, sink: ChatChannelSink): Promise<void> {
    try {
      const activeConv = conversationStore.findActiveByChat(sink.chatKey);
      if (activeConv) {
        const agents = await discoverAgents(config.agentsDir);
        const agent = agents.find((a) => a.id === activeConv.agentId);
        if (!agent) {
          conversationStore.expire(activeConv.id);
          await sink.notifyText('Conversation expired (agent not found).');
          return;
        }

        conversationStore.addMessage(activeConv.id, 'user', text);
        const history = formatConversationHistory(activeConv.messages.concat([{ role: 'user', content: text, createdAt: new Date() }]));
        const contextSuffix = `${history}\n\nUser's latest message: ${text}`;

        const runId = await checkedTriggerRunForAgent(agent, {
          promptSuffix: contextSuffix,
          conversationId: activeConv.id,
          conversationChannel: sink.channelName,
          onDone: (done) => {
            if (done.status === 'completed' && done.summary) {
              conversationStore.addMessage(activeConv.id, 'assistant', done.summary);
            }
            const data: NotificationData = done.status === 'completed'
              ? { agentName: agent.name, status: 'completed', summary: done.summary }
              : { agentName: agent.name, status: 'failed', error: done.error };
            if (shouldSendChannelRunNotification(agent, done.status, sink.channelName)) {
              void sink.notify(data);
            }
          },
        }, 'channel');
        if (!runId) {
          await sink.notifyText('Security review is required before this agent can run from messages.');
          return;
        }
        await sink.notifyText(`Running ${agent.name}...`);
        return;
      }

      const agents = await discoverAgents(config.agentsDir);
      const result = await routeMessage(text, agents, { apiKey: options?.anthropicApiKey });

      if (result.type === 'list') {
        await sink.notifyText(formatAgentListMessage(agents));
        return;
      }

      if (result.type === 'none') {
        await sink.notifyText('No matching agent found for your message.');
        return;
      }

      const { agent } = result;
      let convId: string | undefined;

      if (agent.conversation?.enabled === true) {
        const ttlMs = parseDuration(agent.conversation?.ttl, DEFAULT_CONVERSATION_TTL_MS);
        const conv = conversationStore.create(sink.chatKey, agent.id, ttlMs);
        convId = conv.id;
        conversationStore.addMessage(conv.id, 'user', text);
      }

      const runId = await checkedTriggerRunForAgent(agent, {
        promptSuffix: result.context,
        conversationId: convId,
        conversationChannel: convId ? sink.channelName : undefined,
        onDone: (done) => {
          if (convId && done.status === 'completed' && done.summary) {
            conversationStore.addMessage(convId, 'assistant', done.summary);
          }
          const data: NotificationData = done.status === 'completed'
            ? { agentName: agent.name, status: 'completed', summary: done.summary }
            : { agentName: agent.name, status: 'failed', error: done.error };
          if (shouldSendChannelRunNotification(agent, done.status, sink.channelName)) {
            void sink.notify(data);
          }
        },
      }, 'channel');
      if (!runId) {
        await sink.notifyText('Security review is required before this agent can run from messages.');
        return;
      }
      await sink.notifyText(`Running ${agent.name}...`);
    } catch (err) {
      const msg = toErrorMessage(err);
      console.error(`[${sink.channelName}] Message routing failed: ${msg}`);
      void sink.notifyText(`Error: ${msg}`);
    }
  }

  // Route an interaction reply (button tap / free text) to the on_reply agent.
  function handleInteractionReply(channelName: string, reply: { interactionId: string; selectedValue?: string; freeText?: string }): void {
    const interaction = interactionStore.get(reply.interactionId);
    if (!interaction || interaction.status !== 'pending') return;

    interactionStore.markActed(reply.interactionId);
    const promptSuffix = reply.selectedValue ?? reply.freeText;
    if (!promptSuffix) return;

    console.log(`[${channelName}] Reply for ${interaction.agentId}, triggering ${interaction.replyAgentId}`);
    void triggerAutomaticRun(interaction.replyAgentId, promptSuffix, 'interaction').catch((err) => {
      console.error(`[${channelName}] Failed to trigger ${interaction.replyAgentId}: ${err}`);
    });
  }

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

    telegramChannel.onReply((reply) => handleInteractionReply('telegram', reply));

    telegramChannel.onMessage((text) => {
      const chatId = telegramChannel.getChatId();
      if (!chatId) return;
      void handleChannelMessage(text, {
        channelName: 'telegram',
        chatKey: chatId,
        notifyText: (m) => telegramChannel.notifyText(m),
        notify: (d) => telegramChannel.notify(d),
      });
    });

    channelDispatcher.register(telegramChannel);
    await telegramChannel.start();
    console.log('  Telegram: connected');
  }

  async function setupSlack(): Promise<void> {
    if (!config.slackBotToken || !config.slackAppToken) {
      console.log('Slack bot disabled (set AGENT_SERVER_SLACK_BOT_TOKEN and AGENT_SERVER_SLACK_APP_TOKEN to enable)');
      return;
    }

    const channelIdPath = join(config.agentsDir, '..', 'slack.json');
    const slackChannel = await createSlackChannel({
      botToken: config.slackBotToken,
      appToken: config.slackAppToken,
      channelIdPath,
    });

    slackChannel.onReply((reply) => handleInteractionReply('slack', reply));

    slackChannel.onMessage((text) => {
      const channelId = slackChannel.getChannelId();
      if (!channelId) return;
      void handleChannelMessage(text, {
        channelName: 'slack',
        chatKey: chatKeyFromString(channelId),
        notifyText: (m) => slackChannel.notifyText(m),
        notify: (d) => slackChannel.notify(d),
      });
    });

    channelDispatcher.register(slackChannel);
    await slackChannel.start();
    console.log('  Slack: connected');
  }

  const telegramPromise = setupTelegram();
  const slackPromise = setupSlack();

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

  return {
    stop: async () => {
      if (interval) clearInterval(interval);
      clearInterval(expiryInterval);
      if (pendingReplayInterval) clearInterval(pendingReplayInterval);
      scheduleSync?.stop();
      triggerHandler?.stop();
      realtimeClient?.stop();
      await runLifecycle.drain({
        overallTimeoutMs: SHUTDOWN_DRAIN_TIMEOUT_MS,
        perRunTimeoutMs: SHUTDOWN_PER_RUN_TIMEOUT_MS,
      });
      httpServer.close();
      void fileWatcherPromise.then((w) => w?.stop());
      // Wait for both channel setups to finish registering before stopping all.
      void Promise.allSettled([telegramPromise, slackPromise]).then(() => channelDispatcher.stopAll());
      store.close();
      analysisRuntime.close();
      console.log('Agent Server stopped.');
    },
  };
}
