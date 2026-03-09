import { describe, it, expect, beforeEach } from 'vitest';
import { RunStore } from './store.js';
import { makeStoredRun } from './test-factories.js';

describe('RunStore', () => {
  let store: RunStore;

  beforeEach(() => {
    store = new RunStore();
  });

  it('stores and retrieves a run', () => {
    const run = makeStoredRun();
    store.add(run);
    expect(store.get('run-1')).toEqual(run);
  });

  it('returns undefined for unknown run', () => {
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('lists all runs newest first', () => {
    store.add(makeStoredRun({ runId: 'old', startedAt: new Date('2026-03-09T09:00:00Z') }));
    store.add(makeStoredRun({ runId: 'new', startedAt: new Date('2026-03-09T11:00:00Z') }));
    store.add(makeStoredRun({ runId: 'mid', startedAt: new Date('2026-03-09T10:00:00Z') }));

    const runs = store.list();
    expect(runs.map((r) => r.runId)).toEqual(['new', 'mid', 'old']);
  });

  it('lists runs filtered by agent ID', () => {
    store.add(makeStoredRun({ runId: 'r1', agentId: 'agent-a' }));
    store.add(makeStoredRun({ runId: 'r2', agentId: 'agent-b' }));
    store.add(makeStoredRun({ runId: 'r3', agentId: 'agent-a' }));

    const runs = store.listByAgent('agent-a');
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.agentId === 'agent-a')).toBe(true);
  });

  it('updates a run', () => {
    store.add(makeStoredRun());
    store.update('run-1', { status: 'completed', turnCount: 5 });

    const run = store.get('run-1');
    expect(run?.status).toBe('completed');
    expect(run?.turnCount).toBe(5);
  });

  it('limits stored runs to max capacity', () => {
    const smallStore = new RunStore(3);
    smallStore.add(makeStoredRun({ runId: 'r1', startedAt: new Date('2026-01-01') }));
    smallStore.add(makeStoredRun({ runId: 'r2', startedAt: new Date('2026-01-02') }));
    smallStore.add(makeStoredRun({ runId: 'r3', startedAt: new Date('2026-01-03') }));
    smallStore.add(makeStoredRun({ runId: 'r4', startedAt: new Date('2026-01-04') }));

    expect(smallStore.list()).toHaveLength(3);
    expect(smallStore.get('r1')).toBeUndefined();
    expect(smallStore.get('r4')).toBeDefined();
  });

  it('appends progress messages', () => {
    store.add(makeStoredRun());
    store.addProgress('run-1', 'Step 1 done');
    store.addProgress('run-1', 'Step 2 done');

    const run = store.get('run-1');
    expect(run?.progressMessages).toEqual(['Step 1 done', 'Step 2 done']);
  });
});
