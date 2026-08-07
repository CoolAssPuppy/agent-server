import { describe, expect, it } from 'vitest';
import { makeAgent } from '../test-factories.js';
import type { AgentBindingSet } from '../agents/agent-binding-store.js';
import type { ConnectionProfile } from './profile.js';
import { prepareAgentConnections } from './prepared-agent.js';
import { runtimeCodexAppPolicies, runtimeConnectionPolicy } from './runtime-policy.js';
import type { ConnectionOperationBindings } from './operation-binding-store.js';
import {
  connectionProfileFingerprint,
  type ConnectionCapabilitySnapshot,
} from './capability-snapshot.js';

const CONNECTION_ID = '018f47a2-9a13-7d61-bf4f-f9a5d8f67c21';

function notionProfile(): ConnectionProfile {
  return {
    schema_version: 1,
    id: CONNECTION_ID,
    label: 'Notion Work',
    adapter: { id: 'notion.rest-mcp', version: 1 },
    runtime_name: 'connection_018f47a29a137d61bf4ff9a5d8f67c21',
    credentials: [],
    transport: { kind: 'mcp_http', url: 'https://mcp.notion.example', headers: [] },
    created_at: '2026-08-06T12:00:00.000Z',
    updated_at: '2026-08-06T12:00:00.000Z',
  };
}

function localBindings(): AgentBindingSet {
  return {
    revision: 1,
    connections: {
      work_notes: {
        connection_id: CONNECTION_ID,
        resources: { report_database: { id: 'database-local-123' } },
      },
    },
  };
}

describe('prepared agent connections', () => {
  it('turns portable connection uses into a local transport and exact grants', () => {
    const agent = makeAgent({
      connections: {
        work_notes: {
          type: 'notion',
          name: 'Notion Work',
          purpose: 'Publish the daily focus page',
          operations: ['notion.search', 'notion.page.read', 'notion.page.create'],
          resources: {
            report_database: {
              type: 'notion.data_source',
              purpose: 'Daily focus destination',
              access: 'write',
            },
          },
        },
      },
      output: {
        primary: {
          description: 'One daily focus page',
          use: 'work_notes',
          operation: 'notion.page.create',
          target: 'report_database',
          required: true,
          successful_calls: { min: 1, max: 1 },
        },
      },
      connection_bindings: undefined,
      mcp_servers: undefined,
      permissions: undefined,
    });

    const prepared = prepareAgentConnections(agent, localBindings(), [notionProfile()]);

    expect(prepared.connection_bindings).toEqual({
      connection_018f47a29a137d61bf4ff9a5d8f67c21: CONNECTION_ID,
    });
    expect(prepared.permissions?.allow).toEqual([
      'mcp__connection_018f47a29a137d61bf4ff9a5d8f67c21__API-post-search',
      'mcp__connection_018f47a29a137d61bf4ff9a5d8f67c21__API-retrieve-page-markdown',
      'mcp__connection_018f47a29a137d61bf4ff9a5d8f67c21__API-post-page',
    ]);
    expect(prepared.output?.primary).toMatchObject({
      tool: 'mcp__connection_018f47a29a137d61bf4ff9a5d8f67c21__API-post-page',
      target: 'database-local-123',
      target_match: { field: 'parent.database_id', equals: 'database-local-123' },
    });
    expect(prepared.prompt).toContain('work_notes');
    expect(prepared.prompt).toContain('Notion Work');
    expect(prepared.prompt).toContain('Publish the daily focus page');
    expect(prepared.prompt).toContain('Daily focus destination');
    expect(prepared.prompt).toContain('access: write');
    expect(prepared.prompt).toContain('database-local-123');
    expect(runtimeConnectionPolicy(
      prepared,
      'connection_018f47a29a137d61bf4ff9a5d8f67c21',
    )).toEqual({
      allowedTools: [
        'API-post-search',
        'API-retrieve-page-markdown',
        'API-post-page',
      ],
      argumentConstraints: {
        'API-post-page': { 'parent.database_id': ['database-local-123'] },
      },
    });
  });

  it('uses an operation-specific local resource identity when an API has separate read and write IDs', () => {
    const agent = makeAgent({
      connections: {
        work_notes: {
          type: 'notion',
          name: 'Notion Work',
          purpose: 'Read and publish reports',
          operations: ['notion.data_source.query', 'notion.page.create'],
          resources: {
            report_database: {
              type: 'notion.data_source', purpose: 'Reports', access: 'read_write',
            },
          },
        },
      },
      output: {
        primary: {
          description: 'One report', use: 'work_notes', operation: 'notion.page.create',
          target: 'report_database', required: true,
        },
      },
    });
    const bindings: AgentBindingSet = {
      revision: 1,
      connections: {
        work_notes: {
          connection_id: CONNECTION_ID,
          resources: {
            report_database: {
              id: 'data-source-123',
              operation_ids: { 'notion.page.create': 'database-456' },
            },
          },
        },
      },
    };

    const prepared = prepareAgentConnections(agent, bindings, [notionProfile()]);

    expect(runtimeConnectionPolicy(
      prepared,
      'connection_018f47a29a137d61bf4ff9a5d8f67c21',
    )?.argumentConstraints).toEqual({
      'API-query-data-source': { data_source_id: ['data-source-123'] },
      'API-post-page': { 'parent.database_id': ['database-456'] },
    });
    expect(prepared.output?.primary).toMatchObject({
      target: 'database-456',
      target_match: { field: 'parent.database_id', equals: 'database-456' },
    });
    expect(prepared.prompt).toContain(
      'notion.data_source.query: set data_source_id="data-source-123"',
    );
    expect(prepared.prompt).toContain(
      'notion.page.create: set parent.database_id="database-456"',
    );
  });

  it('rejects missing local connection choices before starting a runtime', () => {
    const agent = makeAgent({
      connections: {
        work_notes: {
          type: 'notion',
          name: 'Notion Work',
          purpose: 'Read work notes',
          operations: ['notion.search'],
          resources: {},
        },
      },
    });

    expect(() => prepareAgentConnections(agent, { revision: 0, connections: {} }, []))
      .toThrow('Choose a local connection for "Notion Work"');
  });

  it('uses a runtime-owned account connection without injecting an MCP transport', () => {
    const profile: ConnectionProfile = {
      ...notionProfile(),
      service_type: 'notion',
      adapter: { id: 'claude.notion-account', version: 1 },
      runtime_name: 'claude_ai_Notion',
      transport: {
        kind: 'runtime_account',
        executor: 'claude-code',
        server_name: 'claude.ai Notion',
      },
    };
    const agent = makeAgent({
      connections: {
        work_notes: {
          type: 'notion', name: 'Notion Work', purpose: 'Search work notes',
          operations: ['notion.search'], resources: {},
        },
      },
    });
    const bindings: AgentBindingSet = {
      revision: 1,
      connections: {
        work_notes: { connection_id: CONNECTION_ID, resources: {} },
      },
    };
    const capabilityVersion = `sha256:${'a'.repeat(64)}`;
    const snapshot: ConnectionCapabilitySnapshot = {
      schema_version: 1, connection_id: CONNECTION_ID, source: 'stored_profile',
      adapter: profile.adapter, profile_fingerprint: connectionProfileFingerprint(profile),
      operations: [{
        id: 'mcp:notion-search', runtime_name: 'notion-search', effects: ['read'],
        classification: 'unknown', input_fields: [],
      }],
      capability_version: capabilityVersion,
      classification_version: 'stored-mcp-v1', captured_at: '2026-08-06T12:00:00.000Z',
    };
    const mappings: ConnectionOperationBindings = {
      revision: 1, capability_version: capabilityVersion,
      updated_at: '2026-08-06T12:01:00.000Z',
      operations: {
        'notion.search': { runtime_name: 'notion-search', effect: 'read' },
      },
    };

    const prepared = prepareAgentConnections(
      agent, bindings, [profile], new Map([[CONNECTION_ID, snapshot]]),
      new Map([[CONNECTION_ID, mappings]]),
    );

    expect(prepared.connection_bindings).toEqual({});
    expect(prepared.mcp_servers).toBeUndefined();
    expect(prepared.permissions?.allow).toContain('mcp__claude_ai_Notion__notion-search');
  });

  it('compiles a Codex app connection into an exact app and tool policy', () => {
    const appId = 'asdk_app_69c18c28f1188191bf5b8445c4ab0a2e';
    const profile: ConnectionProfile = {
      ...notionProfile(),
      service_type: 'notion',
      adapter: { id: 'codex.notion-app', version: 1 },
      runtime_name: 'codex_notion_work',
      transport: { kind: 'runtime_account', executor: 'codex', server_name: appId },
    };
    const agent = makeAgent({
      connections: {
        work_notes: {
          type: 'notion', name: 'Notion Work', purpose: 'Publish a report',
          operations: ['notion.search', 'notion.page.create'],
          resources: {
            report_database: {
              type: 'notion.data_source', purpose: 'Report destination', access: 'write',
            },
          },
        },
      },
      output: {
        primary: {
          description: 'One report', use: 'work_notes', operation: 'notion.page.create',
          target: 'report_database', required: true,
        },
      },
    });
    const capabilityVersion = `sha256:${'b'.repeat(64)}`;
    const snapshot: ConnectionCapabilitySnapshot = {
      schema_version: 1, connection_id: CONNECTION_ID, source: 'stored_profile',
      adapter: profile.adapter, profile_fingerprint: connectionProfileFingerprint(profile),
      operations: [
        {
          id: 'mcp:notion.search', runtime_name: 'notion.search',
          effects: ['read'], classification: 'unknown',
        },
        {
          id: 'mcp:notion.notion-create-pages', runtime_name: 'notion.notion-create-pages',
          effects: ['unknown'], classification: 'unknown', input_fields: ['parent.data_source_id'],
        },
        {
          id: 'mcp:notion.notion-update-page', runtime_name: 'notion.notion-update-page',
          effects: ['unknown'], classification: 'unknown',
        },
      ],
      capability_version: capabilityVersion,
      classification_version: 'stored-mcp-v1', captured_at: '2026-08-06T12:00:00.000Z',
    };
    const mappings: ConnectionOperationBindings = {
      revision: 1, capability_version: capabilityVersion,
      updated_at: '2026-08-06T12:01:00.000Z',
      operations: {
        'notion.search': { runtime_name: 'notion.search', effect: 'read' },
        'notion.page.create': {
          runtime_name: 'notion.notion-create-pages', effect: 'write',
          target: { argument: 'parent.data_source_id', resource_type: 'notion.data_source' },
        },
      },
    };

    const prepared = prepareAgentConnections(
      agent, localBindings(), [profile], new Map([[CONNECTION_ID, snapshot]]),
      new Map([[CONNECTION_ID, mappings]]),
    );

    expect(prepared.connection_bindings).toEqual({});
    expect(prepared.permissions?.allow).toEqual([
      'mcp__codex_apps__notion.search',
      'mcp__codex_apps__notion.notion-create-pages',
    ]);
    expect(prepared.output?.primary).toMatchObject({
      tool: 'mcp__codex_apps__notion.notion-create-pages',
      target_match: { field: 'parent.data_source_id', equals: 'database-local-123' },
    });
    expect(runtimeCodexAppPolicies(prepared)).toEqual({
      [appId]: {
        availableTools: [
          'notion.search', 'notion.notion-create-pages', 'notion.notion-update-page',
        ],
        tools: {
          'notion.search': { effect: 'read' },
          'notion.notion-create-pages': { effect: 'write' },
        },
      },
    });
  });

  it('rejects write operations that only have read-only resources', () => {
    const agent = makeAgent({
      connections: {
        work_notes: {
          type: 'notion',
          name: 'Notion Work',
          purpose: 'Read reports',
          operations: ['notion.page.create'],
          resources: {
            report_database: {
              type: 'notion.data_source',
              purpose: 'Report source',
              access: 'read',
            },
          },
        },
      },
    });

    expect(() => prepareAgentConnections(agent, localBindings(), [notionProfile()]))
      .toThrow('cannot use notion.page.create with read-only resources');
  });

  it('gives a write operation only resources with write access', () => {
    const agent = makeAgent({
      connections: {
        work_notes: {
          type: 'notion',
          name: 'Notion Work',
          purpose: 'Publish reports while reading an archive',
          operations: ['notion.page.create'],
          resources: {
            archive: {
              type: 'notion.data_source', purpose: 'Read-only archive', access: 'read',
            },
            reports: {
              type: 'notion.data_source', purpose: 'Report destination', access: 'write',
            },
          },
        },
      },
    });
    const bindings: AgentBindingSet = {
      revision: 1,
      connections: {
        work_notes: {
          connection_id: CONNECTION_ID,
          resources: {
            archive: { id: 'archive-123' },
            reports: { id: 'reports-123' },
          },
        },
      },
    };

    const prepared = prepareAgentConnections(agent, bindings, [notionProfile()]);

    expect(runtimeConnectionPolicy(
      prepared,
      'connection_018f47a29a137d61bf4ff9a5d8f67c21',
    )?.argumentConstraints).toEqual({
      'API-post-page': { 'parent.database_id': ['reports-123'] },
    });
  });

  it('rejects a targeted write operation without a declared writable resource', () => {
    const agent = makeAgent({
      connections: {
        work_notes: {
          type: 'notion',
          name: 'Notion Work',
          purpose: 'Publish reports',
          operations: ['notion.page.create'],
          resources: {},
        },
      },
    });
    const bindings: AgentBindingSet = {
      revision: 1,
      connections: {
        work_notes: { connection_id: CONNECTION_ID, resources: {} },
      },
    };

    expect(() => prepareAgentConnections(agent, bindings, [notionProfile()]))
      .toThrow('requires a writable notion.data_source resource');
  });

  it('rejects a targeted read operation without a declared readable resource', () => {
    const agent = makeAgent({
      connections: {
        work_notes: {
          type: 'notion',
          name: 'Notion Work',
          purpose: 'Query reports',
          operations: ['notion.data_source.query'],
          resources: {},
        },
      },
    });
    const bindings: AgentBindingSet = {
      revision: 1,
      connections: {
        work_notes: { connection_id: CONNECTION_ID, resources: {} },
      },
    };

    expect(() => prepareAgentConnections(agent, bindings, [notionProfile()]))
      .toThrow('requires a readable notion.data_source resource');
  });

  it('requires a current checked inventory when a capability source is configured', () => {
    const agent = makeAgent({
      connections: {
        work_notes: {
          type: 'notion',
          name: 'Notion Work',
          purpose: 'Publish reports',
          operations: ['notion.page.create'],
          resources: {
            report_database: {
              type: 'notion.data_source',
              purpose: 'Report destination',
              access: 'write',
            },
          },
        },
      },
    });

    expect(() => prepareAgentConnections(agent, localBindings(), [notionProfile()], new Map()))
      .toThrow('Check "Notion Work" again');
  });

  it('requires another check when the saved transport changes', () => {
    const checkedProfile = notionProfile();
    const snapshot = {
      schema_version: 1 as const,
      connection_id: CONNECTION_ID,
      source: 'stored_profile' as const,
      adapter: checkedProfile.adapter,
      profile_fingerprint: connectionProfileFingerprint(checkedProfile),
      operations: [{
        id: 'mcp:API-post-search', runtime_name: 'API-post-search', effects: ['read' as const],
        classification: 'curated' as const, input_fields: [],
      }],
      capability_version: `sha256:${'a'.repeat(64)}` as const,
      classification_version: 'stored-mcp-v1' as const,
      captured_at: '2026-08-06T12:00:00.000Z',
    };
    const changedProfile: ConnectionProfile = {
      ...checkedProfile,
      transport: {
        kind: 'mcp_http', url: 'https://changed.example/mcp', headers: [],
      },
    };
    const agent = makeAgent({
      connections: {
        work_notes: {
          type: 'notion', name: 'Notion Work', purpose: 'Search work notes',
          operations: ['notion.search'], resources: {},
        },
      },
    });
    const bindings: AgentBindingSet = {
      revision: 1,
      connections: {
        work_notes: { connection_id: CONNECTION_ID, resources: {} },
      },
    };

    expect(() => prepareAgentConnections(
      agent,
      bindings,
      [changedProfile],
      new Map([[CONNECTION_ID, snapshot]]),
      new Map([[CONNECTION_ID, { revision: 0, operations: {} }]]),
    )).toThrow('Check "Notion Work" again');
  });

  it('uses a reviewed local operation mapping for an otherwise unknown MCP adapter', () => {
    const profile: ConnectionProfile = {
      ...notionProfile(),
      adapter: { id: 'documents.mcp', version: 1 },
      runtime_name: 'documents_work',
    };
    const agent = makeAgent({
      connections: {
        work_documents: {
          type: 'documents',
          name: 'Documents Work',
          purpose: 'Publish a report',
          operations: ['documents.create'],
          resources: {
            reports: {
              type: 'documents.database',
              purpose: 'Report destination',
              access: 'write',
            },
          },
        },
      },
    });
    const bindings: AgentBindingSet = {
      revision: 1,
      connections: {
        work_documents: {
          connection_id: CONNECTION_ID,
          resources: { reports: { id: 'reports-123' } },
        },
      },
    };
    const snapshot: ConnectionCapabilitySnapshot = {
      schema_version: 1,
      connection_id: CONNECTION_ID,
      source: 'stored_profile',
      adapter: profile.adapter,
      profile_fingerprint: connectionProfileFingerprint(profile),
      operations: [{
        id: 'mcp:create_document',
        runtime_name: 'create_document',
        effects: ['unknown'],
        classification: 'unknown',
        input_fields: ['database_id'],
      }],
      capability_version: `sha256:${'a'.repeat(64)}`,
      classification_version: 'stored-mcp-v1',
      captured_at: '2026-08-06T12:00:00.000Z',
    };
    const operationBindings: ConnectionOperationBindings = {
      revision: 1,
      capability_version: snapshot.capability_version,
      updated_at: '2026-08-06T13:00:00.000Z',
      operations: {
        'documents.create': {
          runtime_name: 'create_document',
          effect: 'write',
          target: { argument: 'database_id', resource_type: 'documents.database' },
        },
      },
    };

    const prepared = prepareAgentConnections(
      agent,
      bindings,
      [profile],
      new Map([[CONNECTION_ID, snapshot]]),
      new Map([[CONNECTION_ID, operationBindings]]),
    );

    expect(prepared.permissions?.allow).toEqual([
      'mcp__documents_work__create_document',
    ]);
    expect(runtimeConnectionPolicy(prepared, 'documents_work')).toEqual({
      allowedTools: ['create_document'],
      argumentConstraints: {
        create_document: { database_id: ['reports-123'] },
      },
    });
  });

  it('rejects a portable output target when its reviewed operation has no target argument', () => {
    const profile: ConnectionProfile = {
      ...notionProfile(),
      adapter: { id: 'documents.mcp', version: 1 },
      runtime_name: 'documents_work',
    };
    const agent = makeAgent({
      connections: {
        work_documents: {
          type: 'documents', name: 'Documents Work', purpose: 'Publish a report',
          operations: ['documents.create'],
          resources: {
            reports: {
              type: 'documents.database', purpose: 'Report destination', access: 'write',
            },
          },
        },
      },
      output: { primary: {
        description: 'One report', use: 'work_documents', operation: 'documents.create',
        target: 'reports', required: true,
      } },
    });
    const bindings: AgentBindingSet = {
      revision: 1,
      connections: {
        work_documents: {
          connection_id: CONNECTION_ID, resources: { reports: { id: 'reports-123' } },
        },
      },
    };
    const snapshot: ConnectionCapabilitySnapshot = {
      schema_version: 1, connection_id: CONNECTION_ID, source: 'stored_profile',
      adapter: profile.adapter,
      profile_fingerprint: connectionProfileFingerprint(profile),
      operations: [{
        id: 'mcp:create_document', runtime_name: 'create_document', effects: ['unknown'],
        classification: 'unknown', input_fields: ['title'],
      }],
      capability_version: `sha256:${'a'.repeat(64)}`,
      classification_version: 'stored-mcp-v1', captured_at: '2026-08-06T12:00:00.000Z',
    };
    const operationBindings: ConnectionOperationBindings = {
      revision: 1, capability_version: snapshot.capability_version,
      updated_at: '2026-08-06T13:00:00.000Z',
      operations: {
        'documents.create': { runtime_name: 'create_document', effect: 'write' },
      },
    };

    expect(() => prepareAgentConnections(
      agent,
      bindings,
      [profile],
      new Map([[CONNECTION_ID, snapshot]]),
      new Map([[CONNECTION_ID, operationBindings]]),
    )).toThrow('cannot enforce output target "reports"');
  });

  it('rejects an untargeted portable output when one tool fills two logical uses', () => {
    const agent = makeAgent({
      connections: {
        primary_notes: {
          type: 'notion', name: 'Notion Primary', purpose: 'Search primary notes',
          operations: ['notion.search'], resources: {},
        },
        archive_notes: {
          type: 'notion', name: 'Notion Archive', purpose: 'Search archived notes',
          operations: ['notion.search'], resources: {},
        },
      },
      output: { primary: {
        description: 'One completed search', use: 'primary_notes',
        operation: 'notion.search', required: true,
      } },
    });
    const bindings: AgentBindingSet = {
      revision: 1,
      connections: {
        primary_notes: { connection_id: CONNECTION_ID, resources: {} },
        archive_notes: { connection_id: CONNECTION_ID, resources: {} },
      },
    };

    expect(() => prepareAgentConnections(agent, bindings, [notionProfile()]))
      .toThrow('cannot identify which logical connection use produced it');
  });
});
