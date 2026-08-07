import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile } from './profile.js';
import { createConnectionResolvingExecutor } from './connection-executor.js';
import { createTempDir, makeAgent, makeExecutionResult } from '../test-factories.js';
import {
  connectionProfileFingerprint,
  type ConnectionCapabilitySnapshot,
} from './capability-snapshot.js';
import type { ConnectionOperationBindings } from './operation-binding-store.js';

const profile: ConnectionProfile = {
  schema_version: 1,
  id: '11111111-1111-4111-8111-111111111111',
  label: 'Notes',
  adapter: { id: 'generic.mcp', version: 1 },
  runtime_name: 'notes',
  credentials: [],
  transport: { kind: 'mcp_stdio', command: 'notes-helper', args: [], environment: {} },
  created_at: '2026-07-19T18:00:00.000Z',
  updated_at: '2026-07-19T18:00:00.000Z',
};

describe('connection-resolving executor', () => {
  it('does not read the profile store for agents without saved bindings', async () => {
    const list = vi.fn().mockResolvedValue([profile]);
    const execute = vi.fn().mockResolvedValue(makeExecutionResult());
    const executor = createConnectionResolvingExecutor({ list }, () => execute);
    const reporter = {
      start: vi.fn(), progress: vi.fn(), complete: vi.fn(), fail: vi.fn(), stop: vi.fn(),
    };
    const unbound = makeAgent();

    await executor(unbound, reporter);

    expect(list).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(unbound, reporter, undefined);
  });

  it('loads profiles for each run and sends the resolved transport to the selected executor', async () => {
    const list = vi.fn().mockResolvedValue([profile]);
    const execute = vi.fn().mockResolvedValue(makeExecutionResult());
    const resolveExecutor = vi.fn().mockReturnValue(execute);
    const executor = createConnectionResolvingExecutor({ list }, resolveExecutor);
    const reporter = {
      start: vi.fn(), progress: vi.fn(), complete: vi.fn(), fail: vi.fn(), stop: vi.fn(),
    };
    const agent = makeAgent({
      connection_bindings: { notes: profile.id },
      mcp_servers: { notes: { command: 'stale-inline-helper' } },
    });

    await executor(agent, reporter);
    await executor(agent, reporter);

    expect(list).toHaveBeenCalledTimes(2);
    expect(resolveExecutor).toHaveBeenCalledWith(expect.objectContaining({
      mcp_servers: { notes: { command: 'notes-helper', args: [], env: {} } },
    }));
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      mcp_servers: { notes: { command: 'notes-helper', args: [], env: {} } },
    }), reporter, undefined);
  });

  it('selects the executor from local runtime assignment without changing agent YAML', async () => {
    const list = vi.fn().mockResolvedValue([]);
    const getAssignment = vi.fn().mockResolvedValue({
      agent_id: 'test-agent',
      executor: 'codex',
      revision: 1,
      updated_at: '2026-08-06T12:00:00.000Z',
    });
    const execute = vi.fn().mockResolvedValue(makeExecutionResult());
    const resolveExecutor = vi.fn().mockReturnValue(execute);
    const executor = createConnectionResolvingExecutor(
      { list },
      resolveExecutor,
      { get: getAssignment },
    );
    const reporter = {
      start: vi.fn(), progress: vi.fn(), complete: vi.fn(), fail: vi.fn(), stop: vi.fn(),
    };
    const agent = makeAgent({ executor: undefined, model: undefined });

    await executor(agent, reporter);

    expect(getAssignment).toHaveBeenCalledWith(agent.id);
    expect(resolveExecutor).toHaveBeenCalledWith(expect.objectContaining({ executor: 'codex' }));
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ executor: 'codex' }),
      reporter,
      undefined,
    );
    expect(agent.executor).toBeUndefined();
  });

  it('prepares required skills before selecting Claude Code', async () => {
    const skillDirectory = join(createTempDir('connection-executor-skill'), 'fiction-diagnostic');
    mkdirSync(skillDirectory, { recursive: true });
    writeFileSync(join(skillDirectory, 'SKILL.md'), `---
name: fiction-diagnostic
description: Diagnose fiction drafts.
---
Use exact manuscript evidence for every finding.
`);
    const execute = vi.fn().mockResolvedValue(makeExecutionResult());
    const resolveExecutor = vi.fn().mockReturnValue(execute);
    const executor = createConnectionResolvingExecutor(
      { list: vi.fn().mockResolvedValue([]) },
      resolveExecutor,
      { get: vi.fn().mockResolvedValue({
        agent_id: 'test-agent', executor: 'claude-code', revision: 1,
        updated_at: '2026-08-07T08:00:00.000Z',
      }) },
      { get: vi.fn().mockResolvedValue({
        revision: 1,
        connections: {},
        skills: { editorial_diagnostic: { path: skillDirectory } },
      }) },
    );
    const agent = makeAgent({
      executor: undefined,
      skills: {
        editorial_diagnostic: {
          name: 'Fiction manuscript diagnostic', purpose: 'Diagnose manuscript changes.',
        },
      },
    });
    const reporter = {
      start: vi.fn(), progress: vi.fn(), complete: vi.fn(), fail: vi.fn(), stop: vi.fn(),
    };

    await executor(agent, reporter);

    expect(resolveExecutor).toHaveBeenCalledWith(expect.objectContaining({
      executor: 'claude-code',
      prompt: expect.stringContaining('Use exact manuscript evidence for every finding.'),
    }));
  });

  it('fails closed when a portable run has no checked inventory and mapping stores', async () => {
    const executor = createConnectionResolvingExecutor(
      { list: vi.fn().mockResolvedValue([]) },
      () => vi.fn(),
      undefined,
      { get: vi.fn().mockResolvedValue({ revision: 0, connections: {} }) },
    );
    const agent = makeAgent({
      connections: {
        notes: {
          type: 'documents', name: 'Documents', purpose: 'Read notes',
          operations: ['documents.list'], resources: {},
        },
      },
    });
    const reporter = {
      start: vi.fn(), progress: vi.fn(), complete: vi.fn(), fail: vi.fn(), stop: vi.fn(),
    };

    await expect(executor(agent, reporter)).rejects.toThrow(
      'Portable connection verification is unavailable',
    );
  });

  it('normalizes concrete tool calls into portable operation and resource evidence', async () => {
    const portableProfile: ConnectionProfile = {
      ...profile,
      service_type: 'documents',
      adapter: { id: 'documents.mcp', version: 1 },
    };
    const capability: ConnectionCapabilitySnapshot = {
      schema_version: 1,
      connection_id: profile.id,
      source: 'stored_profile',
      adapter: portableProfile.adapter,
      profile_fingerprint: connectionProfileFingerprint(portableProfile),
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
    const mappings: ConnectionOperationBindings = {
      revision: 1,
      capability_version: capability.capability_version,
      updated_at: '2026-08-06T13:00:00.000Z',
      operations: {
        'documents.create': {
          runtime_name: 'create_document',
          effect: 'write',
          target: { argument: 'database_id', resource_type: 'documents.database' },
        },
      },
    };
    const execute = vi.fn().mockResolvedValue(makeExecutionResult({
      toolCalls: [{
        name: 'mcp__notes__create_document',
        status: 'succeeded',
        input: { database_id: 'reports-123' },
      }],
    }));
    const executor = createConnectionResolvingExecutor(
      { list: vi.fn().mockResolvedValue([portableProfile]) },
      () => execute,
      undefined,
      {
        get: vi.fn().mockResolvedValue({
          revision: 1,
          connections: {
            work_documents: {
              connection_id: profile.id,
              resources: { reports: { id: 'reports-123' } },
            },
          },
        }),
      },
      { get: vi.fn().mockResolvedValue(capability) },
      { get: vi.fn().mockResolvedValue(mappings) },
    );
    const agent = makeAgent({
      connections: {
        work_documents: {
          type: 'documents',
          name: 'Documents Work',
          purpose: 'Publish reports',
          operations: ['documents.create'],
          resources: {
            reports: {
              type: 'documents.database', purpose: 'Report destination', access: 'write',
            },
          },
        },
      },
    });
    const reporter = {
      start: vi.fn(), progress: vi.fn(), complete: vi.fn(), fail: vi.fn(), stop: vi.fn(),
    };

    const result = await executor(agent, reporter);

    expect(result.toolCalls?.[0]?.portable).toEqual({
      use: 'work_documents',
      operation: 'documents.create',
      target: 'reports',
    });
  });

  it('uses the matched resource to distinguish logical uses sharing one profile and tool', async () => {
    const portableProfile: ConnectionProfile = {
      ...profile,
      service_type: 'documents',
      adapter: { id: 'documents.mcp', version: 1 },
    };
    const capability: ConnectionCapabilitySnapshot = {
      schema_version: 1,
      connection_id: profile.id,
      source: 'stored_profile',
      adapter: portableProfile.adapter,
      profile_fingerprint: connectionProfileFingerprint(portableProfile),
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
    const mappings: ConnectionOperationBindings = {
      revision: 1,
      capability_version: capability.capability_version,
      updated_at: '2026-08-06T13:00:00.000Z',
      operations: {
        'documents.create': {
          runtime_name: 'create_document',
          effect: 'write',
          target: { argument: 'database_id', resource_type: 'documents.database' },
        },
      },
    };
    const execute = vi.fn().mockResolvedValue(makeExecutionResult({
      toolCalls: [{
        name: 'mcp__notes__create_document',
        status: 'succeeded',
        input: { database_id: 'first-reports' },
      }],
    }));
    const executor = createConnectionResolvingExecutor(
      { list: vi.fn().mockResolvedValue([portableProfile]) },
      () => execute,
      undefined,
      {
        get: vi.fn().mockResolvedValue({
          revision: 1,
          connections: {
            first_documents: {
              connection_id: profile.id,
              resources: { reports: { id: 'first-reports' } },
            },
            second_documents: {
              connection_id: profile.id,
              resources: { reports: { id: 'second-reports' } },
            },
          },
        }),
      },
      { get: vi.fn().mockResolvedValue(capability) },
      { get: vi.fn().mockResolvedValue(mappings) },
    );
    const agent = makeAgent({
      connections: {
        first_documents: {
          type: 'documents',
          name: 'First Documents',
          purpose: 'Publish first reports',
          operations: ['documents.create'],
          resources: {
            reports: {
              type: 'documents.database', purpose: 'First destination', access: 'write',
            },
          },
        },
        second_documents: {
          type: 'documents',
          name: 'Second Documents',
          purpose: 'Publish second reports',
          operations: ['documents.create'],
          resources: {
            reports: {
              type: 'documents.database', purpose: 'Second destination', access: 'write',
            },
          },
        },
      },
    });
    const reporter = {
      start: vi.fn(), progress: vi.fn(), complete: vi.fn(), fail: vi.fn(), stop: vi.fn(),
    };

    const result = await executor(agent, reporter);

    expect(result.toolCalls?.[0]?.portable).toEqual({
      use: 'first_documents',
      operation: 'documents.create',
      target: 'reports',
    });
  });
});
