import { randomUUID } from 'crypto';
import type { AgentConfig } from '../agents/config.js';
import type { ExecutionResult } from './executor.js';
import { acquireLock, releaseLock } from './lockfile.js';
import { sanitizePromptSuffix } from '../server/security-utils.js';
import { assessPromptInjectionRisk, wrapUntrustedUserContext } from './prompt-injection.js';
import type { DecisionContext } from './decision-handler.js';
import { toErrorMessage } from '../util/errors.js';
import { withTimeout } from '../util/with-timeout.js';
import {
  assertRequiredOutput,
  OutputContractError,
} from './output-contract.js';

export const RUN_TIMEOUT_CODE = 'run_timeout';
export const LOCK_CONTENTION_CODE = 'lock_contention';
export const RUN_CANCELED_CODE = 'run_canceled';
export const USER_CANCELED_CODE = 'user_canceled';

export type RunResult = {
  runId?: string;
  status: 'completed' | 'failed' | 'skipped';
  error?: string;
  /**
   * Machine-readable failure cause. Populated on wall-clock timeouts as
   * `run_timeout`. Callers (e.g. the server's WebSocket broadcaster) use
   * this to distinguish timeouts from generic failures or user cancels.
   */
  code?: string;
  result?: ExecutionResult;
};

export type Reporter = {
  start: () => Promise<void> | void;
  progress: (message: string, metadata?: Record<string, unknown>) => Promise<void> | void;
  complete: (result: ExecutionResult) => Promise<void> | void;
  fail: (error: Error) => Promise<void> | void;
  cancel?: (reason?: string, code?: string) => Promise<void> | void;
  stop: () => void;
};

type RunAgentOptions = {
  /** Canonical ID allocated by the caller that owns local run state. */
  runId?: string;
  agent: AgentConfig;
  lockDir: string;
  execute: (
    agent: AgentConfig,
    reporter: Reporter,
    context?: { runId: string; decisionContext?: DecisionContext },
  ) => Promise<ExecutionResult>;
  createReporter: (runId: string, agentName: string, conversationId?: string) => Reporter;
  promptSuffix?: string;
  conversationId?: string;
  mode?: 'normal' | 'safe_test';
  buildDecisionContext?: (runId: string) => DecisionContext | undefined;
  /**
   * Maximum wall-clock duration for the run in milliseconds. When elapsed,
   * the run is aborted and marked failed with code `run_timeout`. The lock is
   * retained until an in-flight executor actually terminates. Undefined
   * disables the timer (back-compat default).
   */
  timeoutMs?: number;
  /**
   * Optional AbortController. When the timeout fires, the runner calls
   * `abort(reason)` on this controller so the executor (e.g. Claude SDK) can
   * surface the abort to in-flight tool calls. The runner also races the
   * executor against the timeout, so it returns even if the executor
   * ignores the abort signal.
   */
  abortController?: AbortController;
};

export async function runAgent(options: RunAgentOptions): Promise<RunResult> {
  const {
    agent,
    lockDir,
    execute,
    createReporter,
    promptSuffix,
    conversationId,
    buildDecisionContext,
    timeoutMs,
    abortController,
  } = options;
  const runId = options.runId ?? randomUUID();

  if (!acquireLock(lockDir, agent.id)) {
    const reason = `This run was skipped because ${agent.name} is already running.`;
    // Record the rejected invocation so it remains explainable in run history.
    try {
      const reporter = options.createReporter(runId, agent.name, options.conversationId);
      if (typeof reporter.cancel === 'function') {
        await reporter.cancel(reason, LOCK_CONTENTION_CODE);
      } else {
        await reporter.fail(new Error(`${LOCK_CONTENTION_CODE}: ${reason}`));
      }
      reporter.stop();
    } catch (err) {
      // Best-effort notification; never fail the parent just because the
      // notification couldn't be delivered. Log so we don't silently drop the
      // reason a run "vanished" when debugging lock contention.
      const message = toErrorMessage(err);
      console.warn(
        `[runner] Failed to emit lock_contention notification for agent=${agent.id} name=${agent.name}: ${message}`,
      );
    }
    return { runId, status: 'skipped', code: LOCK_CONTENTION_CODE, error: reason };
  }

  const reporter = createReporter(runId, agent.name, conversationId);

  const safePromptSuffix = promptSuffix ? sanitizePromptSuffix(promptSuffix) : undefined;
  const guardPromptInput = process.env.AGENT_SERVER_PROMPT_INJECTION_GUARD !== 'false';
  const strictPromptInput = process.env.AGENT_SERVER_PROMPT_INJECTION_STRICT === 'true';

  const injectionAssessment = safePromptSuffix
    ? assessPromptInjectionRisk(safePromptSuffix)
    : null;

  const contextualSuffix = safePromptSuffix
    ? guardPromptInput
      ? wrapUntrustedUserContext(safePromptSuffix)
      : safePromptSuffix
    : undefined;

  const effectiveAgent = contextualSuffix
    ? { ...agent, prompt: `${agent.prompt}\n\nUser context (sanitized):\n${contextualSuffix}` }
    : agent;

  let executionPromise: Promise<ExecutionResult> | undefined;
  let isExecutionSettled = true;
  let isTimedOut = false;
  let shouldReleaseLock = true;

  try {
    throwIfAborted(abortController);
    const runWork = (async (): Promise<ExecutionResult> => {
      await reporter.start();
      if (isTimedOut) throw createTimeoutError(timeoutMs ?? 0);
      throwIfAborted(abortController);

      if (injectionAssessment?.suspicious) {
        await reporter.progress(
          `Security warning: suspicious user context detected (${injectionAssessment.reasons.join(', ')})`,
          {
            security_event: 'prompt_injection_suspected',
            score: injectionAssessment.score,
            reasons: injectionAssessment.reasons,
          },
        );
        if (isTimedOut) throw createTimeoutError(timeoutMs ?? 0);

        if (strictPromptInput) {
          throw new Error('Rejected suspicious prompt suffix by AGENT_SERVER_PROMPT_INJECTION_STRICT');
        }
      }

      throwIfAborted(abortController);
      const decisionContext = buildDecisionContext?.(runId);
      isExecutionSettled = false;
      executionPromise = execute(effectiveAgent, reporter, { runId, decisionContext });
      let result: ExecutionResult;
      try {
        result = await executionPromise;
      } finally {
        isExecutionSettled = true;
      }

      // The timeout path already emitted its terminal state. An executor that
      // honored cancellation late must not emit a second terminal event.
      if (isTimedOut) return result;
      throwIfAborted(abortController);

      assertRequiredOutput(agent, result, { mode: options.mode });
      return result;
    })();

    const result = await withTimeout(runWork, {
      timeoutMs,
      createError: () => createTimeoutError(timeoutMs ?? 0),
      onTimeout: (error) => {
        isTimedOut = true;
        try {
          abortController?.abort(error);
        } catch {
          // Node <20 may not accept an abort reason; the deadline still wins.
        }
      },
    });
    await reporter.complete(result);
    reporter.stop();
    return { runId, status: 'completed', result };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (isTimeoutError(error)) {
      if (typeof reporter.cancel === 'function') {
        await reporter.cancel(error.message, RUN_TIMEOUT_CODE);
      } else {
        await reporter.fail(error);
      }
      reporter.stop();

      if (executionPromise && !isExecutionSettled) {
        shouldReleaseLock = false;
        void executionPromise.then(
          () => releaseLock(lockDir, agent.id),
          () => releaseLock(lockDir, agent.id),
        );
      }
      return { runId, status: 'failed', error: error.message, code: RUN_TIMEOUT_CODE };
    }
    if (isAbortError(error)) {
      const code = abortReasonCode(abortController);
      if (typeof reporter.cancel === 'function') {
        await reporter.cancel(error.message || 'Canceled', code);
      } else {
        await reporter.fail(error);
      }
      reporter.stop();
      return { runId, status: 'failed', error: error.message, code };
    }
    await reporter.fail(error);
    reporter.stop();
    return {
      runId,
      status: 'failed',
      error: error.message,
      code: error instanceof OutputContractError ? error.code : undefined,
    };
  } finally {
    if (shouldReleaseLock) releaseLock(lockDir, agent.id);
  }
}

function throwIfAborted(abortController: AbortController | undefined): void {
  if (!abortController?.signal.aborted) return;
  const reason = abortController.signal.reason;
  if (reason instanceof Error) throw reason;
  throw new DOMException('The operation was aborted', 'AbortError');
}

function abortReasonCode(abortController: AbortController | undefined): string {
  const reason = abortController?.signal.reason;
  if (reason && typeof reason === 'object' && 'code' in reason) {
    const code = reason.code;
    if (code === USER_CANCELED_CODE) return USER_CANCELED_CODE;
  }
  return RUN_CANCELED_CODE;
}

function createTimeoutError(timeoutMs: number): Error {
  const error = new Error(`Run exceeded timeout of ${timeoutMs}ms`);
  error.name = 'RunTimeoutError';
  (error as Error & { code?: string }).code = RUN_TIMEOUT_CODE;
  return error;
}

function isTimeoutError(error: Error): boolean {
  return error.name === 'RunTimeoutError'
    || (error as Error & { code?: unknown }).code === RUN_TIMEOUT_CODE;
}

function isAbortError(error: Error): boolean {
  if (error.name === 'AbortError') return true;
  const message = error.message ?? '';
  return /\babort/i.test(message);
}
