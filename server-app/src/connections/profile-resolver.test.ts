import { describe, expect, it } from 'vitest';
import type { ConnectionProfile } from './profile.js';
import { resolveConnectionProfile } from './profile-resolver.js';

const profile = (label: string): ConnectionProfile => ({
  schema_version: 1,
  id: '018f47a2-9a13-7d61-bf4f-f9a5d8f67c21',
  label,
  adapter: { id: 'mcp.custom', version: 1 },
  runtime_name: 'connection_018f47a29a137d61bf4ff9a5d8f67c21',
  credentials: [{
    id: '018f47a2-d541-7fb1-ae66-bb2c92b90de1',
    label: 'Token',
    environment_variable: 'EXISTING_TOKEN',
    secret: true,
  }],
  transport: {
    kind: 'mcp_stdio',
    command: '/usr/local/bin/example-mcp',
    args: ['serve'],
    environment: { TOKEN: '018f47a2-d541-7fb1-ae66-bb2c92b90de1' },
  },
  created_at: '2026-07-19T18:00:00.000Z',
  updated_at: '2026-07-19T18:00:00.000Z',
});

describe('resolveConnectionProfile', () => {
  it('materializes credential references without reading or embedding their values', () => {
    expect(resolveConnectionProfile(profile('Anything'))).toEqual({
      serverName: 'connection_018f47a29a137d61bf4ff9a5d8f67c21',
      config: {
        command: '/usr/local/bin/example-mcp',
        args: ['serve'],
        env: { TOKEN: '${EXISTING_TOKEN}' },
      },
    });
  });

  it('keeps the effective runtime binding identical after a label change', () => {
    expect(resolveConnectionProfile(profile('First name')))
      .toEqual(resolveConnectionProfile(profile('A completely different name')));
  });

  it('materializes remote credential headers with their reviewed prefix', () => {
    const base = profile('Remote');
    const input: ConnectionProfile = {
      ...base,
      transport: {
        kind: 'mcp_http',
        url: 'https://service.example/mcp',
        headers: [{ name: 'Authorization', credential_id: base.credentials[0].id, prefix: 'Bearer ' }],
      },
    };

    expect(resolveConnectionProfile(input).config).toEqual({
      type: 'http',
      url: 'https://service.example/mcp',
      headers: { Authorization: 'Bearer ${EXISTING_TOKEN}' },
    });
  });
});
