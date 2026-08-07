import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTempDir } from '../test-factories.js';
import {
  RuntimeAssignmentConflictError,
  RuntimeAssignmentStore,
} from './runtime-assignment-store.js';

const firstRevision = 1;

describe('RuntimeAssignmentStore', () => {
  it('persists strict runtime assignments in an owner-only atomic JSON store', async () => {
    const path = join(createTempDir('runtime-assignments'), 'runtime-assignments.json');
    const store = new RuntimeAssignmentStore(path, {
      now: () => '2026-08-06T12:00:00.000Z',
    });

    const saved = await store.set('daily-report', {
      executor: 'codex',
      model: 'gpt-5.4',
      provider: {
        base_url: 'https://api.moonshot.ai/v1',
        api_key: '${MOONSHOT_API_KEY}',
      },
    });
    const source = await readFile(path, 'utf8');

    expect(saved).toEqual({
      agent_id: 'daily-report',
      executor: 'codex',
      model: 'gpt-5.4',
      provider: {
        base_url: 'https://api.moonshot.ai/v1',
        api_key: '${MOONSHOT_API_KEY}',
      },
      revision: firstRevision,
      updated_at: '2026-08-06T12:00:00.000Z',
    });
    expect(JSON.parse(source)).toEqual({
      schema_version: 1,
      assignments: { 'daily-report': saved },
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('gets, lists, updates, and removes assignments with revision checks', async () => {
    const store = new RuntimeAssignmentStore(
      join(createTempDir('runtime-assignments'), 'runtime-assignments.json'),
      { now: () => '2026-08-06T12:00:00.000Z' },
    );
    const first = await store.set('daily-report', { executor: 'claude-code' });
    await store.set('weekly-report', { executor: 'kimi-code', model: 'kimi-k2.5' });

    const updated = await store.set(
      'daily-report',
      { executor: 'codex', model: 'gpt-5.4' },
      { expectedRevision: first.revision },
    );

    expect(updated.revision).toBe(2);
    expect(await store.get('daily-report')).toEqual(updated);
    expect((await store.list()).map(({ agent_id }) => agent_id)).toEqual([
      'daily-report',
      'weekly-report',
    ]);

    await store.remove('daily-report', { expectedRevision: updated.revision });
    expect(await store.get('daily-report')).toBeUndefined();
  });

  it('rejects stale updates and removals without changing stored state', async () => {
    const store = new RuntimeAssignmentStore(
      join(createTempDir('runtime-assignments'), 'runtime-assignments.json'),
    );
    const original = await store.set('daily-report', { executor: 'claude-code' });

    await expect(store.set(
      'daily-report',
      { executor: 'codex' },
      { expectedRevision: original.revision + 1 },
    )).rejects.toBeInstanceOf(RuntimeAssignmentConflictError);
    await expect(store.remove(
      'daily-report',
      { expectedRevision: original.revision + 1 },
    )).rejects.toBeInstanceOf(RuntimeAssignmentConflictError);
    expect(await store.get('daily-report')).toEqual(original);
  });

  it('requires a revision when replacing or removing an existing assignment', async () => {
    const store = new RuntimeAssignmentStore(
      join(createTempDir('runtime-assignments'), 'runtime-assignments.json'),
    );
    await store.set('daily-report', { executor: 'claude-code' });

    await expect(store.set('daily-report', { executor: 'codex' }))
      .rejects.toBeInstanceOf(RuntimeAssignmentConflictError);
    await expect(store.remove('daily-report'))
      .rejects.toBeInstanceOf(RuntimeAssignmentConflictError);
  });

  it('serializes concurrent writes so the same revision cannot win twice', async () => {
    const store = new RuntimeAssignmentStore(
      join(createTempDir('runtime-assignments'), 'runtime-assignments.json'),
    );
    const original = await store.set('daily-report', { executor: 'claude-code' });

    const results = await Promise.allSettled([
      store.set('daily-report', { executor: 'codex' }, { expectedRevision: original.revision }),
      store.set('daily-report', { executor: 'kimi-code' }, { expectedRevision: original.revision }),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect((await store.get('daily-report'))?.revision).toBe(2);
  });

  it('returns frozen values that cannot mutate later reads', async () => {
    const store = new RuntimeAssignmentStore(
      join(createTempDir('runtime-assignments'), 'runtime-assignments.json'),
    );
    const saved = await store.set('daily-report', {
      executor: 'codex',
      provider: { base_url: 'http://localhost:11434/v1' },
    });
    const listed = await store.list();

    expect(Object.isFrozen(saved)).toBe(true);
    expect(Object.isFrozen(saved.provider)).toBe(true);
    expect(Object.isFrozen(listed)).toBe(true);
    expect(Object.isFrozen(listed[0])).toBe(true);
  });

  it('rejects invalid agent IDs, fields, executors, and persisted documents', async () => {
    const path = join(createTempDir('runtime-assignments'), 'runtime-assignments.json');
    const store = new RuntimeAssignmentStore(path);

    await expect(store.set('Has Spaces', { executor: 'codex' })).rejects.toThrow();
    await expect(store.set('daily-report', {
      executor: 'codex',
      extra: true,
    })).rejects.toThrow();
    await expect(store.set('daily-report', { executor: 'unknown' })).rejects.toThrow();

    await writeFile(path, JSON.stringify({
      schema_version: 1,
      assignments: {
        'daily-report': {
          agent_id: 'different-agent',
          executor: 'codex',
          revision: 1,
          updated_at: '2026-08-06T12:00:00.000Z',
        },
      },
    }));

    await expect(store.list()).rejects.toThrow();
  });
});
