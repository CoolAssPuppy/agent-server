import { describe, it, expect } from 'vitest';
import { ExecutorRegistry } from './executor-registry.js';
import type { AgentConfig } from '../agents/config.js';
import type { Reporter } from './runner.js';
import type { ExecutionResult } from './executor.js';
import { makeAgent, makeExecutionResult } from '../test-factories.js';

const noopReporter: Reporter = {
  start: () => {},
  progress: () => {},
  complete: () => {},
  fail: () => {},
  stop: () => {},
};

const fakeExecutor = async (_agent: AgentConfig, _reporter: Reporter): Promise<ExecutionResult> => {
  return makeExecutionResult({ summary: 'fake result' });
};

describe('ExecutorRegistry', () => {
  it('registers and retrieves an executor by name', () => {
    const registry = new ExecutorRegistry();
    registry.register('test-executor', fakeExecutor);

    const retrieved = registry.get('test-executor');
    expect(retrieved).toBe(fakeExecutor);
  });

  it('throws when getting an unregistered executor', () => {
    const registry = new ExecutorRegistry();

    expect(() => registry.get('nonexistent')).toThrow('Unknown executor: nonexistent');
  });

  it('returns the default executor when no name is specified', () => {
    const registry = new ExecutorRegistry();
    registry.register('claude-code', fakeExecutor);
    registry.setDefault('claude-code');

    const retrieved = registry.get();
    expect(retrieved).toBe(fakeExecutor);
  });

  it('throws when getting default executor if none is set', () => {
    const registry = new ExecutorRegistry();

    expect(() => registry.get()).toThrow('No default executor configured');
  });

  it('lists registered executor names', () => {
    const registry = new ExecutorRegistry();
    const otherExecutor = async () => makeExecutionResult();
    registry.register('claude-code', fakeExecutor);
    registry.register('codex', otherExecutor);

    const names = registry.list();
    expect(names).toEqual(['claude-code', 'codex']);
  });

  it('overwrites an existing executor when re-registered', () => {
    const registry = new ExecutorRegistry();
    const replacement = async () => makeExecutionResult({ summary: 'replaced' });

    registry.register('claude-code', fakeExecutor);
    registry.register('claude-code', replacement);

    expect(registry.get('claude-code')).toBe(replacement);
  });

  it('resolves executor from agent config', async () => {
    const registry = new ExecutorRegistry();
    registry.register('claude-code', fakeExecutor);
    registry.setDefault('claude-code');

    const agent = makeAgent({ executor: 'claude-code' });
    const executor = registry.resolve(agent);
    const result = await executor(agent, noopReporter);
    expect(result.summary).toBe('fake result');
  });

  it('falls back to default when agent has no executor field', async () => {
    const registry = new ExecutorRegistry();
    registry.register('claude-code', fakeExecutor);
    registry.setDefault('claude-code');

    const agent = makeAgent();
    const executor = registry.resolve(agent);
    const result = await executor(agent, noopReporter);
    expect(result.summary).toBe('fake result');
  });
});
