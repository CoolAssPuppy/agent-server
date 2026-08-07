import { statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTempDir } from '../test-factories.js';
import type { ConnectionCapabilitySnapshot } from './capability-snapshot.js';
import { ConnectionCapabilityStore } from './capability-store.js';

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';

function snapshot(): ConnectionCapabilitySnapshot {
  return {
    schema_version: 1,
    connection_id: CONNECTION_ID,
    source: 'stored_profile',
    adapter: { id: 'notion.rest-mcp', version: 1 },
    operations: [{
      id: 'mcp:API-post-search',
      runtime_name: 'API-post-search',
      effects: ['read'],
      classification: 'curated',
    }],
    capability_version: `sha256:${'a'.repeat(64)}`,
    classification_version: 'stored-mcp-v1',
    captured_at: '2026-08-06T12:00:00.000Z',
  };
}

describe('connection capability store', () => {
  it('persists owner-only snapshots and removes stale entries', async () => {
    const path = join(createTempDir('connection-capabilities'), 'capabilities.json');
    const store = new ConnectionCapabilityStore(path);

    await store.put(snapshot());

    expect(await store.get(CONNECTION_ID)).toEqual(snapshot());
    expect(statSync(path).mode & 0o777).toBe(0o600);
    await store.remove(CONNECTION_ID);
    expect(await store.get(CONNECTION_ID)).toBeUndefined();
  });
});
