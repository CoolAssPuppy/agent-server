import { randomUUID } from 'crypto';
import type { AgentConfig } from '../agents/config.js';
import type { ExecutionResult } from './executor.js';
import { acquireLock, releaseLock } from './lockfile.js';
import { sanitizePromptSuffix } from '../server/security-utils.js';
import { assessPromptInjectionRisk, wrapUntrustedUserContext } from './prompt-injection.js';
import type { DecisionContext } from './decision-handler.js';
import { toErrorMessage } from '../util/errors.js';

export const RUN_TIMEOUT_CODE = 'run_timeout';

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
  buildDecisionContext?: (runId: string) => DecisionContext | undefined;
  /**
   * Maximum wall-clock duration for the run in milliseconds. When elapsed,
   * the run is aborted, marked failed with code `run_timeout`, and the lock
   * is released. Undefined disables the timer (back-compat default).
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

  if (!acquireLock(lockDir, agent.id)) {
    // Fix 4: Panel should still record that a concurrent invocation was
    // rejected. Build a minimal reporter and emit a canceled status with
    // `lock_contention` so the run appears in history instead of silently
    // vanishing.
    try {
      const runId = randomUUID();
      const reporter = options.createReporter(runId, agent.name, options.conversationId);
      if (typeof reporter.cancel === 'function') {
        await reporter.cancel('Another invocation of this agent is already running.', 'lock_contention');
      } else {
        await reporter.fail(new Error('lock_contention: another invocation is already running'));
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
    return { status: 'skipped' };
  }

  const runId = randomUUID();
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

  try {
    await reporter.start();

    if (injectionAssessment?.suspicious) {
      await reporter.progress(
        `Security warning: suspicious user context detected (${injectionAssessment.reasons.join(', ')})`,
        {
          security_event: 'prompt_injection_suspected',
          score: injectionAssessment.score,
          reasons: injectionAssessment.reasons,
        },
      );

      if (strictPromptInput) {
        throw new Error('Rejected suspicious prompt suffix by AGENT_SERVER_PROMPT_INJECTION_STRICT');
      }
    }

    const decisionContext = buildDecisionContext?.(runId);
    const result = await raceWithTimeout(
      execute(effectiveAgent, reporter, { runId, decisionContext }),
      timeoutMs,
      abortController,
    );
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
      return { runId, status: 'failed', error: error.message, code: RUN_TIMEOUT_CODE };
    }
    if (isAbortError(error)) {
      if (typeof reporter.cancel === 'function') {
        await reporter.cancel(error.message || 'Canceled');
      } else {
        await reporter.fail(error);
      }
      reporter.stop();
      return { runId, status: 'failed', error: error.message };
    }
    await reporter.fail(error);
    reporter.stop();
    return { runId, status: 'failed', error: error.message };
  } finally {
    releaseLock(lockDir, agent.id);
  }
}

async function raceWithTimeout<T>(
  work: Promise<T>,
  timeoutMs: number | undefined,
  abortController: AbortController | undefined,
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return work;

  let handle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    handle = setTimeout(() => {
      const error = createTimeoutError(timeoutMs);
      try {
        abortController?.abort(error);
      } catch {
        // Node <20 may not accept an abort reason; fall through.
      }
      reject(error);
    }, timeoutMs);
    if (handle.unref) handle.unref();
  });

  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    if (handle) clearTimeout(handle);
  }
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
