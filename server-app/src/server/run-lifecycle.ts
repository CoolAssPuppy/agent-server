import { randomUUID } from 'crypto';
import type { AgentConfig } from '../agents/config.js';
import type { TriggerChain } from '../agents/triggers.js';
import type { DecisionContext } from '../execution/decision-handler.js';
import type { ExecutorFn } from '../execution/executor-registry.js';
import type { ExecutionResult } from '../execution/executor.js';
import { runAgent, type Reporter, type RunResult } from '../execution/runner.js';
import type { NotificationData } from '../interaction/notification.js';
import type { InteractionRequest } from '../interaction/schema.js';
import type { RunStoreLike } from '../reporting/store.js';
import { toErrorMessage } from '../util/errors.js';
import { withTimeout } from '../util/with-timeout.js';
import type { ProgressBroadcaster } from './websocket.js';
import { createRunProgressReporter } from './run-progress-reporter.js';
import { createNoopAnalytics, type Analytics } from '../analytics/analytics.js';
import { ANALYTICS_EVENTS } from '../analytics/events.js';

export {
  extractMcpNeedsAuthServers,
  extractRelevantMcpNeedsAuthServers,
} from './run-progress-reporter.js';

export type RunDoneCallback = (
  result: { status: 'completed' | 'failed' | 'skipped'; summary?: string; error?: string },
) => void;

export type TriggerRunOptions = {
  promptSuffix?: string;
  onDone?: RunDoneCallback;
  conversationId?: string;
  conversationChannel?: 'slack' | 'telegram';
  mode?: 'normal' | 'safe_test';
  retryOfRunId?: string;
  repairId?: string;
  chain?: TriggerChain;
};

export type RunLifecycle = {
  trigger: (agent: AgentConfig, options?: TriggerRunOptions) => string;
  stopAccepting: () => void;
  cancel: (runId: string) => boolean;
  waitForTerminal: (runId: string) => Promise<void>;
  drain: (timeouts: { overallTimeoutMs: number; perRunTimeoutMs: number }) => Promise<boolean>;
};

type RunLifecycleDependencies = {
  maxConcurrentRuns: number;
  lockDir: string;
  runTimeoutMs: number;
  store: RunStoreLike;
  broadcaster: ProgressBroadcaster;
  execute: ExecutorFn;
  createReporter: (
    runId: string,
    agentName: string,
    conversationId: string | undefined,
    agent: AgentConfig,
  ) => Reporter;
  run?: typeof runAgent;
  buildDecisionContext?: (runId: string) => DecisionContext | undefined;
  resolveTimeoutMs?: (agent: AgentConfig) => number | undefined;
  notify: (
    agent: AgentConfig,
    runId: string,
    data: Omit<NotificationData, 'agentName'>,
  ) => void;
  onInteraction: (
    runId: string,
    agent: AgentConfig,
    interaction: InteractionRequest,
  ) => Promise<void> | void;
  onTerminal: (
    agent: AgentConfig,
    status: 'completed' | 'failed' | 'skipped',
    chain: TriggerChain | undefined,
  ) => Promise<void> | void;
  createRunId?: () => string;
  now?: () => Date;
  /** Anonymous product analytics. Defaults to a no-op so tests send nothing. */
  analytics?: Analytics;
};

const ALREADY_COMPLETED_TODAY_CODE = 'already_completed_today';
const ALREADY_COMPLETED_TODAY_REASON = 'Already completed today.';

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function createRunLifecycle(dependencies: RunLifecycleDependencies): RunLifecycle {
  const activeControllers = new Map<string, AbortController>();
  const terminalWaiters = new Map<string, Promise<void>>();
  const terminalResolvers = new Map<string, () => void>();
  const run = dependencies.run ?? runAgent;
  const now = dependencies.now ?? (() => new Date());
  const analytics = dependencies.analytics ?? createNoopAnalytics();
  const startedAtByRun = new Map<string, number>();
  let isAccepting = true;

  /**
   * The shape of a run, with nothing in it a person could be identified by.
   * `agent_id` is the slug from the definition filename, which the macOS app
   * already sends on `agent_discovered`; prompts, summaries, file paths, and
   * error messages stay on the machine.
   */
  function runShape(agent: AgentConfig, options: TriggerRunOptions) {
    return {
      agent_id: agent.id,
      executor: agent.executor ?? 'default',
      mode: options.mode ?? 'normal',
      scheduled: Boolean(agent.schedule),
      chained: Boolean(options.chain),
      conversational: Boolean(options.conversationId),
      retry: Boolean(options.retryOfRunId),
    };
  }

  function trigger(agent: AgentConfig, options: TriggerRunOptions = {}): string {
    if (!isAccepting) {
      analytics.capture(ANALYTICS_EVENTS.agentRunRejected, {
        ...runShape(agent, options),
        reason: 'shutting_down',
      });
      throw new Error('Server is shutting down.');
    }
    if (activeControllers.size >= dependencies.maxConcurrentRuns) {
      analytics.capture(ANALYTICS_EVENTS.agentRunRejected, {
        ...runShape(agent, options),
        reason: 'concurrency_limit',
        active_runs: activeControllers.size,
      });
      throw new Error('Too many active runs. Please retry later.');
    }

    const runId = dependencies.createRunId?.() ?? randomUUID();
    const abortController = new AbortController();
    activeControllers.set(runId, abortController);
    terminalWaiters.set(runId, new Promise<void>((resolve) => {
      terminalResolvers.set(runId, resolve);
    }));
    recordStart(runId, agent, options);

    const terminalWork = shouldSkipCompletedToday(agent, options)
      ? recordSkipped(runId, agent, options, {
        runId,
        status: 'skipped',
        code: ALREADY_COMPLETED_TODAY_CODE,
        error: ALREADY_COMPLETED_TODAY_REASON,
      })
      : executeRun(runId, agent, options, abortController);

    void terminalWork.finally(() => {
      startedAtByRun.delete(runId);
      activeControllers.delete(runId);
      terminalResolvers.get(runId)?.();
      terminalResolvers.delete(runId);
      terminalWaiters.delete(runId);
    });

    return runId;
  }

  function shouldSkipCompletedToday(
    agent: AgentConfig,
    options: TriggerRunOptions,
  ): boolean {
    if (agent.rerun_policy !== 'skip_if_completed_today') return false;
    if ((options.mode ?? 'normal') !== 'normal') return false;
    if (options.promptSuffix || options.conversationId || options.retryOfRunId) return false;

    const timeZone = agent.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const today = localDateKey(now(), timeZone);
    if (!today) return false;
    return dependencies.store.listByAgent(agent.id).some((storedRun) => {
      if (storedRun.status !== 'completed') return false;
      return localDateKey(storedRun.completedAt ?? storedRun.startedAt, timeZone) === today;
    });
  }

  function recordStart(runId: string, agent: AgentConfig, options: TriggerRunOptions): void {
    const startedAt = now();
    dependencies.store.add({
      runId,
      agentId: agent.id,
      agentName: agent.name,
      status: 'running',
      startedAt,
      turnCount: 0,
      toolsUsed: [],
      filesRead: [],
      filesWritten: [],
      commandsRun: [],
      progressMessages: [],
      conversationId: options.conversationId,
      conversationChannel: options.conversationChannel,
      mode: options.mode ?? 'normal',
      retryOfRunId: options.retryOfRunId,
      repairId: options.repairId,
    });
    dependencies.broadcaster.emit({
      type: 'run_started',
      runId,
      agentId: agent.id,
      timestamp: startedAt.toISOString(),
    });
    startedAtByRun.set(runId, startedAt.getTime());
    analytics.capture(ANALYTICS_EVENTS.agentRunDispatched, runShape(agent, options));
  }

  function recordSettled(
    runId: string,
    agent: AgentConfig,
    options: TriggerRunOptions,
    status: 'completed' | 'failed' | 'skipped',
    extra: { code?: string; turnCount?: number; toolCount?: number } = {},
  ): void {
    const startedAt = startedAtByRun.get(runId);
    analytics.capture(ANALYTICS_EVENTS.agentRunSettled, {
      ...runShape(agent, options),
      status,
      ...(extra.code ? { code: extra.code } : {}),
      ...(extra.turnCount === undefined ? {} : { turn_count: extra.turnCount }),
      ...(extra.toolCount === undefined ? {} : { tool_count: extra.toolCount }),
      ...(startedAt === undefined
        ? {}
        : { duration_seconds: Math.round((now().getTime() - startedAt) / 1000) }),
    });
  }

  async function executeRun(
    runId: string,
    agent: AgentConfig,
    options: TriggerRunOptions,
    abortController: AbortController,
  ): Promise<void> {
    try {
      const result = await run({
        runId,
        agent,
        lockDir: dependencies.lockDir,
        buildDecisionContext: dependencies.buildDecisionContext,
        execute: (effectiveAgent, reporter) => executeAgent(
          runId,
          agent,
          effectiveAgent,
          reporter,
          options,
          abortController,
        ),
        createReporter: (id, name, conversationId) =>
          dependencies.createReporter(id, name, conversationId, agent),
        promptSuffix: options.promptSuffix,
        conversationId: options.conversationId,
        mode: options.mode ?? 'normal',
        timeoutMs: dependencies.resolveTimeoutMs?.(agent) ??
          (dependencies.runTimeoutMs > 0 ? dependencies.runTimeoutMs : undefined),
        abortController,
      });
      await handleRunResult(runId, agent, options, result);
    } catch (error) {
      await emitFailure(runId, agent, options, toErrorMessage(error));
    }
  }

  async function executeAgent(
    runId: string,
    originalAgent: AgentConfig,
    effectiveAgent: AgentConfig,
    reporter: Reporter,
    options: TriggerRunOptions,
    abortController: AbortController,
  ): Promise<ExecutionResult> {
    const wrappedReporter = createRunProgressReporter({
      runId,
      agentId: originalAgent.id,
      agent: originalAgent,
      store: dependencies.store,
      broadcaster: dependencies.broadcaster,
      reporter,
    });
    const result = await dependencies.execute(effectiveAgent, wrappedReporter, {
      abortController,
      disableMcpServers: (options.mode ?? 'normal') === 'safe_test',
    });
    if (result.interaction && originalAgent.interaction) {
      await dependencies.onInteraction(runId, originalAgent, result.interaction);
    }
    return result;
  }

  async function recordCompletion(
    runId: string,
    agent: AgentConfig,
    options: TriggerRunOptions,
    result: ExecutionResult,
  ): Promise<void> {
    const usage = result.usage ?? {};
    dependencies.store.update(runId, {
      status: 'completed',
      completedAt: now(),
      summary: result.summary,
      turnCount: result.turnCount,
      toolsUsed: result.toolsUsed,
      filesRead: result.filesRead,
      filesWritten: result.filesWritten,
      commandsRun: result.commandsRun,
      durationMs: finiteNumber(result.durationMs) ?? finiteNumber(usage.duration_ms),
      estimatedCostUsd: finiteNumber(usage.estimated_cost_usd),
      inputTokens: finiteNumber(usage.input_tokens),
      outputTokens: finiteNumber(usage.output_tokens),
      model: result.model,
    });
    dependencies.broadcaster.emit({
      type: 'run_completed',
      runId,
      agentId: agent.id,
      summary: result.summary,
      timestamp: now().toISOString(),
    });
    dependencies.notify(agent, runId, {
      status: 'completed',
      summary: result.summary,
      turnCount: result.turnCount,
      toolsUsed: result.toolsUsed,
      filesWritten: result.filesWritten,
    });
    recordSettled(runId, agent, options, 'completed', {
      turnCount: result.turnCount,
      toolCount: result.toolsUsed?.length,
    });
    options.onDone?.({ status: 'completed', summary: result.summary });
    if ((options.mode ?? 'normal') !== 'safe_test') {
      await invokeTerminalHook(agent, 'completed', options.chain);
    }
  }

  async function handleRunResult(
    runId: string,
    agent: AgentConfig,
    options: TriggerRunOptions,
    result: RunResult,
  ): Promise<void> {
    if (result.status === 'completed' && result.result) {
      await recordCompletion(runId, agent, options, result.result);
    } else if (result.status === 'skipped') {
      await recordSkipped(runId, agent, options, result);
    } else if (result.status === 'failed') {
      await emitFailure(runId, agent, options, result.error ?? 'Unknown error', result.code);
    }
  }

  async function recordSkipped(
    runId: string,
    agent: AgentConfig,
    options: TriggerRunOptions,
    result: RunResult,
  ): Promise<void> {
    const reason = result.error ?? 'This run was skipped.';
    dependencies.store.update(runId, {
      status: 'skipped',
      completedAt: now(),
      summary: reason,
      error: reason,
      code: result.code,
    });
    dependencies.broadcaster.emit({
      type: 'run_skipped',
      runId,
      agentId: agent.id,
      error: reason,
      code: result.code,
      timestamp: now().toISOString(),
    });
    dependencies.notify(agent, runId, { status: 'skipped', error: reason });
    recordSettled(runId, agent, options, 'skipped', { code: result.code });
    options.onDone?.({ status: 'skipped', error: reason });
    if ((options.mode ?? 'normal') !== 'safe_test') {
      await invokeTerminalHook(agent, 'skipped', options.chain);
    }
  }

  async function emitFailure(
    runId: string,
    agent: AgentConfig,
    options: TriggerRunOptions,
    error: string,
    code?: string,
  ): Promise<void> {
    dependencies.store.update(runId, { status: 'failed', completedAt: now(), error, code });
    dependencies.broadcaster.emit({
      type: 'run_failed',
      runId,
      agentId: agent.id,
      error,
      code,
      timestamp: now().toISOString(),
    });
    dependencies.notify(agent, runId, { status: 'failed', error });
    recordSettled(runId, agent, options, 'failed', { code });
    options.onDone?.({ status: 'failed', error });
    if ((options.mode ?? 'normal') !== 'safe_test') {
      await invokeTerminalHook(agent, 'failed', options.chain);
    }
  }

  async function invokeTerminalHook(
    agent: AgentConfig,
    status: 'completed' | 'failed' | 'skipped',
    chain: TriggerChain | undefined,
  ): Promise<void> {
    try {
      await dependencies.onTerminal(agent, status, chain);
    } catch (error) {
      console.error(`[lifecycle] Terminal hook failed for ${agent.id}: ${toErrorMessage(error)}`);
    }
  }

  function cancel(runId: string): boolean {
    const controller = activeControllers.get(runId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  function stopAccepting(): void {
    isAccepting = false;
  }

  function waitForTerminal(runId: string): Promise<void> {
    return terminalWaiters.get(runId) ?? Promise.resolve();
  }

  async function drain(
    timeouts: { overallTimeoutMs: number; perRunTimeoutMs: number },
  ): Promise<boolean> {
    const runIds = [...activeControllers.keys()];
    if (runIds.length === 0) return true;
    console.log(`[shutdown] Aborting ${runIds.length} active run(s); draining terminals`);
    for (const controller of activeControllers.values()) controller.abort();
    const waits = runIds.map((runId) => withTimeoutFallback(
      waitForTerminal(runId).then(() => true),
      timeouts.perRunTimeoutMs,
      false,
    ));
    return withTimeoutFallback(
      Promise.all(waits).then((results) => results.every(Boolean)),
      timeouts.overallTimeoutMs,
      false,
    );
  }

  return { trigger, stopAccepting, cancel, waitForTerminal, drain };
}

function localDateKey(date: Date, timeZone: string): string | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return undefined;
  }
}

async function withTimeoutFallback<T>(
  promise: Promise<T>,
  durationMs: number,
  fallback: T,
): Promise<T> {
  let didTimeout = false;
  try {
    return await withTimeout(promise, {
      timeoutMs: durationMs,
      createError: () => new Error('Run drain timed out'),
      onTimeout: () => { didTimeout = true; },
    });
  } catch (error) {
    if (didTimeout) return fallback;
    throw error;
  }
}
