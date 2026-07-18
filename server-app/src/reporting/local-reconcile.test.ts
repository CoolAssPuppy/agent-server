import { describe, it, expect } from 'vitest';
import { RunStore } from './store.js';
import { failOrphanedLocalRuns, ORPHANED_RUN_ERROR } from './local-reconcile.js';
import { makeStoredRun } from '../test-factories.js';

describe('failOrphanedLocalRuns', () => {
  it('marks runs left running as failed', () => {
    const store = new RunStore();
    store.add(makeStoredRun({ runId: 'ghost', status: 'running', completedAt: undefined }));

    const reconciled = failOrphanedLocalRuns(store);

    expect(reconciled).toEqual(['ghost']);
    const run = store.get('ghost');
    expect(run?.status).toBe('failed');
    expect(run?.error).toBe(ORPHANED_RUN_ERROR);
    expect(run?.completedAt).toBeInstanceOf(Date);
  });

  it('leaves terminal runs untouched', () => {
    const store = new RunStore();
    store.add(makeStoredRun({ runId: 'done', status: 'completed', summary: 'ok' }));
    store.add(makeStoredRun({ runId: 'failed', status: 'failed', error: 'boom' }));
    store.add(makeStoredRun({ runId: 'skipped', status: 'skipped' }));

    const reconciled = failOrphanedLocalRuns(store);

    expect(reconciled).toEqual([]);
    expect(store.get('done')?.status).toBe('completed');
    expect(store.get('done')?.summary).toBe('ok');
    expect(store.get('failed')?.error).toBe('boom');
    expect(store.get('skipped')?.status).toBe('skipped');
  });

  it('reconciles only the running runs in a mixed store', () => {
    const store = new RunStore();
    store.add(makeStoredRun({ runId: 'r1', status: 'running' }));
    store.add(makeStoredRun({ runId: 'r2', status: 'completed' }));
    store.add(makeStoredRun({ runId: 'r3', status: 'running' }));

    const reconciled = failOrphanedLocalRuns(store).sort();

    expect(reconciled).toEqual(['r1', 'r3']);
    expect(store.get('r2')?.status).toBe('completed');
  });

  it('accepts a custom reason', () => {
    const store = new RunStore();
    store.add(makeStoredRun({ runId: 'ghost', status: 'running' }));

    failOrphanedLocalRuns(store, 'Machine slept');

    expect(store.get('ghost')?.error).toBe('Machine slept');
  });

  it('does nothing on an empty store', () => {
    expect(failOrphanedLocalRuns(new RunStore())).toEqual([]);
  });
});
