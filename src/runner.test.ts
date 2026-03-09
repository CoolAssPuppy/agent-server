import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runAgent, type RunResult } from './runner.js';
import type { AgentConfig } from './agent-config.js';
import type { ExecutionResult } from './executor.js';

function createTempDir(): string {
  const dir = join(tmpdir(), `runner-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    schedule: '* * * * *',
    prompt: 'Say hello.',
    tools: [],
    max_turns: 20,
    enabled: true,
    ...overrides,
  };
}

function makeExecutionResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    summary: 'Done',
    output: {},
    usage: { turns: 3 },
    turnCount: 3,
    toolsUsed: ['Read'],
    ...overrides,
  };
}

const noop = async () => {};

describe('runAgent', () => {
  let lockDir: string;
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('generates a run ID and returns it', async () => {
    lockDir = createTempDir();
    dirs.push(lockDir);

    const result = await runAgent({
      agent: makeAgent(),
      lockDir,
      execute: async () => makeExecutionResult(),
      createReporter: () => ({
        start: noop,
        progress: noop,
        complete: noop,
        fail: noop,
        stop: () => {},
      }),
    });

    expect(result.runId).toBeDefined();
    expect(result.runId.length).toBeGreaterThan(0);
    expect(result.status).toBe('completed');
  });

  it('calls execute with the agent config', async () => {
    lockDir = createTempDir();
    dirs.push(lockDir);
    const execute = vi.fn().mockResolvedValue(makeExecutionResult());
    const agent = makeAgent({ id: 'specific-agent' });

    await runAgent({
      agent,
      lockDir,
      execute,
      createReporter: () => ({
        start: noop,
        progress: noop,
        complete: noop,
        fail: noop,
        stop: () => {},
      }),
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][0]).toBe(agent);
  });

  it('reports started and completed events', async () => {
    lockDir = createTempDir();
    dirs.push(lockDir);
    const start = vi.fn();
    const complete = vi.fn();

    await runAgent({
      agent: makeAgent(),
      lockDir,
      execute: async () => makeExecutionResult({ summary: 'All done' }),
      createReporter: () => ({
        start,
        progress: noop,
        complete,
        fail: noop,
        stop: () => {},
      }),
    });

    expect(start).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0][0].summary).toBe('All done');
  });

  it('reports failure when executor throws', async () => {
    lockDir = createTempDir();
    dirs.push(lockDir);
    const fail = vi.fn();
    const stop = vi.fn();

    const result = await runAgent({
      agent: makeAgent(),
      lockDir,
      execute: async () => { throw new Error('Executor crashed'); },
      createReporter: () => ({
        start: noop,
        progress: noop,
        complete: noop,
        fail,
        stop,
      }),
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('Executor crashed');
    expect(fail).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('releases lock after successful execution', async () => {
    lockDir = createTempDir();
    dirs.push(lockDir);

    await runAgent({
      agent: makeAgent(),
      lockDir,
      execute: async () => makeExecutionResult(),
      createReporter: () => ({
        start: noop,
        progress: noop,
        complete: noop,
        fail: noop,
        stop: () => {},
      }),
    });

    const { isLocked } = await import('./lockfile.js');
    expect(isLocked(lockDir, 'test-agent')).toBe(false);
  });

  it('releases lock after failed execution', async () => {
    lockDir = createTempDir();
    dirs.push(lockDir);

    await runAgent({
      agent: makeAgent(),
      lockDir,
      execute: async () => { throw new Error('fail'); },
      createReporter: () => ({
        start: noop,
        progress: noop,
        complete: noop,
        fail: noop,
        stop: () => {},
      }),
    });

    const { isLocked } = await import('./lockfile.js');
    expect(isLocked(lockDir, 'test-agent')).toBe(false);
  });

  it('returns skipped when agent is already locked', async () => {
    lockDir = createTempDir();
    dirs.push(lockDir);

    const { acquireLock } = await import('./lockfile.js');
    acquireLock(lockDir, 'test-agent');

    const result = await runAgent({
      agent: makeAgent(),
      lockDir,
      execute: async () => makeExecutionResult(),
      createReporter: () => ({
        start: noop,
        progress: noop,
        complete: noop,
        fail: noop,
        stop: () => {},
      }),
    });

    expect(result.status).toBe('skipped');
    expect(result.runId).toBeUndefined();
  });
});
