import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTempDir } from '../test-factories.js';
import {
  AgentBindingConflictError,
  AgentBindingStore,
} from './agent-binding-store.js';

const connectionId = '11111111-1111-4111-8111-111111111111';

describe('AgentBindingStore', () => {
  it('returns an empty local binding set for a shareable agent', async () => {
    const store = new AgentBindingStore(join(createTempDir('agent-bindings-empty'), 'agent-bindings.json'));

    await expect(store.get('daily-focus')).resolves.toEqual({
      revision: 0,
      connections: {},
      skills: {},
    });
  });

  it('stores a local skill implementation outside the shareable agent file', async () => {
    const path = join(createTempDir('agent-skill-bindings-write'), 'agent-bindings.json');
    const store = new AgentBindingStore(path);

    const saved = await store.replace('daily-manuscript-review', {}, 0, {
      editorial_diagnostic: { path: '/shared/skills/fiction-diagnostic' },
    });

    expect(saved.skills).toEqual({
      editorial_diagnostic: { path: '/shared/skills/fiction-diagnostic' },
    });
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      agents: {
        'daily-manuscript-review': {
          connections: {},
          skills: {
            editorial_diagnostic: { path: '/shared/skills/fiction-diagnostic' },
          },
        },
      },
    });
  });

  it('stores local connection and resource identities outside the agent file', async () => {
    const path = join(createTempDir('agent-bindings-write'), 'agent-bindings.json');
    const store = new AgentBindingStore(path);

    const saved = await store.replace('daily-focus', {
      work_notes: {
        connection_id: connectionId,
        resources: {
          report_database: {
            id: 'data-source-id',
            operation_ids: { 'notion.page.create': 'database-id' },
          },
        },
      },
    }, 0);

    expect(saved).toEqual({
      revision: 1,
      connections: {
        work_notes: {
          connection_id: connectionId,
          resources: {
            report_database: {
              id: 'data-source-id',
              operation_ids: { 'notion.page.create': 'database-id' },
            },
          },
        },
      },
    });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      schema_version: 1,
      agents: {
        'daily-focus': {
          revision: 1,
          connections: saved.connections,
        },
      },
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('rejects a stale settings write without changing current bindings', async () => {
    const store = new AgentBindingStore(join(createTempDir('agent-bindings-stale'), 'agent-bindings.json'));
    await store.replace('daily-focus', {
      work_notes: { connection_id: connectionId, resources: {} },
    }, 0);

    await expect(store.replace('daily-focus', {}, 0)).rejects.toBeInstanceOf(
      AgentBindingConflictError,
    );
    await expect(store.get('daily-focus')).resolves.toEqual({
      revision: 1,
      connections: {
        work_notes: { connection_id: connectionId, resources: {} },
      },
    });
  });

  it('serializes concurrent writes and applies one expected revision once', async () => {
    const store = new AgentBindingStore(join(createTempDir('agent-bindings-concurrent'), 'agent-bindings.json'));
    const first = store.replace('daily-focus', {
      work_notes: { connection_id: connectionId, resources: {} },
    }, 0);
    const second = store.replace('daily-focus', {}, 0);

    await expect(first).resolves.toEqual(expect.objectContaining({ revision: 1 }));
    await expect(second).rejects.toBeInstanceOf(AgentBindingConflictError);
  });

  it('removes a newly saved local binding set with its exact revision', async () => {
    const store = new AgentBindingStore(join(createTempDir('agent-bindings-remove'), 'agent-bindings.json'));
    const saved = await store.replace('daily-focus', {
      work_notes: { connection_id: connectionId, resources: {} },
    }, 0);

    await expect(store.remove('daily-focus', saved.revision)).resolves.toBe(true);
    await expect(store.get('daily-focus')).resolves.toEqual({
      revision: 0, connections: {}, skills: {},
    });
  });
});
