import { describe, expect, it } from 'vitest';
import { makeAgent } from '../test-factories.js';
import type { ConnectionProfile } from '../connections/profile.js';
import { evaluateRuntimeCompatibility } from './runtime-compatibility.js';
import {
  connectionProfileFingerprint,
  type ConnectionCapabilitySnapshot,
} from '../connections/capability-snapshot.js';
import type { ConnectionOperationBindings } from '../connections/operation-binding-store.js';

const PROFILE_ID = '018f47a2-9a13-7d61-bf4f-f9a5d8f67c21';
const profile: ConnectionProfile = {
  schema_version: 1,
  id: PROFILE_ID,
  label: 'Notion Work',
  adapter: { id: 'notion.rest-mcp', version: 1 },
  runtime_name: 'notion_work',
  credentials: [],
  transport: { kind: 'mcp_stdio', command: 'notion-helper', args: [], environment: {} },
  created_at: '2026-08-06T12:00:00.000Z',
  updated_at: '2026-08-06T12:00:00.000Z',
};

const neutralAgent = makeAgent({
  connections: {
    work_notes: {
      type: 'notion',
      name: 'Notion Work',
      purpose: 'Publish a report',
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

describe('runtime compatibility', () => {
  it('requires a machine-local implementation for every semantic skill', () => {
    const agent = makeAgent({
      skills: {
        editorial_diagnostic: {
          name: 'Fiction manuscript diagnostic', purpose: 'Diagnose manuscript changes.',
        },
      },
    });

    expect(evaluateRuntimeCompatibility(
      agent,
      'claude-code',
      { revision: 0, connections: {}, skills: {} },
      [],
    )).toEqual({
      state: 'needs_connection',
      issues: [{
        code: 'missing_skill',
        resource: 'editorial_diagnostic',
        message: 'Choose a local skill for "Fiction manuscript diagnostic".',
      }],
    });
  });

  it('requires local choices for portable slots and resources', () => {
    expect(evaluateRuntimeCompatibility(neutralAgent, 'codex', { revision: 0, connections: {} }, []))
      .toMatchObject({ state: 'needs_connection' });
  });

  it('accepts a fully bound portable connection on Codex', () => {
    expect(evaluateRuntimeCompatibility(neutralAgent, 'codex', {
      revision: 1,
      connections: {
        work_notes: {
          connection_id: PROFILE_ID,
          resources: { report_database: { id: 'database-1' } },
        },
      },
    }, [profile])).toEqual({ state: 'compatible', issues: [] });
  });

  it('accepts credentialed HTTP through the local policy relay', () => {
    const remoteProfile: ConnectionProfile = {
      ...profile,
      credentials: [{
        id: '22222222-2222-4222-8222-222222222222',
        label: 'Token',
        environment_variable: 'NOTION_TOKEN',
        secret: true,
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
    };

    expect(evaluateRuntimeCompatibility(neutralAgent, 'codex', {
      revision: 1,
      connections: {
        work_notes: {
          connection_id: PROFILE_ID,
          resources: { report_database: { id: 'database-1' } },
        },
      },
    }, [remoteProfile])).toEqual({ state: 'compatible', issues: [] });
  });

  it('blocks a write operation when every matching resource is read only', () => {
    const readOnlyAgent = makeAgent({
      connections: {
        work_notes: {
          ...neutralAgent.connections?.work_notes,
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

    const result = evaluateRuntimeCompatibility(readOnlyAgent, 'kimi-code', {
      revision: 1,
      connections: {
        work_notes: {
          connection_id: PROFILE_ID,
          resources: { report_database: { id: 'database-1' } },
        },
      },
    }, [profile]);

    expect(result.state).toBe('blocked');
    expect(result.issues[0]?.code).toBe('resource_access_mismatch');
  });

  it('blocks a targeted write operation without a declared writable resource', () => {
    const unscopedAgent = makeAgent({
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

    const result = evaluateRuntimeCompatibility(unscopedAgent, 'codex', {
      revision: 1,
      connections: {
        work_notes: { connection_id: PROFILE_ID, resources: {} },
      },
    }, [profile]);

    expect(result.state).toBe('blocked');
    expect(result.issues[0]?.code).toBe('resource_access_mismatch');
  });

  it('blocks a targeted read operation without a declared readable resource', () => {
    const unscopedAgent = makeAgent({
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

    const result = evaluateRuntimeCompatibility(unscopedAgent, 'codex', {
      revision: 1,
      connections: {
        work_notes: { connection_id: PROFILE_ID, resources: {} },
      },
    }, [profile]);

    expect(result.state).toBe('blocked');
    expect(result.issues[0]?.code).toBe('resource_access_mismatch');
  });

  it('blocks Claude account tools on another runtime during legacy migration', () => {
    const result = evaluateRuntimeCompatibility(makeAgent({
      permissions: { allow: ['mcp__claude_ai_Notion__notion-search'], deny: [] },
    }), 'codex', { revision: 0, connections: {} }, []);

    expect(result.state).toBe('blocked');
    expect(result.issues[0]?.code).toBe('runtime_owned_connection');
  });

  it('allows a runtime-owned account connection only on its selected runtime', () => {
    const accountProfile: ConnectionProfile = {
      ...profile,
      transport: {
        kind: 'runtime_account',
        executor: 'claude-code',
        server_name: 'claude.ai Notion',
      },
    };
    const bindings = {
      revision: 1,
      connections: {
        work_notes: {
          connection_id: PROFILE_ID,
          resources: { report_database: { id: 'database-1' } },
        },
      },
    };

    expect(evaluateRuntimeCompatibility(neutralAgent, 'claude-code', bindings, [accountProfile]))
      .toEqual({ state: 'compatible', issues: [] });
    expect(evaluateRuntimeCompatibility(neutralAgent, 'codex', bindings, [accountProfile]))
      .toMatchObject({
        state: 'needs_connection',
        issues: [{ code: 'runtime_connection_mismatch' }],
      });
  });

  it('blocks an unavailable runtime and a missing custom-provider credential', () => {
    const unavailable = evaluateRuntimeCompatibility(
      makeAgent(), 'kimi-code', { revision: 0, connections: {} }, [],
      undefined, undefined, { runtimeAvailable: false },
    );
    const missingCredential = evaluateRuntimeCompatibility(
      makeAgent(), 'kimi-code', { revision: 0, connections: {} }, [],
      undefined, undefined, {
        runtimeAvailable: true,
        provider: {
          base_url: 'https://api.moonshot.ai/v1', api_key: '${MOONSHOT_API_KEY}',
        },
        environment: {},
      },
    );

    expect(unavailable).toMatchObject({
      state: 'blocked', issues: [{ code: 'runtime_unavailable' }],
    });
    expect(missingCredential).toMatchObject({
      state: 'blocked', issues: [{ code: 'missing_provider_credential' }],
    });
  });

  it('requires a current checked inventory before changing runtimes', () => {
    const result = evaluateRuntimeCompatibility(neutralAgent, 'codex', {
      revision: 1,
      connections: {
        work_notes: {
          connection_id: PROFILE_ID,
          resources: { report_database: { id: 'database-1' } },
        },
      },
    }, [profile], new Map());

    expect(result.state).toBe('needs_review');
    expect(result.issues[0]?.code).toBe('connection_changed');
  });

  it('accepts reviewed local mappings for custom adapters', () => {
    const customProfile: ConnectionProfile = {
      ...profile,
      adapter: { id: 'documents.mcp', version: 1 },
    };
    const customAgent = makeAgent({
      connections: {
        documents: {
          type: 'documents',
          name: 'Documents Work',
          purpose: 'List reports',
          operations: ['documents.list'],
          resources: {},
        },
      },
    });
    const capabilityVersion = `sha256:${'c'.repeat(64)}`;
    const snapshot: ConnectionCapabilitySnapshot = {
      schema_version: 1,
      connection_id: PROFILE_ID,
      source: 'stored_profile',
      adapter: customProfile.adapter,
      profile_fingerprint: connectionProfileFingerprint(customProfile),
      operations: [{
        id: 'mcp:list_documents', runtime_name: 'list_documents',
        effects: ['read'], classification: 'curated', input_fields: [],
      }],
      capability_version: capabilityVersion,
      classification_version: 'stored-mcp-v1',
      captured_at: '2026-08-06T13:00:00.000Z',
    };
    const mappings: ConnectionOperationBindings = {
      revision: 1,
      capability_version: capabilityVersion,
      updated_at: '2026-08-06T13:05:00.000Z',
      operations: {
        'documents.list': { runtime_name: 'list_documents', effect: 'read' },
      },
    };

    expect(evaluateRuntimeCompatibility(
      customAgent,
      'kimi-code',
      { revision: 1, connections: { documents: { connection_id: PROFILE_ID, resources: {} } } },
      [customProfile],
      new Map([[PROFILE_ID, snapshot]]),
      new Map([[PROFILE_ID, mappings]]),
    )).toEqual({ state: 'compatible', issues: [] });
  });

  it('blocks a portable output target that the reviewed mapping cannot enforce', () => {
    const customProfile: ConnectionProfile = {
      ...profile,
      service_type: 'documents',
      adapter: { id: 'documents.mcp', version: 1 },
    };
    const customAgent = makeAgent({
      connections: {
        documents: {
          type: 'documents', name: 'Documents Work', purpose: 'Publish reports',
          operations: ['documents.create'],
          resources: {
            reports: {
              type: 'documents.database', purpose: 'Report destination', access: 'write',
            },
          },
        },
      },
      output: { primary: {
        description: 'One report', use: 'documents', operation: 'documents.create',
        target: 'reports', required: true,
      } },
    });
    const capabilityVersion = `sha256:${'c'.repeat(64)}`;
    const snapshot: ConnectionCapabilitySnapshot = {
      schema_version: 1, connection_id: PROFILE_ID, source: 'stored_profile',
      adapter: customProfile.adapter,
      profile_fingerprint: connectionProfileFingerprint(customProfile),
      operations: [{
        id: 'mcp:create_document', runtime_name: 'create_document', effects: ['unknown'],
        classification: 'unknown', input_fields: ['title'],
      }],
      capability_version: capabilityVersion,
      classification_version: 'stored-mcp-v1', captured_at: '2026-08-06T13:00:00.000Z',
    };
    const mappings: ConnectionOperationBindings = {
      revision: 1, capability_version: capabilityVersion,
      updated_at: '2026-08-06T13:05:00.000Z',
      operations: {
        'documents.create': { runtime_name: 'create_document', effect: 'write' },
      },
    };

    const result = evaluateRuntimeCompatibility(
      customAgent,
      'codex',
      { revision: 1, connections: {
        documents: {
          connection_id: PROFILE_ID, resources: { reports: { id: 'reports-123' } },
        },
      } },
      [customProfile],
      new Map([[PROFILE_ID, snapshot]]),
      new Map([[PROFILE_ID, mappings]]),
    );

    expect(result.state).toBe('blocked');
    expect(result.issues[0]?.code).toBe('unsupported_output_target');
  });

  it('blocks an untargeted output when one concrete tool fills two logical uses', () => {
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

    const result = evaluateRuntimeCompatibility(agent, 'codex', {
      revision: 1,
      connections: {
        primary_notes: { connection_id: PROFILE_ID, resources: {} },
        archive_notes: { connection_id: PROFILE_ID, resources: {} },
      },
    }, [profile]);

    expect(result.state).toBe('blocked');
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'ambiguous_output_evidence',
      use: 'primary_notes',
      operation: 'notion.search',
    }));
  });
});
