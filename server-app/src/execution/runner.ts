import { randomUUID } from 'crypto';
import type { AgentConfig } from '../agents/config.js';
import type { ExecutionResult } from './executor.js';
import { acquireLock, releaseLock } from './lockfile.js';
import { sanitizePromptSuffix } from '../server/security-utils.js';
import { assessPromptInjectionRisk, wrapUntrustedUserContext } from './prompt-injection.js';
import type { DecisionContext } from './decision-handler.js';

export type RunResult = {
  runId?: string;
  status: 'completed' | 'failed' | 'skipped';
  error?: string;
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
};

export async function runAgent(options: RunAgentOptions): Promise<RunResult> {
  const { agent, lockDir, execute, createReporter, promptSuffix, conversationId, buildDecisionContext } = options;

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
    } catch {
      // Best-effort notification; never fail the parent just because the
      // notification couldn't be delivered.
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
    const result = await execute(effectiveAgent, reporter, { runId, decisionContext });
    await reporter.complete(result);
    reporter.stop();
    return { runId, status: 'completed', result };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
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

function isAbortError(error: Error): boolean {
  if (error.name === 'AbortError') return true;
  const message = error.message ?? '';
  return /\babort/i.test(message);
}
