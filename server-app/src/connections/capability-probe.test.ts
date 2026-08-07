import { describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile } from './profile.js';
import {
  inputFieldPaths,
  probeStoredMcpCapabilities,
  resolveProfileCredentials,
} from './capability-probe.js';

const profile: ConnectionProfile = {
  schema_version: 1,
  id: '11111111-1111-4111-8111-111111111111',
  label: 'Notion Work',
  adapter: { id: 'notion.rest-mcp', version: 1 },
  runtime_name: 'notion_work',
  credentials: [{
    id: '22222222-2222-4222-8222-222222222222',
    label: 'Token', environment_variable: 'NOTION_TOKEN', secret: true,
  }],
  transport: {
    kind: 'mcp_http',
    url: 'https://notion.example/mcp',
    headers: [{
      name: 'Authorization',
      credential_id: '22222222-2222-4222-8222-222222222222',
      prefix: 'Bearer ',
    }],
  },
  created_at: '2026-08-06T12:00:00.000Z',
  updated_at: '2026-08-06T12:00:00.000Z',
};

describe('saved connection capability probe', () => {
  it('records nested input paths reached through local JSON Schema references', () => {
    const schema = {
      type: 'object',
      properties: {
        parent: {
          anyOf: [{ $ref: '#/$defs/parent' }, { type: 'string' }],
        },
      },
      $defs: {
        parent: {
          oneOf: [{ $ref: '#/$defs/dataSourceParent' }],
        },
        dataSourceParent: {
          type: 'object',
          properties: {
            database_id: { type: 'string' },
          },
        },
      },
    };

    expect(inputFieldPaths(schema)).toEqual(['parent', 'parent.database_id']);
  });

  it('classifies the concrete names returned by a bounded MCP check', async () => {
    const loadOperations = vi.fn().mockResolvedValue([
      { name: 'API-post-search', inputFields: ['query'] },
      { name: 'API-post-page', inputFields: ['data_source_id', 'properties'] },
    ]);

    const snapshot = await probeStoredMcpCapabilities(
      profile,
      { NOTION_TOKEN: 'secret-value' },
      { now: () => '2026-08-06T13:00:00.000Z', loadOperations },
    );

    expect(loadOperations).toHaveBeenCalledWith(
      profile,
      { Authorization: 'Bearer secret-value' },
      10_000,
    );
    expect(snapshot.operations.map(({ runtime_name: name }) => name))
      .toEqual(['API-post-page', 'API-post-search']);
    expect(snapshot.operations[0]?.input_fields).toEqual(['data_source_id', 'properties']);
    expect(JSON.stringify(snapshot)).not.toContain('secret-value');
  });

  it('resolves only credential references declared by the profile', () => {
    expect(resolveProfileCredentials(profile, { NOTION_TOKEN: 'secret-value' }))
      .toEqual({ Authorization: 'Bearer secret-value' });
    expect(() => resolveProfileCredentials(profile, {}))
      .toThrow('Notion Work needs NOTION_TOKEN');
  });

  it('rejects duplicate concrete tool names instead of hiding an ambiguous inventory', async () => {
    await expect(probeStoredMcpCapabilities(profile, { NOTION_TOKEN: 'secret-value' }, {
      loadOperations: async () => [
        { name: 'duplicate_tool', inputFields: [] },
        { name: 'duplicate_tool', inputFields: ['id'] },
      ],
    })).rejects.toThrow('Duplicate MCP tool name: duplicate_tool');
  });
});
