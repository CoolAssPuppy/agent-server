import { randomUUID } from 'crypto';
import type { AgentConfig } from '../agents/config.js';
import type { DecisionContext } from '../execution/decision-handler.js';
import type { ExecutorFn } from '../execution/executor-registry.js';
import type { ExecutionResult } from '../execution/executor.js';
import { runAgent, type Reporter, type RunResult } from '../execution/runner.js';
import type { NotificationData } from '../interaction/notification.js';
import type { InteractionRequest } from '../interaction/schema.js';
import type { RunStoreLike } from '../reporting/store.js';
import { toErrorMessage } from '../util/errors.js';
import { sanitizeProgressEvent } from './security-utils.js';
import type { ProgressBroadcaster } from './websocket.js';
import { createRunProgressReporter } from './run-progress-reporter.js';

export { extractMcpNeedsAuthServers } from './run-progress-reporter.js';

export type RunDoneCallback = (
  result: { status: 'completed' | 'failed'; summary?: string; error?: string },
) => void;

export type TriggerRunOptions = {
  promptSuffix?: string;
  onDone?: RunDoneCallback;
  conversationId?: string;
  mode?: 'normal' | 'safe_test';
  retryOfRunId?: string;
  repairId?: string;
};

export type RunLifecycle = {
  trigger: (agent: AgentConfig, options?: TriggerRunOptions) => string;
  cancel: (runId: string) => boolean;
  waitForTerminal: (runId: string) => Promise<void>;
  drain: (timeouts: { overallTimeoutMs: number; perRunTimeoutMs: number }) => Promise<void>;
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
  onTerminal: (agent: AgentConfig, status: 'completed' | 'failed') => Promise<void> | void;
  createRunId?: () => string;
};

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function createRunLifecycle(dependencies: RunLifecycleDependencies): RunLifecycle {
  const activeControllers = new Map<string, AbortController>();
  const terminalWaiters = new Map<string, Promise<void>>();
  const terminalResolvers = new Map<string, () => void>();
  const run = dependencies.run ?? runAgent;

  function trigger(agent: AgentConfig, options: TriggerRunOptions = {}): string {
    if (activeControllers.size >= dependencies.maxConcurrentRuns) {
      throw new Error('Too many active runs. Please retry later.');
    }

    const runId = dependencies.createRunId?.() ?? randomUUID();
    const abortController = new AbortController();
    activeControllers.set(runId, abortController);
    terminalWaiters.set(runId, new Promise<void>((resolve) => {
      terminalResolvers.set(runId, resolve);
    }));
    recordStart(runId, agent, options);

    void executeRun(runId, agent, options, abortController).finally(() => {
      activeControllers.delete(runId);
      terminalResolvers.get(runId)?.();
      terminalResolvers.delete(runId);
      terminalWaiters.delete(runId);
    });

    return runId;
  }

  function recordStart(runId: string, agent: AgentConfig, options: TriggerRunOptions): void {
    const startedAt = new Date();
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
      mode: options.mode ?? 'normal',
      retryOfRunId: options.retryOfRunId,
      repairId: options.repairId,
    });
    dependencies.broadcaster.emit(sanitizeProgressEvent({
      type: 'run_started',
      runId,
      agentId: agent.id,
      timestamp: startedAt.toISOString(),
    }));
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
        timeoutMs: dependencies.resolveTimeoutMs?.(agent) ??
          (dependencies.runTimeoutMs > 0 ? dependencies.runTimeoutMs : undefined),
        abortController,
      });
      handleRunResult(runId, agent, options, result);
    } catch (error) {
      emitFailure(runId, agent, options, toErrorMessage(error));
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
      store: dependencies.store,
      broadcaster: dependencies.broadcaster,
      reporter,
    });
    const result = await dependencies.execute(effectiveAgent, wrappedReporter, {
      abortController,
      disableMcpServers: (options.mode ?? 'normal') === 'safe_test',
    });
    recordCompletion(runId, originalAgent, options, result);
    return result;
  }

  function recordCompletion(
    runId: string,
    agent: AgentConfig,
    options: TriggerRunOptions,
    result: ExecutionResult,
  ): void {
    const usage = result.usage ?? {};
    dependencies.store.update(runId, {
      status: 'completed',
      completedAt: new Date(),
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
    if (result.interaction && agent.interaction) {
      void dependencies.onInteraction(runId, agent, result.interaction);
    }
    dependencies.broadcaster.emit(sanitizeProgressEvent({
      type: 'run_completed',
      runId,
      agentId: agent.id,
      summary: result.summary,
      timestamp: new Date().toISOString(),
    }));
    dependencies.notify(agent, runId, {
      status: 'completed',
      summary: result.summary,
      turnCount: result.turnCount,
      toolsUsed: result.toolsUsed,
      filesWritten: result.filesWritten,
    });
    options.onDone?.({ status: 'completed', summary: result.summary });
    if ((options.mode ?? 'normal') !== 'safe_test') {
      void dependencies.onTerminal(agent, 'completed');
    }
  }

  function handleRunResult(
    runId: string,
    agent: AgentConfig,
    options: TriggerRunOptions,
    result: RunResult,
  ): void {
    if (result.status === 'skipped') {
      dependencies.store.update(runId, { status: 'skipped', completedAt: new Date() });
    } else if (result.status === 'failed') {
      emitFailure(runId, agent, options, result.error ?? 'Unknown error', result.code);
    }
  }

  function emitFailure(
    runId: string,
    agent: AgentConfig,
    options: TriggerRunOptions,
    error: string,
    code?: string,
  ): void {
    dependencies.store.update(runId, { status: 'failed', completedAt: new Date(), error });
    dependencies.broadcaster.emit(sanitizeProgressEvent({
      type: 'run_failed',
      runId,
      agentId: agent.id,
      error,
      code,
      timestamp: new Date().toISOString(),
    }));
    dependencies.notify(agent, runId, { status: 'failed', error });
    options.onDone?.({ status: 'failed', error });
    if ((options.mode ?? 'normal') !== 'safe_test') {
      void dependencies.onTerminal(agent, 'failed');
    }
  }

  function cancel(runId: string): boolean {
    const controller = activeControllers.get(runId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  function waitForTerminal(runId: string): Promise<void> {
    return terminalWaiters.get(runId) ?? Promise.resolve();
  }

  async function drain(timeouts: { overallTimeoutMs: number; perRunTimeoutMs: number }): Promise<void> {
    const runIds = [...activeControllers.keys()];
    if (runIds.length === 0) return;
    console.log(`[shutdown] Aborting ${runIds.length} active run(s); draining terminals`);
    for (const controller of activeControllers.values()) controller.abort();
    const waits = runIds.map((runId) => Promise.race([
      waitForTerminal(runId),
      delay(timeouts.perRunTimeoutMs),
    ]));
    await Promise.race([Promise.all(waits).then(() => undefined), delay(timeouts.overallTimeoutMs)]);
  }

  return { trigger, cancel, waitForTerminal, drain };
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
