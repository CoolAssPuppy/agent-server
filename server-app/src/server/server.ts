import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { homedir } from 'os';
import { join } from 'path';
import { accessSync, constants } from 'fs';
import type { ServerConfig } from '../platform/config.js';
import type { AgentConfig } from '../agents/config.js';
import { createApi } from './api.js';
import { discoverAgents } from '../agents/discovery.js';
import { createAgentWriter } from '../agents/writer.js';
import { RuntimeAssignmentStore } from '../agents/runtime-assignment-store.js';
import { applyRuntimeAssignment } from '../agents/runtime-assignment-resolution.js';
import { AgentBindingStore } from '../agents/agent-binding-store.js';
import { ConnectionCache } from '../connections/cache.js';
import { ConnectionProfileStore } from '../connections/profile-store.js';
import { ConnectionCapabilityStore } from '../connections/capability-store.js';
import { ConnectionOperationBindingStore } from '../connections/operation-binding-store.js';
import { probeStoredMcpCapabilities } from '../connections/capability-probe.js';
import { createConnectionResolvingExecutor } from '../connections/connection-executor.js';
import {
  discoverCodexMcpInventory,
  discoverKimiMcpInventory,
  runtimeConnectionInventory,
} from '../connections/runtime-mcp-inventory.js';
import { loadEnvFile } from '../platform/config.js';
import { createAgentLogStore } from '../logging/index.js';
import type { RunStoreLike } from '../reporting/store.js';
import { RunStore } from '../reporting/store.js';
import { SqliteRunStore } from '../reporting/sqlite-store.js';
import { failOrphanedLocalRuns } from '../reporting/local-reconcile.js';
import { reconcileStaleLocks } from '../execution/lockfile.js';
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
import { AgentFileWatchManager, expandHome } from '../agents/file-watcher.js';
import { ChannelDispatcher } from '../channels/dispatcher.js';
import { InteractionStore } from '../interaction/store.js';
import { ConversationStore } from '../conversation/store.js';
import { formatConversationHistory } from '../conversation/history-formatter.js';
import type { InteractionRequest } from '../interaction/schema.js';
import { createTelegramChannel, type TelegramChannel } from '../channels/telegram.js';
import { createSlackChannel, type SlackChannel } from '../channels/slack.js';
import { formatAgentListMessage, type NotificationData } from '../interaction/notification.js';
import { routeMessage } from '../channels/router.js';
import { randomUUID } from 'crypto';
import { ProgressBroadcaster, type ProgressEvent } from './websocket.js';
import { sanitizeText } from './security-utils.js';
import { parseDuration } from '../agents/duration.js';
import { toErrorMessage } from '../util/errors.js';
import { createAnalysisRuntime } from '../analysis/runtime.js';
import { createGuidanceApi } from '../creation/guidance-api.js';
import { createLocalStructuredModel } from '../creation/local-structured-model.js';
import { createRunPreflightGate } from '../analysis/run-preflight-gate.js';
import { PreflightSkipRecorder } from '../analysis/preflight-skip-recorder.js';
import { evaluateRunPreflight, type RunTriggerSource } from '../analysis/run-preflight.js';
import { createSafeTestTrigger } from '../creation/safe-test.js';
import {
  createRunLifecycle,
  type RunDoneCallback,
  type TriggerRunOptions,
} from './run-lifecycle.js';
import { availableConnections, buildServiceRegistry } from '../services/registry.js';
import { startManagedServices, type ManagedService } from './managed-services.js';
import { createDownstreamTriggerHandler } from './downstream-triggers.js';
import { createNoopAnalytics, type Analytics } from '../analytics/analytics.js';
import { ANALYTICS_EVENTS } from '../analytics/events.js';
import { classifyErrorReason } from '../analytics/reason.js';
import { loadOrCreateMachineId } from '../platform/machine-identity.js';
import { collectAssistantHomeFacts } from '../presentation/assistant-readiness.js';
import { loadPairing, redeemPairingCode, savePairing } from '../platform/pairing.js';
import { PanelHealth } from '../reporting/panel-health.js';
import { AGENT_SERVER_VERSION } from '../version.js';

export type ServerInstance = {
  ready: Promise<void>;
  stop: () => Promise<void>;
};

/**
 * Periodic replay of persisted pending-terminal events. Long-lived daemons
 * that suffer a panel outage will eventually drain the queue without needing
 * a restart.
 */
const PENDING_REPLAY_INTERVAL_MS = 10 * 60 * 1000;

/** Max time to wait for active runs to emit terminals on shutdown. */
const SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;
/** Time for admitted runs to finish naturally before cancellation. */
const SHUTDOWN_RUN_GRACE_TIMEOUT_MS = 8_000;
/** Per-run wait inside the overall drain budget. */
const SHUTDOWN_PER_RUN_TIMEOUT_MS = 3_000;
const MANAGED_SERVICE_START_TIMEOUT_MS = 10_000;
const MANAGED_SERVICE_STOP_TIMEOUT_MS = 10_000;

const DEFAULT_INTERACTION_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_CONVERSATION_TTL_MS = 30 * 60 * 1000;

export async function drainPendingTasks(
  tasks: ReadonlySet<Promise<void>>,
  timeoutMs: number,
): Promise<boolean> {
  if (tasks.size === 0) return true;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    void Promise.allSettled([...tasks]).then(() => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

export {
  extractMcpNeedsAuthServers,
  extractRelevantMcpNeedsAuthServers,
} from './run-lifecycle.js';

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
  status: 'completed' | 'failed' | 'skipped',
  channelName: string,
): boolean {
  if (status === 'skipped') return true;

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
  status: 'completed' | 'failed' | 'skipped',
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
  if (data.status === 'skipped') return false;

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
  /**
   * Anonymous product analytics. Defaults to a no-op so every existing caller
   * and every test keeps working without sending anything.
   */
  analytics?: Analytics;
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

export function startServer(
  config: ServerConfig,
  options?: StartServerOptions,
): ServerInstance {
  validateNetworkExposure(config.host, config.apiKey);
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    throw new Error('AGENT_SERVER_API_KEY is required. Run agent-server init to generate one.');
  }

  const startedAt = new Date().toISOString();
  const machineId = loadOrCreateMachineId(config.workspaceDir);
  const workerId = machineId;
  const panelClient = createPanelClient(config);
  // One tracker for every reporter this server creates. /health reads it, so
  // "Panel has not heard a delivery in an hour" is a fact on screen instead
  // of a log line.
  const panelHealth = new PanelHealth();

  const analytics = options?.analytics ?? createNoopAnalytics();
  const store = options?.store ?? createRunStore(config.runDbPath);
  const reconciledLocks = reconcileStaleLocks(config.lockDir);
  if (reconciledLocks.length > 0) {
    console.log(`[startup] Removed ${reconciledLocks.length} stale lock(s)`);
  }
  const interactionStore = new InteractionStore();
  const conversationStore = new ConversationStore();
  const channelDispatcher = new ChannelDispatcher();
  let slackChannel: SlackChannel | undefined;
  let telegramChannel: TelegramChannel | undefined;
  const port = config.port;
  const backgroundTasks = new Set<Promise<void>>();
  let isStopping = false;

  function startBackgroundTask(
    work: () => Promise<void>,
    onError: (error: unknown) => void,
  ): void {
    if (isStopping) return;
    const task = work()
      .catch(onError)
      .finally(() => backgroundTasks.delete(task));
    backgroundTasks.add(task);
  }

  function isExpectedShutdownError(error: unknown): boolean {
    return isStopping && toErrorMessage(error) === 'Server is shutting down.';
  }

  const executorRegistry = createDefaultExecutorRegistry();
  const connectionProfileStore = new ConnectionProfileStore(join(config.agentsDir, '..', 'connections.json'));
  const connectionCapabilityStore = new ConnectionCapabilityStore(
    join(config.agentsDir, '..', 'connection-capabilities.json'),
  );
  const connectionOperationBindingStore = new ConnectionOperationBindingStore(
    join(config.agentsDir, '..', 'connection-operation-bindings.json'),
  );
  const runtimeAssignmentStore = new RuntimeAssignmentStore(
    join(config.agentsDir, '..', 'runtime-assignments.json'),
  );
  const agentBindingStore = new AgentBindingStore(
    join(config.agentsDir, '..', 'agent-bindings.json'),
  );

  // Discover the user's installed Claude Code, Codex, and Kimi Code binaries once at startup so
  // runs use the runtimes and logins they already have. Claude Code and Codex
  // can fall back to SDK runtimes; Kimi Code requires an installed executable.
  // Resolve once because a `which` lookup per run would be wasteful.
  const runtimePaths = discoverRuntimePaths();
  const logStore = createAgentLogStore({ logsDir: config.logsDir, machineId: config.machineId });
  let codexMcpServers = discoverCodexMcpInventory(runtimePaths.codexExecutablePath);
  let kimiMcpServers = discoverKimiMcpInventory(runtimePaths.kimiExecutablePath);
  let codexMcpState = runtimePaths.codexExecutablePath === undefined
    ? 'unavailable' as const
    : codexMcpServers === undefined ? 'failed' as const : 'ready' as const;
  let kimiMcpState = runtimePaths.kimiExecutablePath === undefined
    ? 'unavailable' as const
    : kimiMcpServers === undefined ? 'failed' as const : 'ready' as const;
  if (runtimePaths.claudeExecutablePath) {
    console.log(`  Claude runtime: ${runtimePaths.claudeExecutablePath} (installed)`);
  }
  if (runtimePaths.codexExecutablePath) {
    console.log(`  Codex runtime: ${runtimePaths.codexExecutablePath} (installed)`);
  }
  if (runtimePaths.kimiExecutablePath) {
    console.log(`  Kimi runtime: ${runtimePaths.kimiExecutablePath} (installed)`);
  }

  // Which coding agents a person actually has installed decides which executor
  // bugs matter. The path itself is a home-directory path and never leaves.
  for (const [executor, path] of [
    ['claude', runtimePaths.claudeExecutablePath],
    ['codex', runtimePaths.codexExecutablePath],
    ['kimi', runtimePaths.kimiExecutablePath],
  ] as const) {
    analytics.capture(
      path ? ANALYTICS_EVENTS.executorResolved : ANALYTICS_EVENTS.executorUnavailable,
      { executor, ...(path ? { origin: 'installed' } : {}) },
    );
  }

  /**
   * Every discovery pass in this server, so a definition that fails to load is
   * counted once wherever it is noticed. Only the failure code travels; the
   * filename stays in the local warning.
   */
  function discoverConfiguredAgents(): Promise<AgentConfig[]> {
    return discoverAgents(config.agentsDir, {
      onInvalid: (code) => analytics.capture(
        ANALYTICS_EVENTS.agentDefinitionInvalid,
        { code: code.toLowerCase() },
      ),
    });
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
        machineId: config.machineId,
        panelHealth,
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

    try {
      await channelDispatcher.dispatch(interactionId, agent.interaction.channel, interaction);
    } catch (error) {
      interactionStore.remove(interactionId);
      throw error;
    }
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

  const fireDownstreamTriggers = createDownstreamTriggerHandler({
    discover: () => discoverConfiguredAgents(),
    trigger: async (agent, chain) => {
      if (isStopping) return;
      await checkedTriggerRunForAgent(agent, { chain }, 'chain');
    },
    maxDepth: config.maxTriggerDepth,
    // A refused link in a chain lands in run history as a skipped run. The
    // downstream agent's page is where somebody looks when it did not run.
    onRefused: (agent, reason, sourceAgentId) => {
      const now = new Date();
      const message = reason === 'cycle'
        ? `Not triggered by ${sourceAgentId}: this chain already ran ${agent.id} once.`
        : `Not triggered by ${sourceAgentId}: the chain reached its depth limit of ${config.maxTriggerDepth}.`;
      store.add({
        runId: randomUUID(),
        agentId: agent.id,
        agentName: agent.name,
        status: 'skipped',
        code: `chain_${reason}`,
        startedAt: now,
        completedAt: now,
        summary: message,
        error: message,
        turnCount: 0,
        toolsUsed: [],
        filesRead: [],
        filesWritten: [],
        commandsRun: [],
        progressMessages: [],
        mode: 'normal',
      });
    },
  });

  const runLifecycle = createRunLifecycle({
    analytics,
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
        logStore,
        },
      ),
      runtimeAssignmentStore,
      agentBindingStore,
      connectionCapabilityStore,
      connectionOperationBindingStore,
    ),
    createReporter: (runId, name, conversationId, agent) => createReporter(config, runId, name, {
      serverId: workerId,
      conversationId,
      agentTelemetry: agent.telemetry,
      panelHealth,
    }),
    buildDecisionContext,
    resolveTimeoutMs: (agent) => resolveRunTimeoutMs(agent, config),
    notify: sendNotification,
    onInteraction: handleInteractionResult,
    onTerminal: (agent, status, chain) => {
      if (isStopping) return;
      return fireDownstreamTriggers(agent, status, chain);
    },
  });

  function triggerRunForAgent(agent: AgentConfig, options: TriggerRunOptions = {}): string {
    return runLifecycle.trigger(agent, options);
  }

  async function triggerRun(
    agentId: string,
    promptSuffix?: string,
    security?: { confirmedContentHash?: string },
  ): Promise<string> {
    const agents = await discoverConfiguredAgents();
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
    const agents = await discoverConfiguredAgents();
    const agent = agents.find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    return checkedTriggerRunForAgent(agent, { promptSuffix }, source);
  }

  async function triggerGuidanceRetry(
    agentId: string,
    metadata: { retryOfRunId: string; repairId?: string; confirmedContentHash?: string },
  ): Promise<string> {
    const agents = await discoverConfiguredAgents();
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
    getAgent: async (agentId) => {
      const agent = (await discoverConfiguredAgents()).find((candidate) => candidate.id === agentId);
      return agent
        ? applyRuntimeAssignment(agent, await runtimeAssignmentStore.get(agent.id))
        : undefined;
    },
    triggerAgent: (agent) => triggerRunForAgent(agent, { mode: 'safe_test' }),
  });

  function cancelRun(runId: string): boolean {
    return runLifecycle.cancel(runId);
  }

  let lastCheckedAt = new Date();
  const SLEEP_GAP_MULTIPLIER = 2;

  async function runDueAgents(): Promise<void> {
    if (isStopping) return;
    const agents = await discoverConfiguredAgents();
    if (isStopping) return;
    const now = new Date();

    const gap = now.getTime() - lastCheckedAt.getTime();
    if (gap > SLEEP_GAP_MULTIPLIER * config.checkIntervalMs) {
      console.log(`[catch-up] Detected sleep gap of ${Math.round(gap / 1000)}s, checking for missed agents`);
      const missedAgents = agents.filter((agent) => hasMissedRun(agent, lastCheckedAt, now));
      for (const agent of missedAgents) {
        if (isStopping) break;
        if (config.catchUp) {
          try {
            console.log(`[catch-up] Triggering missed agent: ${agent.id}`);
            await checkedTriggerRunForAgent(agent, {}, 'schedule');
          } catch (err) {
            if (isExpectedShutdownError(err)) break;
            console.error(`[catch-up] ${agent.id}: error - ${err}`);
          }
        } else {
          // Catch-up is off, so the run is not happening -- but the miss
          // itself goes in run history. A schedule that fired while the Mac
          // was asleep used to leave no trace at all, which reads as "my
          // agent is broken" instead of "my Mac was closed".
          const missedAt = new Date();
          const message = 'Missed its schedule while this Mac was asleep. '
            + 'Turn on catch-up in Settings to run missed schedules on wake.';
          store.add({
            runId: randomUUID(),
            agentId: agent.id,
            agentName: agent.name,
            status: 'skipped',
            code: 'missed_while_asleep',
            startedAt: missedAt,
            completedAt: missedAt,
            summary: message,
            error: message,
            turnCount: 0,
            toolsUsed: [],
            filesRead: [],
            filesWritten: [],
            commandsRun: [],
            progressMessages: [],
            mode: 'normal',
          });
        }
      }
    }

    lastCheckedAt = now;

    const dueAgents = agents.filter((agent) => shouldRun(agent, now));
    if (dueAgents.length === 0) return;

    console.log(`[${now.toISOString()}] ${dueAgents.length} agent(s) due: ${dueAgents.map((a) => a.id).join(', ')}`);

    for (const agent of dueAgents) {
      if (isStopping) break;
      try {
        await checkedTriggerRunForAgent(agent, {}, 'schedule');
      } catch (err) {
        if (isExpectedShutdownError(err)) break;
        console.error(`  ${agent.id}: error - ${err}`);
      }
    }
  }

  // App-wide, regenerable cache of the MCP discovery probe. Warmed in the
  // background at boot so the first capability read has connectors populated;
  // the app can force a re-probe via POST /connections/refresh.
  const connectionCache = new ConnectionCache(
    () => probeMcpServers(runtimePaths.claudeExecutablePath),
  );
  const runtimeConnections = () => {
    const claudeSnapshot = connectionCache.get();
    const claudeState = claudeSnapshot.probe_failed
      ? 'failed' as const
      : claudeSnapshot.discovered_at === null ? 'not_checked' as const : 'ready' as const;
    return runtimeConnectionInventory({
      paths: runtimePaths,
      claudeServers: claudeSnapshot.servers,
      claudeState,
      codexServers: codexMcpServers,
      kimiServers: kimiMcpServers,
      codexState: codexMcpState,
      kimiState: kimiMcpState,
    });
  };
  const refreshConnections = async () => {
    const snapshot = await connectionCache.refresh();
    const nextCodexServers = discoverCodexMcpInventory(runtimePaths.codexExecutablePath);
    const nextKimiServers = discoverKimiMcpInventory(runtimePaths.kimiExecutablePath);
    if (nextCodexServers === undefined) {
      if (runtimePaths.codexExecutablePath) codexMcpState = 'failed';
    } else {
      codexMcpServers = nextCodexServers;
      codexMcpState = runtimePaths.codexExecutablePath ? 'ready' : 'unavailable';
    }
    if (nextKimiServers === undefined) {
      if (runtimePaths.kimiExecutablePath) kimiMcpState = 'failed';
    } else {
      kimiMcpServers = nextKimiServers;
      kimiMcpState = runtimePaths.kimiExecutablePath ? 'ready' : 'unavailable';
    }
    return { ...snapshot, runtimes: runtimeConnections() };
  };
  void connectionCache.refresh().catch(() => {});
  const agentWriter = createAgentWriter(config.agentsDir, {
    connections: () => [],
    availableConnections: async (agent) => {
      const executor = agent.executor ?? 'claude-code';
      return availableConnections(buildServiceRegistry({
        agents: await discoverConfiguredAgents(),
        environment: loadEnvFile(join(config.agentsDir, '..'), process.env),
        discovered: executor === 'claude-code' ? connectionCache.servers() : [],
        executor,
      }));
    },
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
      // A withheld run is not a failed one. The app words the two
      // differently, and calling this a failure had it announcing "failed"
      // for an agent that was waiting on its person.
      broadcaster.emit({
        type: 'run_skipped',
        runId,
        agentId: agent.id,
        error: outcome.message,
        code: `security_preflight_${outcome.code}`,
        timestamp: new Date().toISOString(),
      });
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
  const getAgents = (): Promise<AgentConfig[]> => discoverConfiguredAgents();
  const guidanceApi = createGuidanceApi({
    model: guidanceModel,
    writer: agentWriter,
    getAgents,
    store,
    security: analysisRuntime.security,
    content: analysisRuntime.content,
    triggerRun: triggerGuidanceRetry,
    runtimeAssignments: runtimeAssignmentStore,
    agentBindings: agentBindingStore,
    getServiceRegistry: async (executor) => buildServiceRegistry({
      agents: await getAgents(),
      environment: loadEnvFile(join(config.agentsDir, '..'), process.env),
      discovered: executor === 'claude-code' ? connectionCache.servers() : [],
      executor,
      profiles: await connectionProfileStore.list(),
    }),
  });

  const app = createApi({
    getAgents,
    getPendingInteractions: () => interactionStore.listPending(),
    interactions: interactionStore,
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
      ? () => panelClient.failOrphanedRuns(workerId)
      : undefined,
    getPendingDecisions: realtimeClient
      ? () => realtimeClient.getPendingDecisions()
      : undefined,
    agentWriter,
    // Fresh .env read per request so keys saved via the app's Connect flow
    // are visible to capability checks without a server restart.
    getEnv: () => loadEnvFile(join(config.agentsDir, '..'), process.env),
    connections: {
      get: () => ({ ...connectionCache.get(), runtimes: runtimeConnections() }),
      ensure: async () => ({ ...await connectionCache.ensure(), runtimes: runtimeConnections() }),
      refresh: refreshConnections,
    },
    connectionProfiles: connectionProfileStore,
    connectionCapabilities: {
      get: (connectionId) => connectionCapabilityStore.get(connectionId),
      check: async (profile, environment) => {
        const snapshot = await probeStoredMcpCapabilities(profile, environment);
        await connectionCapabilityStore.put(snapshot);
        return snapshot;
      },
      remove: (connectionId) => connectionCapabilityStore.remove(connectionId),
    },
    connectionOperationBindings: connectionOperationBindingStore,
    runtimeAssignments: runtimeAssignmentStore,
    agentBindings: agentBindingStore,
    slackPairing: {
      getStatus: async () => {
        if (!config.slackBotToken || !config.slackAppToken) {
          return { state: 'not_configured', can_open_slack: false, can_test: false };
        }
        if (!slackChannel) {
          return { state: 'starting', can_open_slack: false, can_test: false };
        }
        return slackChannel.getPairingStatus();
      },
      pair: async (channelId) => {
        if (!slackChannel) throw new Error('Slack is not ready');
        await slackChannel.pair(channelId);
        return slackChannel.getPairingStatus();
      },
      sendTestMessage: async () => {
        if (!slackChannel) throw new Error('Slack is not ready');
        await slackChannel.sendTestMessage();
      },
    },
    channelStatuses: () => [
      config.telegramBotToken
        ? {
            ...(telegramChannel?.getLifecycleStatus?.() ?? {
              channel: 'telegram' as const,
              state: 'starting' as const,
            }),
            destination: telegramChannel?.getChatId() ? 'paired' as const : 'unpaired' as const,
          }
        : { channel: 'telegram', state: 'not_configured' },
      config.slackBotToken && config.slackAppToken
        ? {
            ...(slackChannel?.getLifecycleStatus?.() ?? {
              channel: 'slack' as const,
              state: 'starting' as const,
            }),
            destination: slackChannel?.getChannelId() ? 'paired' as const : 'unpaired' as const,
          }
        : { channel: 'slack', state: 'not_configured' },
    ],
    apiKey,
    machineId,
    // Read per call rather than captured, so a code redeemed a moment ago is
    // visible to the app immediately. Whether the daemon is reporting with it
    // is a separate question: configuration was read at startup.
    getPairing: () => loadPairing(config.workspaceDir),
    panelHealth: config.panelUrl ? () => panelHealth.snapshot() : undefined,
    pairedCredentialInUse: config.machineId !== undefined,
    // Present only when a Panel is configured. Without a URL there is nothing
    // to redeem a code against, and the route says so rather than failing in a
    // way somebody has to interpret.
    pairWithPanel: config.panelUrl
      ? async (code: string) => {
        const result = await redeemPairingCode({
          code,
          panelUrl: config.panelUrl!,
          machineId,
          serverVersion: AGENT_SERVER_VERSION,
        });

        if (!result.ok) return { ok: false as const, error: result.error };

        savePairing(config.workspaceDir, result.record);
        return { ok: true as const, displayName: result.record.displayName };
      }
      : undefined,
    runtimeAvailable: (executor) => {
      if (executor === 'claude-code') return runtimePaths.claudeExecutablePath !== undefined;
      if (executor === 'codex') return runtimePaths.codexExecutablePath !== undefined;
      return runtimePaths.kimiExecutablePath !== undefined;
    },
    assistantHomeFacts: async (agent, allAgents) => {
      const executor = agent.executor ?? 'claude-code';
      if (executor === 'claude-code') await connectionCache.ensure();
      const registry = buildServiceRegistry({
        agents: allAgents,
        environment: loadEnvFile(join(config.agentsDir, '..'), process.env),
        discovered: executor === 'claude-code' ? connectionCache.servers() : [],
        executor,
        profiles: await connectionProfileStore.list(),
      });
      return collectAssistantHomeFacts({
        agent,
        runtimePaths,
        registry,
        inspectPath: (configuredPath) => {
          const path = expandHome(configuredPath);
          // A daemon has no way to answer a macOS privacy prompt, so a
          // protected volume refuses the call outright. EACCES and EPERM mean
          // the question went unanswered; only ENOENT means the path is gone.
          let refused = false;
          const hasAccess = (mode: number): boolean => {
            try {
              accessSync(path, mode);
              return true;
            } catch (error) {
              const code = (error as NodeJS.ErrnoException).code;
              if (code === 'EACCES' || code === 'EPERM') refused = true;
              return false;
            }
          };
          const exists = hasAccess(constants.F_OK);
          const readable = hasAccess(constants.R_OK);
          const writable = hasAccess(constants.W_OK);
          return {
            exists,
            readable,
            writable,
            ...(refused && !exists ? { inspectable: false } : {}),
          };
        },
      });
    },
    // The same verdict the sidebar and the security page report, so no
    // screen calls an agent healthy while another says it is waiting.
    assistantAutomaticRuns: async (agent) => {
      const preflight = await analysisRuntime.preflight(agent);
      const outcome = evaluateRunPreflight(preflight, { source: 'schedule' });
      if (outcome.allowed) return 'allowed';
      return outcome.code === 'blocked' ? 'blocked' : 'review_required';
    },
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
          ws.send(JSON.stringify(progressEvent));
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
  const httpServerReady = waitForHttpServer(httpServer);
  injectWebSocket(httpServer);

  // Local ghost-run cleanup. A fresh process owns no in-flight runs, so any run
  // left `running` in the durable store belongs to a previous instance that was
  // killed mid-run. Fail them locally so the macOS app never shows a run
  // "working" forever. This needs no panel — the server owns its own runs.
  const orphaned = failOrphanedLocalRuns(store);
  if (orphaned.length > 0) {
    console.log(`[startup] Failed ${orphaned.length} local run(s) left in progress by a previous server instance`);
  }

  if (panelClient) {
    void panelClient.failOrphanedRuns(workerId)
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
        machineId,
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

  async function setupFileWatchManager(): Promise<AgentFileWatchManager> {
    const manager = new AgentFileWatchManager({
      agentsDir: config.agentsDir,
      onChange: (agentId, filePath) => {
        startBackgroundTask(
          async () => {
            console.log(`[file-watch] ${filePath} changed, triggering ${agentId}`);
            await triggerAutomaticRun(agentId, undefined, 'watcher');
          },
          (error) => {
            if (!isExpectedShutdownError(error)) {
              console.error(`[file-watch] Failed to trigger ${agentId}: ${error}`);
            }
          },
        );
      },
      onReconcile: (watchCount) => {
        console.log(`  File watches: ${watchCount} path(s)`);
      },
    });
    await manager.start();
    return manager;
  }

  // Where a chat message routes to. Shared by Telegram and Slack so both drive
  // the same conversation/routing/notification flow; only the transport differs.
  type ChatChannelSink = {
    channelName: 'slack' | 'telegram';
    chatKey: number;
    notifyText: (msg: string) => Promise<unknown>;
    notify: (data: NotificationData) => Promise<unknown>;
  };

  function handleChannelRunDone(
    agent: AgentConfig,
    sink: ChatChannelSink,
    done: Parameters<RunDoneCallback>[0],
    conversationId?: string,
  ): void {
    if (conversationId && done.status === 'completed' && done.summary) {
      conversationStore.addMessage(conversationId, 'assistant', done.summary);
    }

    const notification: NotificationData = done.status === 'completed'
      ? { agentName: agent.name, status: 'completed', summary: done.summary }
      : { agentName: agent.name, status: done.status, error: done.error };
    if (shouldSendChannelRunNotification(agent, done.status, sink.channelName)) {
      void sink.notify(notification);
    }
  }

  async function handleChannelMessage(text: string, sink: ChatChannelSink): Promise<void> {
    if (isStopping) return;
    try {
      const activeConv = conversationStore.findActiveByChat(sink.chatKey);
      if (activeConv) {
        const agents = await discoverConfiguredAgents();
        const agent = agents.find((a) => a.id === activeConv.agentId);
        if (!agent) {
          conversationStore.expire(activeConv.id);
          await sink.notifyText('Conversation expired (agent not found).');
          return;
        }

        conversationStore.addMessage(activeConv.id, 'user', text);
        const updatedConversation = conversationStore.get(activeConv.id);
        const contextSuffix = formatConversationHistory(updatedConversation?.messages ?? []);

        const runId = await checkedTriggerRunForAgent(agent, {
          promptSuffix: contextSuffix,
          conversationId: activeConv.id,
          conversationChannel: sink.channelName,
          onDone: (done) => handleChannelRunDone(agent, sink, done, activeConv.id),
        }, 'channel');
        if (!runId) {
          await sink.notifyText('Security review is required before this agent can run from messages.');
          return;
        }
        await sink.notifyText(`Running ${agent.name}...`);
        return;
      }

      const agents = await discoverConfiguredAgents();
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
        onDone: (done) => handleChannelRunDone(agent, sink, done, convId),
      }, 'channel');
      if (!runId) {
        await sink.notifyText('Security review is required before this agent can run from messages.');
        return;
      }
      await sink.notifyText(`Running ${agent.name}...`);
    } catch (err) {
      const msg = toErrorMessage(err);
      if (isExpectedShutdownError(err)) return;
      console.error(`[${sink.channelName}] Message routing failed: ${msg}`);
      void sink.notifyText(`Error: ${msg}`);
    }
  }

  // Route an interaction reply (button tap / free text) to the on_reply agent.
  function handleInteractionReply(channelName: string, reply: { interactionId: string; selectedValue?: string; freeText?: string }): void {
    if (isStopping) return;
    const interaction = interactionStore.get(reply.interactionId);
    if (!interaction || interaction.status !== 'pending') return;

    interactionStore.markActed(reply.interactionId);
    const promptSuffix = reply.selectedValue ?? reply.freeText;
    if (!promptSuffix) return;

    console.log(`[${channelName}] Reply for ${interaction.agentId}, triggering ${interaction.replyAgentId}`);
    startBackgroundTask(
      () => triggerAutomaticRun(interaction.replyAgentId, promptSuffix, 'interaction').then(() => {}),
      (error) => {
        if (!isExpectedShutdownError(error)) {
          console.error(`[${channelName}] Failed to trigger ${interaction.replyAgentId}: ${error}`);
        }
      },
    );
  }

  /**
   * Records why a chat channel never came up, then lets the failure through.
   * A bad token and an unreachable Socket Mode endpoint look identical in the
   * logs of a machine nobody is watching, and the difference decides whether
   * the fix is the user's or ours.
   */
  async function connectChannel(
    channel: 'slack' | 'telegram',
    setup: () => Promise<void>,
  ): Promise<void> {
    try {
      await setup();
    } catch (error) {
      analytics.capture(ANALYTICS_EVENTS.channelFailed, {
        channel,
        reason: classifyErrorReason(error),
      });
      console.warn(`[${channel}] Channel unavailable: ${classifyErrorReason(error)}`);
    }
  }

  async function setupTelegram(): Promise<void> {
    if (!config.telegramBotToken) {
      console.log('Telegram bot disabled (no AGENT_SERVER_TELEGRAM_BOT_TOKEN set)');
      return;
    }

    const chatIdPath = join(config.agentsDir, '..', 'telegram.json');
    const channel = await createTelegramChannel({
      botToken: config.telegramBotToken,
      chatIdPath,
      allowedChatId: config.telegramAllowedChatId,
    });

    telegramChannel = channel;
    channel.onReply((reply) => handleInteractionReply('telegram', reply));

    channel.onMessage((text) => {
      const chatId = channel.getChatId();
      if (!chatId) return;
      startBackgroundTask(
        () => handleChannelMessage(text, {
          channelName: 'telegram',
          chatKey: chatId,
          notifyText: (m) => channel.notifyText(m),
          notify: (d) => channel.notify(d),
        }),
        (error) => console.error(`[telegram] Message routing failed: ${toErrorMessage(error)}`),
      );
    });

    channelDispatcher.register(channel);
    channel.onStatusChange?.((status) => {
      if (status.state === 'connected') {
        analytics.capture(ANALYTICS_EVENTS.channelConnected, { channel: 'telegram' });
      } else if (status.state === 'needs_auth' || status.state === 'disconnected') {
        analytics.capture(ANALYTICS_EVENTS.channelFailed, {
          channel: 'telegram',
          reason: status.error_code ?? status.state,
        });
      }
    });
    await channel.start();
    const telegramState = channel.getLifecycleStatus?.().state ?? 'connected';
    if (!channel.onStatusChange && telegramState === 'connected') {
      analytics.capture(ANALYTICS_EVENTS.channelConnected, { channel: 'telegram' });
    }
    console.log(`  Telegram: ${telegramState}`);
  }

  async function setupSlack(): Promise<void> {
    if (!config.slackBotToken || !config.slackAppToken) {
      console.log('Slack bot disabled (set AGENT_SERVER_SLACK_BOT_TOKEN and AGENT_SERVER_SLACK_APP_TOKEN to enable)');
      return;
    }

    const channelIdPath = join(config.agentsDir, '..', 'slack.json');
    const channel = await createSlackChannel({
      botToken: config.slackBotToken,
      appToken: config.slackAppToken,
      channelIdPath,
    });
    slackChannel = channel;

    channel.onReply((reply) => handleInteractionReply('slack', reply));

    channel.onMessage((text) => {
      const channelId = channel.getChannelId();
      if (!channelId) return;
      startBackgroundTask(
        () => handleChannelMessage(text, {
          channelName: 'slack',
          chatKey: chatKeyFromString(channelId),
          notifyText: (m) => channel.notifyText(m),
          notify: (d) => channel.notify(d),
        }),
        (error) => console.error(`[slack] Message routing failed: ${toErrorMessage(error)}`),
      );
    });

    channelDispatcher.register(channel);
    channel.onStatusChange?.((status) => {
      if (status.state === 'connected') {
        analytics.capture(ANALYTICS_EVENTS.channelConnected, { channel: 'slack' });
      } else if (status.state === 'needs_auth' || status.state === 'disconnected') {
        analytics.capture(ANALYTICS_EVENTS.channelFailed, {
          channel: 'slack',
          reason: status.error_code ?? status.state,
        });
      }
    });
    await channel.start();
    const slackState = channel.getLifecycleStatus?.().state ?? 'connected';
    if (!channel.onStatusChange && slackState === 'connected') {
      analytics.capture(ANALYTICS_EVENTS.channelConnected, { channel: 'slack' });
    }
    console.log(`  Slack: ${slackState}`);
  }

  const expireStaleState = (): void => {
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
  };

  let fileWatchManager: AgentFileWatchManager | undefined;
  const managedServices: ManagedService[] = [
    ...(scheduleSync ? [{
      name: 'schedule sync',
      start: () => scheduleSync.start(),
      stop: () => scheduleSync.stop(),
    }] : []),
    ...(triggerHandler ? [{
      name: 'trigger handler',
      start: () => triggerHandler.start(),
      stop: () => triggerHandler.stop(),
    }] : []),
    ...(realtimeClient ? [{
      name: 'realtime client',
      start: () => realtimeClient.start(),
      stop: () => realtimeClient.stop(),
    }] : []),
    {
      name: 'file watcher',
      start: async () => {
        fileWatchManager = await setupFileWatchManager();
      },
      stop: () => fileWatchManager?.stop(),
    },
    {
      name: 'message channels',
      start: async () => {
        await connectChannel('telegram', setupTelegram);
        await connectChannel('slack', setupSlack);
      },
      stop: () => channelDispatcher.stopAll(),
    },
  ];

  let stopManagedServices = async (): Promise<void> => {};
  let interval: NodeJS.Timeout | undefined;
  let expiryInterval: NodeJS.Timeout | undefined;
  let startupFailed = false;
  let stopping: Promise<void> | undefined;

  const ready = (async (): Promise<void> => {
    try {
      await httpServerReady;
      console.log(`Agent Server API listening on http://${config.host}:${port}`);
      stopManagedServices = await startManagedServices(managedServices, {
        startTimeoutMs: MANAGED_SERVICE_START_TIMEOUT_MS,
        stopTimeoutMs: MANAGED_SERVICE_STOP_TIMEOUT_MS,
      });
      if (isStopping) {
        await stopManagedServices();
        return;
      }

      startBackgroundTask(
        runDueAgents,
        (error) => console.error(
          `[scheduler] Initial schedule check failed: ${toErrorMessage(error)}`,
        ),
      );
      interval = setInterval(() => {
        startBackgroundTask(
          runDueAgents,
          (error) => console.error(`[scheduler] Schedule check failed: ${toErrorMessage(error)}`),
        );
      }, config.checkIntervalMs);
      expiryInterval = setInterval(expireStaleState, 60_000);
    } catch (error) {
      startupFailed = true;
      if (pendingReplayInterval) clearInterval(pendingReplayInterval);
      await closeHttpServer(httpServer).catch(() => {});
      store.close();
      analysisRuntime.close();
      throw error;
    }
  })();
  // Preserve the synchronous API for existing library callers. Consumers that
  // need readiness can await this same promise without risking an unhandled
  // rejection when an older caller only uses stop().
  void ready.catch(() => {});

  const stop = async (): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
      isStopping = true;
      runLifecycle.stopAccepting();
      if (interval) clearInterval(interval);
      if (expiryInterval) clearInterval(expiryInterval);
      if (pendingReplayInterval) clearInterval(pendingReplayInterval);
      await ready.catch(() => {});
      if (startupFailed) return;

      const shutdownErrors: Error[] = [];
      const attempt = async (operation: () => Promise<void> | void): Promise<void> => {
        try {
          await operation();
        } catch (error) {
          shutdownErrors.push(new Error(toErrorMessage(error)));
        }
      };

      await attempt(() => closeHttpServer(httpServer));
      await attempt(() => triggerHandler?.drain());
      let didDrainBackgroundTasks = false;
      await attempt(async () => {
        didDrainBackgroundTasks = await drainPendingTasks(
          backgroundTasks,
          SHUTDOWN_DRAIN_TIMEOUT_MS,
        );
      });
      let didDrainRuns = false;
      await attempt(async () => {
        didDrainRuns = await runLifecycle.drain({
          graceTimeoutMs: SHUTDOWN_RUN_GRACE_TIMEOUT_MS,
          overallTimeoutMs: SHUTDOWN_DRAIN_TIMEOUT_MS,
          perRunTimeoutMs: SHUTDOWN_PER_RUN_TIMEOUT_MS,
        });
      });
      await attempt(stopManagedServices);
      if (didDrainBackgroundTasks && didDrainRuns) {
        await attempt(() => store.close());
        await attempt(() => analysisRuntime.close());
      } else {
        console.warn('[shutdown] Work drain timed out; keeping stores open for terminal bookkeeping');
      }

      // After the run drain, not before: draining is what settles the last
      // runs, so the events worth keeping are queued by the line above this
      // one. The server flushes what the server captured rather than trusting
      // its caller to, because `startServer` has callers other than the CLI.
      await attempt(() => analytics.flush());

      console.log('Agent Server stopped.');
      if (shutdownErrors.length === 1) throw shutdownErrors[0];
      if (shutdownErrors.length > 1) {
        throw new AggregateError(shutdownErrors, 'Multiple server resources failed to stop');
      }
    })();
    return stopping;
  };

  return {
    ready,
    stop,
  };
}

function waitForHttpServer(server: ReturnType<typeof serve>): Promise<void> {
  if (server.listening) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const removeListeners = (): void => {
      server.off('listening', handleListening);
      server.off('error', handleError);
    };
    const handleListening = (): void => {
      removeListeners();
      resolve();
    };
    const handleError = (error: Error): void => {
      removeListeners();
      reject(error);
    };

    server.once('listening', handleListening);
    server.once('error', handleError);
  });
}

function closeHttpServer(server: ReturnType<typeof serve>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error?: Error) => {
      if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
