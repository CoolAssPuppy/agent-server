import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTempDir } from '../test-factories.js';
import { ConnectionProfileStore, type ConnectionProfileDraft } from './profile-store.js';

const draft = (label: string, environmentVariable: string): ConnectionProfileDraft => ({
  label,
  adapter: { id: 'mcp.custom', version: 1 },
  credentials: [{ label: 'Token', environment_variable: environmentVariable, secret: true }],
  transport: {
    kind: 'mcp_http',
    url: 'https://service.example/mcp',
    headers: [{ name: 'Authorization', credential_index: 0, prefix: 'Bearer ' }],
  },
});

describe('ConnectionProfileStore', () => {
  it('persists references without credential values in a private workspace file', async () => {
    const path = join(createTempDir('connections'), 'connections.json');
    const store = new ConnectionProfileStore(path);

    const saved = await store.create(draft('Personal workspace', 'EXISTING_PERSONAL_TOKEN'));
    const source = await readFile(path, 'utf8');
    const mode = (await stat(path)).mode & 0o777;

    expect(saved.id).not.toContain(saved.label);
    expect(source).toContain('EXISTING_PERSONAL_TOKEN');
    expect(source).not.toContain('must-never-be-stored');
    expect(mode).toBe(0o600);
  });

  it('allows duplicate labels while preserving distinct opaque identities', async () => {
    const store = new ConnectionProfileStore(join(createTempDir('connections'), 'connections.json'));

    const first = await store.create(draft('Work', 'FIRST_TOKEN'));
    const second = await store.create(draft('Work', 'SECOND_TOKEN'));

    expect(first.id).not.toBe(second.id);
    expect((await store.list()).map((connection) => connection.label)).toEqual(['Work', 'Work']);
  });

  it('renames presentation without changing adapter, credentials, or transport', async () => {
    const store = new ConnectionProfileStore(join(createTempDir('connections'), 'connections.json'));
    const original = await store.create(draft('Old label', 'UNCHANGED_TOKEN'));

    const renamed = await store.rename(original.id, 'Anything else');

    expect(renamed).toMatchObject({
      id: original.id,
      label: 'Anything else',
      adapter: original.adapter,
      credentials: original.credentials,
      transport: original.transport,
    });
  });
});
