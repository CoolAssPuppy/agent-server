import { statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTempDir } from '../test-factories.js';
import type { ConnectionCapabilitySnapshot } from './capability-snapshot.js';
import {
  ConnectionOperationBindingConflictError,
  ConnectionOperationBindingStore,
} from './operation-binding-store.js';

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const CAPABILITY_VERSION = `sha256:${'a'.repeat(64)}`;

function snapshot(): ConnectionCapabilitySnapshot {
  return {
    schema_version: 1,
    connection_id: CONNECTION_ID,
    source: 'stored_profile',
    adapter: { id: 'mcp.custom', version: 1 },
    operations: [
      {
        id: 'mcp:list_documents',
        runtime_name: 'list_documents',
        effects: ['read'],
        classification: 'curated',
        input_fields: ['database_id'],
      },
      {
        id: 'mcp:create_document',
        runtime_name: 'create_document',
        effects: ['unknown'],
        classification: 'unknown',
        input_fields: ['database_id', 'title'],
      },
    ],
    capability_version: CAPABILITY_VERSION,
    classification_version: 'stored-mcp-v1',
    captured_at: '2026-08-06T12:00:00.000Z',
  };
}

describe('connection operation binding store', () => {
  it('persists reviewed semantic mappings with derived effects and owner-only access', async () => {
    const path = join(createTempDir('operation-bindings'), 'operation-bindings.json');
    const store = new ConnectionOperationBindingStore(path, () => '2026-08-06T13:00:00.000Z');

    const saved = await store.replace(
      CONNECTION_ID,
      snapshot(),
      {
        'documents.list': {
          runtime_name: 'list_documents',
          effect: 'read',
          target: { argument: 'database_id', resource_type: 'documents.database' },
        },
        'documents.create': {
          runtime_name: 'create_document',
          effect: 'write',
          target: { argument: 'database_id', resource_type: 'documents.database' },
        },
      },
      { expectedRevision: 0, expectedCapabilityVersion: CAPABILITY_VERSION },
    );

    expect(saved).toMatchObject({
      revision: 1,
      capability_version: CAPABILITY_VERSION,
      operations: {
        'documents.list': { runtime_name: 'list_documents', effect: 'read' },
        'documents.create': { runtime_name: 'create_document', effect: 'write' },
      },
    });
    expect(await store.get(CONNECTION_ID)).toEqual(saved);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('rejects stale edits, missing tools, and target arguments absent from checked input', async () => {
    const store = new ConnectionOperationBindingStore(
      join(createTempDir('operation-bindings'), 'operation-bindings.json'),
    );
    const checked = snapshot();

    await expect(store.replace(CONNECTION_ID, checked, {}, {
      expectedRevision: 0,
      expectedCapabilityVersion: `sha256:${'b'.repeat(64)}`,
    })).rejects.toBeInstanceOf(ConnectionOperationBindingConflictError);
    await expect(store.replace(CONNECTION_ID, checked, {
      'documents.delete': { runtime_name: 'delete_document', effect: 'write' },
    }, { expectedRevision: 0, expectedCapabilityVersion: CAPABILITY_VERSION }))
      .rejects.toThrow('is not in the checked tool inventory');
    await expect(store.replace(CONNECTION_ID, checked, {
      'documents.list': {
        runtime_name: 'list_documents',
        effect: 'read',
        target: { argument: 'workspace_id', resource_type: 'documents.database' },
      },
    }, { expectedRevision: 0, expectedCapabilityVersion: CAPABILITY_VERSION }))
      .rejects.toThrow('does not declare argument "workspace_id"');
    await expect(store.replace(CONNECTION_ID, checked, {
      'documents.list': { runtime_name: 'list_documents', effect: 'read' },
      'documents.search': { runtime_name: 'list_documents', effect: 'read' },
    }, { expectedRevision: 0, expectedCapabilityVersion: CAPABILITY_VERSION }))
      .rejects.toThrow('Concrete tools may only be mapped once');
  });

  it('uses an explicit reviewed effect for tools whose behavior cannot be classified', async () => {
    const store = new ConnectionOperationBindingStore(
      join(createTempDir('operation-bindings'), 'operation-bindings.json'),
    );

    const saved = await store.replace(CONNECTION_ID, snapshot(), {
      'documents.inspect': { runtime_name: 'create_document', effect: 'read' },
    }, { expectedRevision: 0, expectedCapabilityVersion: CAPABILITY_VERSION });

    expect(saved.operations['documents.inspect']?.effect).toBe('read');
  });

  it('removes mappings with a deleted connection', async () => {
    const store = new ConnectionOperationBindingStore(
      join(createTempDir('operation-bindings'), 'operation-bindings.json'),
    );
    await store.replace(CONNECTION_ID, snapshot(), {}, {
      expectedRevision: 0,
      expectedCapabilityVersion: CAPABILITY_VERSION,
    });

    await store.remove(CONNECTION_ID);

    expect(await store.get(CONNECTION_ID)).toEqual({ revision: 0, operations: {} });
  });
});
