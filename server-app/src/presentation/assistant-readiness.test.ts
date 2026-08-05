import { describe, expect, it } from 'vitest';
import { makeAgent } from '../test-factories.js';
import { inlineConnectionId, type ServiceRegistry } from '../services/registry.js';
import { createAssistantHomePresentation } from './assistant-home.js';
import { collectAssistantHomeFacts } from './assistant-readiness.js';

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const MACHINE_ID = '1d2f8f5e-9ea8-4fce-89b1-1c7c2f5ecf99';

function registry(overrides: Partial<ServiceRegistry> = {}): ServiceRegistry {
  return {
    connections: [],
    bindings: new Map(),
    ...overrides,
  };
}

describe('Assistant readiness facts', () => {
  it('checks the selected local runtime and exact configured paths', () => {
    const facts = collectAssistantHomeFacts({
      agent: makeAgent({
        executor: 'kimi-code',
        file_access: [
          { path: '~/Books', kind: 'folder', access: 'read_only' },
          { path: '/Volumes/Output', kind: 'folder', access: 'read_write' },
        ],
      }),
      runtimePaths: { kimiExecutablePath: '/usr/local/bin/kimi' },
      registry: registry(),
      inspectPath: (path) => ({
        exists: path !== '/Volumes/Output',
        readable: path !== '/Volumes/Output',
        writable: false,
      }),
    });

    expect(facts.engine).toEqual({ runtimeAvailable: true, authentication: 'unknown' });
    expect(facts.paths).toEqual([
      { path: '~/Books', exists: true, readable: true, writable: false },
      { path: '/Volumes/Output', exists: false, readable: false, writable: false },
    ]);
    expect(facts.canEnforceSafeTest).toBe(true);
  });

  it('does not advertise a safe test for Codex', () => {
    const facts = collectAssistantHomeFacts({
      agent: makeAgent({ executor: 'codex' }),
      runtimePaths: { codexExecutablePath: '/usr/local/bin/codex' },
      registry: registry(),
      inspectPath: () => ({ exists: true, readable: true, writable: false }),
    });

    expect(facts.canEnforceSafeTest).toBe(false);
  });

  it('does not treat saved credential presence as verified provider health', () => {
    const connections: ServiceRegistry['connections'] = [{
      id: PROFILE_ID,
      service_id: 'mcp.custom',
      name: 'Personal notes',
      source: 'configured_api',
      status: 'connected',
      actions: [],
      actions_known: false,
      required_env: ['NOTES_TOKEN'],
    }];
    const facts = collectAssistantHomeFacts({
      agent: makeAgent({
        connection_bindings: { notes: PROFILE_ID },
        mcp_servers: { notes: { command: 'notes-mcp' } },
      }),
      runtimePaths: { claudeExecutablePath: '/usr/local/bin/claude' },
      registry: registry({ connections }),
      inspectPath: () => ({ exists: true, readable: true, writable: true }),
    });

    expect(facts.connections).toEqual([{
      id: PROFILE_ID,
      label: 'Personal notes',
      status: 'unknown',
      sourceReference: 'agent.connection_bindings.notes',
    }]);
  });

  it('uses an actual runtime connection probe while keeping missing setup actionable', () => {
    const accountID = 'runtime:claude.ai%20Notion';
    const connections: ServiceRegistry['connections'] = [
      {
        id: accountID,
        service_id: 'notion',
        name: 'Notion (Claude account)',
        source: 'account',
        status: 'connected',
        actions: ['read', 'write'],
        actions_known: true,
        required_env: [],
      },
      {
        id: PROFILE_ID,
        service_id: 'mcp.custom',
        name: 'Reports',
        source: 'configured_api',
        status: 'needs_setup',
        actions: [],
        actions_known: false,
        required_env: ['REPORTS_TOKEN'],
      },
    ];
    const bindings: ServiceRegistry['bindings'] = new Map([
      [accountID, { serverName: 'claude_ai_Notion' }],
      [PROFILE_ID, { serverName: 'reports', connectionId: PROFILE_ID }],
    ]);
    const facts = collectAssistantHomeFacts({
      agent: makeAgent({
        permissions: {
          allow: ['mcp__claude_ai_Notion__search'],
          deny: [],
        },
        connection_bindings: { reports: PROFILE_ID },
        mcp_servers: { reports: { command: 'reports-mcp' } },
      }),
      runtimePaths: { claudeExecutablePath: '/usr/local/bin/claude' },
      registry: registry({ connections, bindings }),
      inspectPath: () => ({ exists: true, readable: true, writable: true }),
    });

    expect(facts.connections).toEqual([
      {
        id: PROFILE_ID,
        label: 'Reports',
        status: 'needs_setup',
        sourceReference: 'agent.connection_bindings.reports',
      },
      {
        id: accountID,
        label: 'Notion (Claude account)',
        status: 'ready',
        sourceReference: 'agent.permissions.allow',
      },
    ]);
  });

  it('keeps an inline MCP server unknown when no deterministic health probe exists', () => {
    const facts = collectAssistantHomeFacts({
      agent: makeAgent({ mcp_servers: { private_notes: { command: 'notes-mcp' } } }),
      runtimePaths: { claudeExecutablePath: '/usr/local/bin/claude' },
      registry: registry(),
      inspectPath: () => ({ exists: true, readable: true, writable: true }),
    });

    expect(facts.connections).toEqual([{
      id: 'inline:private_notes',
      label: 'private notes',
      status: 'unknown',
      sourceReference: 'agent.mcp_servers.private_notes',
    }]);
  });

  it('reports missing inline connection setup from the existing registry', () => {
    const connection = {
      id: 'mcp:reports:abc123',
      service_id: 'custom:reports',
      name: 'Reports connection',
      source: 'configured_api' as const,
      status: 'needs_setup' as const,
      actions: [],
      actions_known: false,
      required_env: ['REPORTS_TOKEN'],
    };
    const facts = collectAssistantHomeFacts({
      agent: makeAgent({ mcp_servers: { reports: { command: 'reports-mcp' } } }),
      runtimePaths: { claudeExecutablePath: '/usr/local/bin/claude' },
      registry: registry({
        connections: [connection],
        bindings: new Map([[connection.id, {
          serverName: 'reports',
          config: { command: 'reports-mcp' },
        }]]),
      }),
      inspectPath: () => ({ exists: true, readable: true, writable: true }),
    });

    expect(facts.connections).toEqual([{
      id: connection.id,
      label: 'Reports connection',
      status: 'needs_setup',
      sourceReference: 'agent.mcp_servers.reports',
    }]);
  });

  it('does not call a path missing when the check was refused', () => {
    // macOS refuses a protected volume without asking, and a background daemon
    // can never be asked. Refusal proves nothing about the file, so it cannot
    // report as missing and must not block the agent.
    const presentation = createAssistantHomePresentation({
      machineId: MACHINE_ID,
      agent: makeAgent({
        file_access: [{ path: '/Users/x/My Drive/Book.docx', kind: 'file', access: 'read_only' }],
      }),
      runs: [],
      pendingInteractions: [],
      now: new Date('2026-08-05T12:00:00Z'),
      facts: collectAssistantHomeFacts({
        agent: makeAgent({
          file_access: [{ path: '/Users/x/My Drive/Book.docx', kind: 'file', access: 'read_only' }],
        }),
        runtimePaths: { claudeExecutablePath: '/usr/local/bin/claude' },
        registry: registry(),
        inspectPath: () => ({ exists: false, readable: false, writable: false, inspectable: false }),
      }),
    });

    const file = presentation.readiness.checks.filter((check) => check.kind === 'file');
    expect(file).toEqual([expect.objectContaining({ state: 'unknown' })]);
    expect(presentation.readiness.state).toBe('ready');
    expect(presentation.health.state).toBe('healthy');
  });

  it('reads the agent\'s own inline server, not a catalog entry sharing its name', () => {
    // The catalog carries a placeholder for every known service, bound to the
    // same server name an agent may use. It is an OAuth service, so it can
    // never read as ready from local evidence alone. Picking it over the
    // connection built from this agent's own configuration reports a working
    // server as unconfigured.
    const config = { type: 'sse' as const, url: 'https://mcp.linear.app/sse' };
    const ownId = inlineConnectionId('linear', config);
    const connections: ServiceRegistry['connections'] = [{
      id: 'catalog:linear',
      service_id: 'linear',
      name: 'Linear',
      source: 'configured_api',
      status: 'needs_setup',
      actions: ['read', 'write'],
      actions_known: true,
      required_env: [],
    }, {
      id: ownId,
      service_id: 'linear',
      name: 'Linear connection',
      source: 'mcp',
      status: 'connected',
      actions: ['read', 'write'],
      actions_known: true,
      required_env: [],
    }];
    const facts = collectAssistantHomeFacts({
      agent: makeAgent({ mcp_servers: { linear: config } }),
      runtimePaths: { claudeExecutablePath: '/usr/local/bin/claude' },
      registry: registry({
        connections,
        bindings: new Map([
          ['catalog:linear', { serverName: 'linear', config }],
          [ownId, { serverName: 'linear', config }],
        ]),
      }),
      inspectPath: () => ({ exists: true, readable: true, writable: true }),
    });

    expect(facts.connections).toEqual([{
      id: ownId,
      label: 'Linear connection',
      status: 'unknown',
      sourceReference: 'agent.mcp_servers.linear',
    }]);
  });

  it('matches an account connector whose runtime name is not the tool rule spelling', () => {
    const accountID = 'runtime:claude.ai%20Notion';
    const connections: ServiceRegistry['connections'] = [{
      id: accountID,
      service_id: 'notion',
      name: 'Notion (Claude account)',
      source: 'account',
      status: 'connected',
      actions: ['read', 'write'],
      actions_known: true,
      required_env: [],
    }];
    const facts = collectAssistantHomeFacts({
      agent: makeAgent({ tools: ['Read', 'mcp__claude_ai_Notion'] }),
      runtimePaths: { claudeExecutablePath: '/usr/local/bin/claude' },
      registry: registry({
        connections,
        bindings: new Map([[accountID, { serverName: 'claude.ai Notion' }]]),
      }),
      inspectPath: () => ({ exists: true, readable: true, writable: true }),
    });

    expect(facts.connections).toEqual([{
      id: accountID,
      label: 'Notion (Claude account)',
      status: 'ready',
      sourceReference: 'agent.tools',
    }]);
  });

  it('presents a healthy agent from the facts this Mac can actually collect', () => {
    const agent = makeAgent({
      id: 'daily-focus',
      schedule: '0 7 * * *',
      working_directory: '/Users/person/Notes',
      output: { primary: { description: 'Daily focus note', tool: 'Write' } },
    });
    const facts = collectAssistantHomeFacts({
      agent,
      runtimePaths: { claudeExecutablePath: '/usr/local/bin/claude' },
      registry: registry(),
      inspectPath: () => ({ exists: true, readable: true, writable: true }),
    });

    const presentation = createAssistantHomePresentation({
      machineId: MACHINE_ID,
      agent,
      runs: [],
      pendingInteractions: [],
      now: new Date('2026-08-02T10:00:00.000Z'),
      facts,
    });

    expect(presentation.readiness.state).toBe('ready');
    expect(presentation.health.state).toBe('healthy');
    expect(presentation.primaryAction).toMatchObject({ kind: 'run', label: 'Run now' });
  });
});
