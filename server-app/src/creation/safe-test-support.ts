import type { AgentConfig } from '../agents/config.js';
import type { AgentExecutor } from '../agents/executor.js';
import type { ExecutionResult } from '../execution/executor.js';
import { basename } from 'node:path';

export type SafeTestEffects = {
  files: 'reviewed_read_only';
  commands: 'blocked';
  network: 'blocked';
  connections: 'simulated';
  externalWrites: 'blocked';
};

export type SafeTestSupport =
  | { available: true; executor: AgentExecutor; effects: SafeTestEffects }
  | { available: false; executor: AgentExecutor; reason: string };

const ENFORCED_EFFECTS: SafeTestEffects = {
  files: 'reviewed_read_only',
  commands: 'blocked',
  network: 'blocked',
  connections: 'simulated',
  externalWrites: 'blocked',
};

/** Return only executor guarantees backed by the composed runtime boundary. */
export function safeTestSupport(agent: AgentConfig): SafeTestSupport {
  return safeTestSupportForExecutor(agent.executor ?? 'claude-code');
}

export function safeTestSupportForExecutor(executor: AgentExecutor): SafeTestSupport {
  if (executor === 'codex') {
    return {
      available: false,
      executor,
      reason: 'Safe test is unavailable for Codex because command isolation has not been proven.',
    };
  }
  return { available: true, executor, effects: ENFORCED_EFFECTS };
}

/** Replace model opinion with a factual statement of the enforced test effects. */
export function safeTestResultSummary(result: ExecutionResult): string {
  const readCount = result.filesRead.length;
  const readStatement = readCount === 0
    ? 'It did not record any local file reads.'
    : readCount === 1
      ? `It read ${basename(result.filesRead[0] ?? '') || 'a reviewed local file'} from its reviewed local files.`
      : `It read ${readCount} reviewed local files, including ${result.filesRead
        .slice(0, 3)
        .map((path) => basename(path) || 'a local file')
        .join(', ')}.`;
  return `Safe test finished. ${readStatement} External actions were not performed. `
    + 'File creation, command execution, messages, and connected-service changes were blocked.';
}

export class SafeTestUnavailableError extends Error {
  readonly code = 'safe_test_unavailable';

  constructor(readonly support: Extract<SafeTestSupport, { available: false }>) {
    super(support.reason);
    this.name = 'SafeTestUnavailableError';
  }
}
