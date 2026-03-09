import { randomUUID } from 'crypto';
import type { AgentConfig } from '../agents/config.js';
import type { ExecutionResult } from './executor.js';
import { acquireLock, releaseLock } from './lockfile.js';

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
  stop: () => void;
};

type RunAgentOptions = {
  agent: AgentConfig;
  lockDir: string;
  execute: (agent: AgentConfig, reporter: Reporter) => Promise<ExecutionResult>;
  createReporter: (runId: string, agentName: string) => Reporter;
};

export async function runAgent(options: RunAgentOptions): Promise<RunResult> {
  const { agent, lockDir, execute, createReporter } = options;

  if (!acquireLock(lockDir, agent.id)) {
    return { status: 'skipped' };
  }

  const runId = randomUUID();
  const reporter = createReporter(runId, agent.name);

  try {
    await reporter.start();
    const result = await execute(agent, reporter);
    await reporter.complete(result);
    reporter.stop();
    return { runId, status: 'completed', result };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    await reporter.fail(error);
    reporter.stop();
    return { runId, status: 'failed', error: error.message };
  } finally {
    releaseLock(lockDir, agent.id);
  }
}
