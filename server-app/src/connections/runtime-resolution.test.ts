import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../agents/config.js';
import type { ConnectionProfile } from './profile.js';
import {
  ConnectionBindingError,
  resolveAgentConnectionBindings,
  resolveSavedConnectionValues,
} from './runtime-resolution.js';
import { attachRuntimeConnectionPolicies, runtimeConnectionPolicy } from './runtime-policy.js';

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const CREDENTIAL_ID = '22222222-2222-4222-8222-222222222222';

function agent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'daily-notes',
    name: 'Daily notes',
    prompt: 'Write the notes.',
    tools: [],
    disallowed_tools: [],
    max_turns: 20,
    enabled: true,
    ...overrides,
  };
}

function profile(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    schema_version: 1,
    id: PROFILE_ID,
    label: 'Personal workspace',
    adapter: { id: 'notion.rest-mcp', version: 1 },
    runtime_name: 'notion-personal',
    credentials: [{
      id: CREDENTIAL_ID,
      label: 'Token',
      environment_variable: 'NOTION_PERSONAL_API_KEY',
      secret: true,
    }],
    transport: {
      kind: 'mcp_stdio',
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server'],
      environment: { NOTION_TOKEN: CREDENTIAL_ID },
    },
    created_at: '2026-07-19T18:00:00.000Z',
    updated_at: '2026-07-19T18:00:00.000Z',
    ...overrides,
  };
}

describe('saved connection runtime resolution', () => {
  it('preserves prepared tool policies while materializing saved transports', () => {
    const source = agent({
      connection_bindings: { 'notion-personal': PROFILE_ID },
    });
    attachRuntimeConnectionPolicies(source, {
      'notion-personal': {
        allowedTools: ['API-post-page'],
        argumentConstraints: { 'API-post-page': { data_source_id: ['database-1'] } },
      },
    });

    const resolved = resolveAgentConnectionBindings(source, [profile()]);

    expect(runtimeConnectionPolicy(resolved, 'notion-personal')).toEqual({
      allowedTools: ['API-post-page'],
      argumentConstraints: { 'API-post-page': { data_source_id: ['database-1'] } },
    });
  });

  it('fills a missing MCP transport from an opaque saved profile binding', () => {
    const resolved = resolveAgentConnectionBindings(agent({
      connection_bindings: { 'notion-personal': PROFILE_ID },
    }), [profile()]);

    expect(resolved.mcp_servers?.['notion-personal']).toEqual({
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server'],
      env: { NOTION_TOKEN: '${NOTION_PERSONAL_API_KEY}' },
    });
  });

  it('overrides an inline transport while leaving unrelated servers unchanged', () => {
    const resolved = resolveAgentConnectionBindings(agent({
      mcp_servers: {
        'notion-personal': { command: 'old-command' },
        unrelated: { type: 'http', url: 'https://example.test/mcp' },
      },
      connection_bindings: { 'notion-personal': PROFILE_ID },
    }), [profile()]);

    expect(resolved.mcp_servers).toEqual({
      'notion-personal': {
        command: 'npx',
        args: ['-y', '@notionhq/notion-mcp-server'],
        env: { NOTION_TOKEN: '${NOTION_PERSONAL_API_KEY}' },
      },
      unrelated: { type: 'http', url: 'https://example.test/mcp' },
    });
  });

  it('does not mutate agents that have no saved bindings', () => {
    const original = agent({ mcp_servers: { helper: { command: 'helper' } } });
    expect(resolveAgentConnectionBindings(original, [profile()])).toBe(original);
  });

  it('fails closed when a binding points to a missing profile', () => {
    expect(() => resolveAgentConnectionBindings(agent({
      connection_bindings: { 'notion-personal': PROFILE_ID },
    }), [])).toThrowError(new ConnectionBindingError(
      'Saved connection for "notion-personal" is unavailable. Choose another connection in agent settings.',
    ));
  });

  it('fails closed when the profile runtime identity differs from the binding name', () => {
    expect(() => resolveAgentConnectionBindings(agent({
      connection_bindings: { 'notion-personal': PROFILE_ID },
    }), [profile({ runtime_name: 'notion-work' })])).toThrowError(ConnectionBindingError);
  });

  it('never resolves credential values from the process environment', () => {
    const previous = process.env.NOTION_PERSONAL_API_KEY;
    process.env.NOTION_PERSONAL_API_KEY = 'must-not-appear';
    try {
      const result = JSON.stringify(resolveAgentConnectionBindings(agent({
        connection_bindings: { 'notion-personal': PROFILE_ID },
      }), [profile()]));
      expect(result).not.toContain('must-not-appear');
      expect(result).toContain('${NOTION_PERSONAL_API_KEY}');
    } finally {
      if (previous === undefined) delete process.env.NOTION_PERSONAL_API_KEY;
      else process.env.NOTION_PERSONAL_API_KEY = previous;
    }
  });

  it('resolves only the credential variables reviewed in the saved profile', () => {
    const resolved = resolveAgentConnectionBindings(agent({
      connection_bindings: { 'notion-personal': PROFILE_ID },
    }), [profile()]);

    expect(resolveSavedConnectionValues(
      resolved,
      'notion-personal',
      { Authorization: 'Bearer ${NOTION_PERSONAL_API_KEY}' },
      { NOTION_PERSONAL_API_KEY: 'local-secret' },
    )).toEqual({ Authorization: 'Bearer local-secret' });
    expect(() => resolveSavedConnectionValues(
      resolved,
      'notion-personal',
      { Authorization: 'Bearer ${UNRELATED_KEY}' },
      { UNRELATED_KEY: 'must-not-be-used' },
    )).toThrow('is not part of saved connection');
  });
});
