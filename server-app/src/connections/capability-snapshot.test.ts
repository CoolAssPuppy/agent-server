import { describe, expect, it } from 'vitest';
import type { ConnectionProfile } from './profile.js';
import {
  ConnectionCapabilitySnapshotSchema,
  classifyStoredMcpCapabilities,
} from './capability-snapshot.js';

const NOTION_REST_TOOL_EFFECTS = {
  'API-create-a-comment': 'create',
  'API-create-a-data-source': 'create',
  'API-delete-a-block': 'delete',
  'API-get-block-children': 'read',
  'API-get-self': 'read',
  'API-get-user': 'read',
  'API-get-users': 'read',
  'API-list-data-source-templates': 'read',
  'API-move-page': 'update',
  'API-patch-block-children': 'update',
  'API-patch-page': 'update',
  'API-post-page': 'create',
  'API-post-search': 'read',
  'API-query-data-source': 'read',
  'API-retrieve-a-block': 'read',
  'API-retrieve-a-comment': 'read',
  'API-retrieve-a-data-source': 'read',
  'API-retrieve-a-database': 'read',
  'API-retrieve-a-page': 'read',
  'API-retrieve-a-page-property': 'read',
  'API-retrieve-page-markdown': 'read',
  'API-update-a-block': 'update',
  'API-update-a-data-source': 'update',
  'API-update-page-markdown': 'update',
} as const;

const profile = (overrides: Partial<ConnectionProfile> = {}): ConnectionProfile => ({
  schema_version: 1,
  id: '018f47a2-9a13-7d61-bf4f-f9a5d8f67c21',
  label: 'Personal workspace',
  adapter: { id: 'mcp.custom', version: 1 },
  runtime_name: 'connection_018f47a29a137d61bf4ff9a5d8f67c21',
  credentials: [],
  transport: {
    kind: 'mcp_stdio',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    environment: {},
  },
  created_at: '2026-07-19T18:00:00.000Z',
  updated_at: '2026-07-19T18:00:00.000Z',
  ...overrides,
});

describe('stored MCP capability classification', () => {
  it('classifies the complete current Notion REST operation surface', () => {
    const snapshot = classifyStoredMcpCapabilities(profile(), {
      capturedAt: '2026-07-19T19:00:00.000Z',
    });

    expect(Object.fromEntries(snapshot.operations.map((operation) => [
      operation.runtime_name,
      operation.effects[0],
    ]))).toEqual(NOTION_REST_TOOL_EFFECTS);
    expect(snapshot.operations).toHaveLength(24);
    expect(snapshot.operations.every(({ classification }) => classification === 'curated')).toBe(true);
    expect(ConnectionCapabilitySnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it('keeps POST search and query operations read-only', () => {
    const snapshot = classifyStoredMcpCapabilities(profile(), {
      capturedAt: '2026-07-19T19:00:00.000Z',
    });

    expect(snapshot.operations.find(({ runtime_name }) => runtime_name === 'API-post-search')?.effects)
      .toEqual(['read']);
    expect(snapshot.operations.find(({ runtime_name }) => runtime_name === 'API-query-data-source')?.effects)
      .toEqual(['read']);
  });

  it('keeps unrecognized operations unknown even on a curated transport', () => {
    const snapshot = classifyStoredMcpCapabilities(profile(), {
      capturedAt: '2026-07-19T19:00:00.000Z',
      operationNames: ['API-post-search', 'API-new-unreviewed-operation'],
    });

    expect(snapshot.operations).toEqual([
      {
        id: 'mcp:API-new-unreviewed-operation',
        runtime_name: 'API-new-unreviewed-operation',
        effects: ['unknown'],
        classification: 'unknown',
      },
      {
        id: 'mcp:API-post-search',
        runtime_name: 'API-post-search',
        effects: ['read'],
        classification: 'curated',
      },
    ]);
  });

  it('does not let a presentation label change classification or capability version', () => {
    const capturedAt = '2026-07-19T19:00:00.000Z';
    const first = classifyStoredMcpCapabilities(profile({ label: 'Notion' }), { capturedAt });
    const renamed = classifyStoredMcpCapabilities(profile({ label: 'Anything else' }), { capturedAt });

    expect(renamed.operations).toEqual(first.operations);
    expect(renamed.capability_version).toBe(first.capability_version);
  });

  it('classifies custom operation inventories as unknown by default', () => {
    const custom = profile({
      label: 'Notion',
      transport: {
        kind: 'mcp_http',
        url: 'https://custom.example/mcp',
        headers: [],
      },
    });

    const snapshot = classifyStoredMcpCapabilities(custom, {
      capturedAt: '2026-07-19T19:00:00.000Z',
      operationNames: ['API-post-search', 'send_everything'],
    });

    expect(snapshot.operations).toEqual([
      {
        id: 'mcp:API-post-search',
        runtime_name: 'API-post-search',
        effects: ['unknown'],
        classification: 'unknown',
      },
      {
        id: 'mcp:send_everything',
        runtime_name: 'send_everything',
        effects: ['unknown'],
        classification: 'unknown',
      },
    ]);
  });

  it('normalizes duplicate stored inventory names into a stable snapshot', () => {
    const custom = profile({
      transport: {
        kind: 'mcp_http',
        url: 'https://custom.example/mcp',
        headers: [],
      },
    });
    const capturedAt = '2026-07-19T19:00:00.000Z';

    const first = classifyStoredMcpCapabilities(custom, {
      capturedAt,
      operationNames: ['zeta', 'alpha', 'zeta'],
    });
    const reordered = classifyStoredMcpCapabilities(custom, {
      capturedAt,
      operationNames: ['alpha', 'zeta'],
    });

    expect(first.operations.map(({ runtime_name }) => runtime_name)).toEqual(['alpha', 'zeta']);
    expect(first.capability_version).toBe(reordered.capability_version);
  });
});
