import { describe, expect, it } from 'vitest';
import { ConnectionProfileSchema, type ConnectionProfile } from './profile.js';

const profile = (): ConnectionProfile => ({
  schema_version: 1,
  id: '018f47a2-9a13-7d61-bf4f-f9a5d8f67c21',
  label: 'Whatever I want to call this',
  adapter: { id: 'mcp.custom', version: 1 },
  runtime_name: 'connection_018f47a29a137d61bf4ff9a5d8f67c21',
  credentials: [{
    id: '018f47a2-d541-7fb1-ae66-bb2c92b90de1',
    label: 'Primary token',
    environment_variable: 'MY_EXISTING_TOKEN',
    secret: true,
  }],
  transport: {
    kind: 'mcp_stdio',
    command: '/opt/homebrew/bin/example-mcp',
    args: ['serve'],
    environment: {
      API_TOKEN: '018f47a2-d541-7fb1-ae66-bb2c92b90de1',
    },
  },
  created_at: '2026-07-19T18:00:00.000Z',
  updated_at: '2026-07-19T18:00:00.000Z',
});

describe('ConnectionProfileSchema', () => {
  it('keeps a user label separate from adapter and transport identity', () => {
    const parsed = ConnectionProfileSchema.parse(profile());

    expect(parsed.label).toBe('Whatever I want to call this');
    expect(parsed.adapter.id).toBe('mcp.custom');
    expect(parsed.runtime_name).toBe('connection_018f47a29a137d61bf4ff9a5d8f67c21');
    expect(parsed.transport.kind).toBe('mcp_stdio');
  });

  it('supports several credential references in one connection', () => {
    const parsed = ConnectionProfileSchema.parse({
      ...profile(),
      credentials: [
        ...profile().credentials,
        {
          id: '018f47a2-d5ab-7b60-a93e-264a84698675',
          label: 'Signing secret',
          environment_variable: 'MY_SIGNING_SECRET',
          secret: true,
        },
      ],
    });

    expect(parsed.credentials.map((credential) => credential.environment_variable))
      .toEqual(['MY_EXISTING_TOKEN', 'MY_SIGNING_SECRET']);
  });

  it('rejects embedded credential values and unknown transport fields', () => {
    expect(() => ConnectionProfileSchema.parse({
      ...profile(),
      credentials: [{ ...profile().credentials[0], value: 'must-never-be-stored' }],
    })).toThrow();
  });

  it('rejects transport bindings to credentials outside the connection', () => {
    expect(() => ConnectionProfileSchema.parse({
      ...profile(),
      transport: {
        ...profile().transport,
        environment: { API_TOKEN: '018f47a2-0000-7000-8000-000000000000' },
      },
    })).toThrow(/credential/i);
  });
});
