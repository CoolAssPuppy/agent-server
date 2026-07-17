import { describe, it, expect } from 'vitest';
import { makeAgent } from '../test-factories.js';
import {
  CAPABILITY_CATALOG,
  CapabilityError,
  applyCapabilityChanges,
  catalogSummary,
  deriveCapabilities,
  redactAgentSecrets,
} from './capabilities.js';

const EMPTY_ENV: Record<string, string | undefined> = {};

function capability(agent = makeAgent(), id: string, env = EMPTY_ENV) {
  const found = deriveCapabilities(agent, env).find((c) => c.id === id);
  if (!found) throw new Error(`capability ${id} not derived`);
  return found;
}

describe('deriveCapabilities', () => {
  it('marks tool capabilities enabled on an unrestricted agent', () => {
    const agent = makeAgent({ tools: [], disallowed_tools: [] });
    expect(capability(agent, 'read-files').enabled).toBe(true);
    expect(capability(agent, 'write-files').enabled).toBe(true);
    expect(capability(agent, 'run-commands').enabled).toBe(true);
    expect(capability(agent, 'browse-web').enabled).toBe(true);
  });

  it('respects a tools allowlist', () => {
    const agent = makeAgent({ tools: ['Read', 'Glob'] });
    expect(capability(agent, 'read-files').enabled).toBe(true);
    expect(capability(agent, 'write-files').enabled).toBe(false);
    expect(capability(agent, 'run-commands').enabled).toBe(false);
  });

  it('treats disallowed_tools as deny-wins', () => {
    const agent = makeAgent({ tools: [], disallowed_tools: ['Bash'] });
    expect(capability(agent, 'run-commands').enabled).toBe(false);
    expect(capability(agent, 'read-files').enabled).toBe(true);
  });

  it('enables an mcp capability when a matching server entry exists', () => {
    const agent = makeAgent({
      mcp_servers: {
        'notion-personal': {
          command: 'npx',
          args: ['-y', '@notionhq/notion-mcp-server'],
          env: { NOTION_TOKEN: '${NOTION_API_KEY}' },
        },
      },
    });
    const notion = capability(agent, 'notion');
    expect(notion.enabled).toBe(true);
    expect(notion.server_name).toBe('notion-personal');
  });

  it('enables an mcp capability granted through a permissions block', () => {
    // Mirrors a hand-written agent that uses permissions (allow/deny globs)
    // rather than the tools allowlist — the tools list here is non-empty but
    // does not mention Notion, so only the permissions block grants it.
    const agent = makeAgent({
      tools: ['Read', 'Write'],
      mcp_servers: { 'notion-personal': { command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'] } },
      permissions: {
        allow: ['Read', 'Write', 'mcp__notion-personal__notion-search', 'mcp__notion-personal__notion-create-pages'],
        deny: ['mcp__notion-personal__notion-update-*'],
      },
    });
    expect(capability(agent, 'notion').enabled).toBe(true);
    expect(capability(agent, 'read-files').enabled).toBe(true);
    // A service the permissions block never mentions stays off.
    expect(capability(agent, 'slack').enabled).toBe(false);
  });

  it('reflects a permissions allowlist for tool capabilities', () => {
    const agent = makeAgent({
      tools: ['Read', 'Write', 'Bash'],
      permissions: { allow: ['Read'], deny: [] },
    });
    // Only Read is allowed by permissions, so write/run read as off even though
    // they are in the tools list — permissions win when present.
    expect(capability(agent, 'read-files').enabled).toBe(true);
    expect(capability(agent, 'run-commands').enabled).toBe(false);
  });

  it('disables an mcp capability when the server-level rule is disallowed', () => {
    const agent = makeAgent({
      mcp_servers: { notion: { command: 'npx' } },
      disallowed_tools: ['mcp__notion'],
    });
    expect(capability(agent, 'notion').enabled).toBe(false);
  });

  it('requires allowlist coverage for mcp servers when tools is non-empty', () => {
    const covered = makeAgent({
      tools: ['Read', 'mcp__notion'],
      mcp_servers: { notion: { command: 'npx' } },
    });
    const uncovered = makeAgent({
      tools: ['Read'],
      mcp_servers: { notion: { command: 'npx' } },
    });
    expect(capability(covered, 'notion').enabled).toBe(true);
    expect(capability(uncovered, 'notion').enabled).toBe(false);
  });

  it('treats the builtin calendar capability as present without config', () => {
    expect(capability(makeAgent(), 'calendar').enabled).toBe(true);
    const disabled = makeAgent({ disallowed_tools: ['mcp__eventkit'] });
    expect(capability(disabled, 'calendar').enabled).toBe(false);
  });

  it('reports env readiness from the provided env source', () => {
    const agent = makeAgent();
    expect(capability(agent, 'notion', {}).env_ready).toBe(false);
    expect(capability(agent, 'notion', { NOTION_API_KEY: 'secret' }).env_ready).toBe(true);
    expect(capability(agent, 'tripmaster', {}).env_ready).toBe(false);
    expect(capability(agent, 'tripmaster', { TRIPMASTER_API_KEY: 'k' }).env_ready).toBe(true);
    // OAuth-based capabilities need no env and are always ready to enable.
    expect(capability(agent, 'calorienerds', {}).env_ready).toBe(true);
  });

  it('reports the auth model for each capability', () => {
    const agent = makeAgent();
    expect(capability(agent, 'read-files').auth).toBe('none'); // local tools
    expect(capability(agent, 'calendar').auth).toBe('none'); // builtin eventkit
    expect(capability(agent, 'notion').auth).toBe('api_key'); // needs a key
    expect(capability(agent, 'tripmaster').auth).toBe('api_key');
    expect(capability(agent, 'linear').auth).toBe('oauth'); // browser sign-in
    expect(capability(agent, 'calorienerds').auth).toBe('oauth');
  });

  it('marks custom connections as no-auth (user-configured)', () => {
    const agent = makeAgent({
      mcp_servers: { 'my-thing': { type: 'http', url: 'https://x.example/mcp' } },
    });
    expect(capability(agent, 'mcp:my-thing').auth).toBe('none');
  });

  it('surfaces unrecognized mcp servers as custom capabilities', () => {
    const agent = makeAgent({
      mcp_servers: { 'my-weather': { type: 'http', url: 'https://weather.example/mcp' } },
    });
    const custom = capability(agent, 'mcp:my-weather');
    expect(custom.custom).toBe(true);
    expect(custom.label).toBe('My Weather');
    expect(custom.enabled).toBe(true);
  });

  it('surfaces unrecognized allowlisted tools as custom capabilities', () => {
    const agent = makeAgent({ tools: ['Read', 'NotebookEdit'] });
    const custom = capability(agent, 'tool:NotebookEdit');
    expect(custom.custom).toBe(true);
    expect(custom.enabled).toBe(true);
  });

  it('does not duplicate catalog-matched servers as custom entries', () => {
    const agent = makeAgent({ mcp_servers: { notion: { command: 'npx' } } });
    const ids = deriveCapabilities(agent, EMPTY_ENV).map((c) => c.id);
    expect(ids).not.toContain('mcp:notion');
  });
});

describe('applyCapabilityChanges', () => {
  it('disables a tool capability by adding to disallowed_tools only', () => {
    const agent = makeAgent({ tools: [], disallowed_tools: [] });
    const updates = applyCapabilityChanges(agent, [{ id: 'run-commands', enabled: false }], EMPTY_ENV);
    expect(updates.disallowed_tools).toEqual(['Bash']);
    expect(updates.tools).toBeUndefined();
  });

  it('re-enables a tool capability by clearing the denial', () => {
    const agent = makeAgent({ tools: [], disallowed_tools: ['Bash'] });
    const updates = applyCapabilityChanges(agent, [{ id: 'run-commands', enabled: true }], EMPTY_ENV);
    expect(updates.disallowed_tools).toEqual([]);
  });

  it('adds missing tools to a non-empty allowlist on enable', () => {
    const agent = makeAgent({ tools: ['Read'] });
    const updates = applyCapabilityChanges(agent, [{ id: 'write-files', enabled: true }], EMPTY_ENV);
    expect(updates.tools).toEqual(['Read', 'Write', 'Edit']);
  });

  it('never empties the allowlist when disabling (no unrestricted flip)', () => {
    const agent = makeAgent({ tools: ['Read'] });
    const updates = applyCapabilityChanges(agent, [{ id: 'read-files', enabled: false }], EMPTY_ENV);
    expect(updates.tools).toBeUndefined();
    expect(updates.disallowed_tools).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('writes the catalog server config when enabling a known mcp capability', () => {
    const agent = makeAgent();
    const updates = applyCapabilityChanges(
      agent,
      [{ id: 'notion', enabled: true }],
      { NOTION_API_KEY: 'secret' },
    );
    expect(updates.mcp_servers?.notion).toEqual({
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server'],
      env: { NOTION_TOKEN: '${NOTION_API_KEY}' },
    });
  });

  it('adds allowlist coverage for the server when tools is non-empty', () => {
    const agent = makeAgent({ tools: ['Read'] });
    const updates = applyCapabilityChanges(
      agent,
      [{ id: 'notion', enabled: true }],
      { NOTION_API_KEY: 'secret' },
    );
    expect(updates.tools).toEqual(['Read', 'mcp__notion']);
  });

  it('writes the hosted TripMaster server with a bearer API key on enable', () => {
    const updates = applyCapabilityChanges(
      makeAgent(),
      [{ id: 'tripmaster', enabled: true }],
      { TRIPMASTER_API_KEY: 'tm-key' },
    );
    expect(updates.mcp_servers?.tripmaster).toEqual({
      type: 'http',
      url: 'https://www.tripmaster.dev/mcp',
      headers: { Authorization: 'Bearer ${TRIPMASTER_API_KEY}' },
    });
  });

  it('enables an OAuth mcp capability with no key and no headers', () => {
    const updates = applyCapabilityChanges(
      makeAgent(),
      [{ id: 'calorienerds', enabled: true }],
      EMPTY_ENV,
    );
    expect(updates.mcp_servers?.calorienerds).toEqual({
      type: 'http',
      url: 'https://www.calorienerds.dev/mcp',
    });
  });

  it('resolves remote server URLs from env at enable time', () => {
    const updates = applyCapabilityChanges(
      makeAgent(),
      [{ id: 'gmail', enabled: true }],
      { GMAIL_MCP_URL: 'https://mail.example/mcp', GMAIL_MCP_TOKEN: 'g-tok' },
    );
    expect(updates.mcp_servers?.gmail).toEqual({
      type: 'http',
      url: 'https://mail.example/mcp',
      headers: { Authorization: 'Bearer ${GMAIL_MCP_TOKEN}' },
    });
  });

  it('throws missing_env with the missing variable names', () => {
    let caught: unknown;
    try {
      applyCapabilityChanges(makeAgent(), [{ id: 'tripmaster', enabled: true }], EMPTY_ENV);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CapabilityError);
    expect((caught as CapabilityError).code).toBe('missing_env');
    expect((caught as CapabilityError).missingEnv).toEqual(['TRIPMASTER_API_KEY']);
  });

  it('disables an mcp capability by denying the server rule, keeping the entry', () => {
    const agent = makeAgent({ mcp_servers: { notion: { command: 'npx' } } });
    const updates = applyCapabilityChanges(agent, [{ id: 'notion', enabled: false }], EMPTY_ENV);
    expect(updates.disallowed_tools).toEqual(['mcp__notion']);
    expect(updates.mcp_servers).toBeUndefined();
  });

  it('reuses the existing matched server key rather than the canonical name', () => {
    const agent = makeAgent({
      mcp_servers: { 'notion-personal': { command: 'npx' } },
    });
    const updates = applyCapabilityChanges(agent, [{ id: 'notion', enabled: false }], EMPTY_ENV);
    expect(updates.disallowed_tools).toEqual(['mcp__notion-personal']);
  });

  it('toggles custom mcp capabilities by id', () => {
    const agent = makeAgent({
      mcp_servers: { 'my-weather': { type: 'http', url: 'https://weather.example/mcp' } },
    });
    const off = applyCapabilityChanges(agent, [{ id: 'mcp:my-weather', enabled: false }], EMPTY_ENV);
    expect(off.disallowed_tools).toEqual(['mcp__my-weather']);

    const denied = makeAgent({
      mcp_servers: { 'my-weather': { type: 'http', url: 'https://weather.example/mcp' } },
      disallowed_tools: ['mcp__my-weather'],
    });
    const on = applyCapabilityChanges(denied, [{ id: 'mcp:my-weather', enabled: true }], EMPTY_ENV);
    expect(on.disallowed_tools).toEqual([]);
  });

  it('rejects toggling a custom mcp capability that does not exist', () => {
    expect(() =>
      applyCapabilityChanges(makeAgent(), [{ id: 'mcp:ghost', enabled: false }], EMPTY_ENV),
    ).toThrow(CapabilityError);
  });

  it('rejects unknown capability ids', () => {
    expect(() =>
      applyCapabilityChanges(makeAgent(), [{ id: 'jetpack', enabled: true }], EMPTY_ENV),
    ).toThrow(CapabilityError);
  });

  it('does not mutate the input agent', () => {
    const agent = makeAgent({ tools: ['Read'], disallowed_tools: [] });
    applyCapabilityChanges(agent, [{ id: 'run-commands', enabled: false }], EMPTY_ENV);
    expect(agent.tools).toEqual(['Read']);
    expect(agent.disallowed_tools).toEqual([]);
  });
});

describe('catalogSummary', () => {
  it('lists every catalog entry with env readiness', () => {
    const summary = catalogSummary({ NOTION_API_KEY: 'x' });
    expect(summary.map((s) => s.id)).toEqual(CAPABILITY_CATALOG.map((d) => d.id));
    expect(summary.find((s) => s.id === 'notion')?.env_ready).toBe(true);
    expect(summary.find((s) => s.id === 'slack')?.env_ready).toBe(false);
    expect(summary.find((s) => s.id === 'calendar')?.builtin).toBe(true);
  });
});

describe('redactAgentSecrets', () => {
  it('masks literal secrets but keeps ${VAR} references', () => {
    const agent = makeAgent({
      mcp_servers: {
        notion: {
          command: 'npx',
          env: { NOTION_TOKEN: 'ntn_hardcoded_secret', SAFE: '${NOTION_API_KEY}' },
        },
        remote: {
          type: 'http',
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer abc123' },
        },
      },
    });
    const redacted = redactAgentSecrets(agent);
    const notion = redacted.mcp_servers?.notion;
    const remote = redacted.mcp_servers?.remote;
    expect(notion && 'env' in notion ? notion.env : undefined).toEqual({
      NOTION_TOKEN: '__redacted__',
      SAFE: '${NOTION_API_KEY}',
    });
    expect(remote && 'headers' in remote ? remote.headers : undefined).toEqual({
      Authorization: '__redacted__',
    });
    // Original untouched.
    const original = agent.mcp_servers?.notion;
    expect(original && 'env' in original ? original.env?.NOTION_TOKEN : undefined).toBe(
      'ntn_hardcoded_secret',
    );
  });

  it('returns the agent unchanged when there are no mcp servers', () => {
    const agent = makeAgent();
    expect(redactAgentSecrets(agent)).toBe(agent);
  });
});
