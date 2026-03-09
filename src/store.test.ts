import { describe, it, expect, beforeEach } from 'vitest';
import { RunStore, type StoredRun } from './store.js';

function makeRun(overrides: Partial<StoredRun> = {}): StoredRun {
  return {
    runId: 'run-1',
    agentId: 'test-agent',
    agentName: 'Test Agent',
    status: 'running',
    startedAt: new Date('2026-03-09T10:00:00Z'),
    turnCount: 0,
    toolsUsed: [],
    filesRead: [],
    filesWritten: [],
    commandsRun: [],
    progressMessages: [],
    ...overrides,
  };
}

describe('RunStore', () => {
  let store: RunStore;

  beforeEach(() => {
    store = new RunStore();
  });

  it('stores and retrieves a run', () => {
    const run = makeRun();
    store.add(run);
    expect(store.get('run-1')).toEqual(run);
  });

  it('returns undefined for unknown run', () => {
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('lists all runs newest first', () => {
    store.add(makeRun({ runId: 'old', startedAt: new Date('2026-03-09T09:00:00Z') }));
    store.add(makeRun({ runId: 'new', startedAt: new Date('2026-03-09T11:00:00Z') }));
    store.add(makeRun({ runId: 'mid', startedAt: new Date('2026-03-09T10:00:00Z') }));

    const runs = store.list();
    expect(runs.map((r) => r.runId)).toEqual(['new', 'mid', 'old']);
  });

  it('lists runs filtered by agent ID', () => {
    store.add(makeRun({ runId: 'r1', agentId: 'agent-a' }));
    store.add(makeRun({ runId: 'r2', agentId: 'agent-b' }));
    store.add(makeRun({ runId: 'r3', agentId: 'agent-a' }));

    const runs = store.listByAgent('agent-a');
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.agentId === 'agent-a')).toBe(true);
  });

  it('updates a run', () => {
    store.add(makeRun());
    store.update('run-1', { status: 'completed', turnCount: 5 });

    const run = store.get('run-1');
    expect(run?.status).toBe('completed');
    expect(run?.turnCount).toBe(5);
  });

  it('limits stored runs to max capacity', () => {
    const smallStore = new RunStore(3);
    smallStore.add(makeRun({ runId: 'r1', startedAt: new Date('2026-01-01') }));
    smallStore.add(makeRun({ runId: 'r2', startedAt: new Date('2026-01-02') }));
    smallStore.add(makeRun({ runId: 'r3', startedAt: new Date('2026-01-03') }));
    smallStore.add(makeRun({ runId: 'r4', startedAt: new Date('2026-01-04') }));

    expect(smallStore.list()).toHaveLength(3);
    expect(smallStore.get('r1')).toBeUndefined();
    expect(smallStore.get('r4')).toBeDefined();
  });

  it('appends progress messages', () => {
    store.add(makeRun());
    store.addProgress('run-1', 'Step 1 done');
    store.addProgress('run-1', 'Step 2 done');

    const run = store.get('run-1');
    expect(run?.progressMessages).toEqual(['Step 1 done', 'Step 2 done']);
  });
});
