import { mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { AgentConfig } from './agents/config.js';
import type { ExecutionResult } from './execution/executor.js';
import type { StoredRun } from './reporting/store.js';

export function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    schedule: '* * * * *',
    prompt: 'Do something.',
    tools: [],
    max_turns: 20,
    enabled: true,
    ...overrides,
  };
}

export function makeExecutionResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    summary: 'Done',
    output: {},
    usage: { turns: 3 },
    turnCount: 3,
    toolsUsed: ['Read'],
    filesRead: [],
    filesWritten: [],
    commandsRun: [],
    ...overrides,
  };
}

export function makeStoredRun(overrides: Partial<StoredRun> = {}): StoredRun {
  return {
    runId: 'run-1',
    agentId: 'test-agent',
    agentName: 'Test Agent',
    status: 'completed',
    startedAt: new Date('2026-03-09T10:00:00Z'),
    turnCount: 3,
    toolsUsed: ['Read'],
    filesRead: [],
    filesWritten: [],
    commandsRun: [],
    progressMessages: [],
    ...overrides,
  };
}

export function createTempDir(label: string = 'test'): string {
  const dir = join(tmpdir(), `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
