import { describe, it, expect } from 'vitest';
import { makeAgent } from '../test-factories.js';
import {
  CAPABILITY_CATALOG,
  CapabilityError,
  type DiscoveredConnection,
  type AvailableConnection,
  applyCapabilityChanges,
  catalogSummary,
  deriveCapabilities,
  mcpServerKey,
  redactAgentSecrets,
} from './capabilities.js';

const EMPTY_ENV: Record<string, string | undefined> = {};

const discovered = (...names: string[]): DiscoveredConnection[] =>
  names.map((name) => ({ name, status: 'connected' }));

const personalNotionConfig = {
  command: 'npx',
  args: ['-y', '@notionhq/notion-mcp-server'],
  env: { NOTION_TOKEN: '${NOTION_PERSONAL_API_KEY}' },
} as const;

const availableNotionConnections: AvailableConnection[] = [
  {
    id: 'mcp:notion-personal:one',
    serviceId: 'notion',
    name: 'Personal Notion',
    source: 'configured_api',
    status: 'connected',
    requiredEnv: ['NOTION_PERSONAL_API_KEY'],
    serverName: 'notion-personal',
    config: personalNotionConfig,
  },
  {
    id: 'runtime:claude.ai%20Notion',
    serviceId: 'notion',
    name: 'Notion (Claude account)',
    source: 'account',
    status: 'connected',
    requiredEnv: [],
    serverName: 'claude.ai Notion',
  },
];

function capability(
  agent = makeAgent(),
  id: string,
  env = EMPTY_ENV,
  conns: DiscoveredConnection[] = [],
) {
  const found = deriveCapabilities(agent, env, conns).find((c) => c.id === id);
  if (!found) throw new Error(`capability ${id} not derived`);
  return found;
}

describe('deriveCapabilities', () => {
  it('shows only built-in abilities on a bare agent (no service clutter)', () => {
    // A fresh agent with no configured keys and no discovered connectors should
    // list its local abilities and Calendar, but NOT every catalog service.
    const ids = deriveCapabilities(makeAgent(), EMPTY_ENV, []).map((c) => c.id);
    expect(ids).toEqual(['read-files', 'write-files', 'run-commands', 'browse-web', 'calendar']);
    expect(ids).not.toContain('notion');
    expect(ids).not.toContain('slack');
    expect(ids).not.toContain('linear');
  });

  it('surfaces a catalog service once its keys are configured', () => {
    // Configuring a key makes the service available to add — present in the
    // list, but off until it is actually wired into the agent.
    const notion = capability(makeAgent(), 'notion', { NOTION_API_KEY: 'secret' });
    expect(notion.env_ready).toBe(true);
    expect(notion.enabled).toBe(false);
  });

  it('surfaces an account connector the runtime can reach', () => {
    // "claude.ai Slack" is an account connector inherited from the subscription.
    // It maps onto the Slack catalog entry for its label/logo, keyed by the
    // runtime server name, and reads as on for an unrestricted agent.
    const slack = capability(makeAgent(), 'slack', EMPTY_ENV, discovered('claude.ai Slack'));
    expect(slack.enabled).toBe(true);
    expect(slack.server_name).toBe('claude_ai_Slack');
    expect(slack.status).toBe('connected');
  });

  it('surfaces an unknown account connector as a generic entry', () => {
    const hex = capability(makeAgent(), 'mcp:claude_ai_Hex', EMPTY_ENV, discovered('claude.ai Hex'));
    expect(hex.custom).toBe(true);
    expect(hex.label).toBe('Hex');
    expect(hex.server_name).toBe('claude_ai_Hex');
    expect(hex.enabled).toBe(true);
  });

  it('reflects a needs-auth account connector status', () => {
    const conns: DiscoveredConnection[] = [{ name: 'claude.ai Linear', status: 'needs-auth' }];
    const linear = capability(makeAgent(), 'linear', EMPTY_ENV, conns);
    expect(linear.status).toBe('needs-auth');
  });

  it('disables an account connector via a server-level denial', () => {
    const agent = makeAgent({ disallowed_tools: ['mcp__claude_ai_Slack'] });
    const slack = capability(agent, 'slack', EMPTY_ENV, discovered('claude.ai Slack'));
    expect(slack.enabled).toBe(false);
  });

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

  it('uses the exact environment reference from a named server connection', () => {
    const agent = makeAgent({
      mcp_servers: {
        'notion-personal': {
          command: 'npx',
          args: ['-y', '@notionhq/notion-mcp-server'],
          env: { NOTION_TOKEN: '${NOTION_PERSONAL_API_KEY}' },
        },
      },
    });

    const ready = capability(agent, 'notion', { NOTION_PERSONAL_API_KEY: 'configured' });
    expect(ready.required_env).toEqual(['NOTION_PERSONAL_API_KEY']);
    expect(ready.env_ready).toBe(true);
    expect(ready.server_name).toBe('notion-personal');

    const missing = capability(agent, 'notion', { NOTION_API_KEY: 'wrong-account' });
    expect(missing.required_env).toEqual(['NOTION_PERSONAL_API_KEY']);
    expect(missing.env_ready).toBe(false);
  });

  it('identifies a named API-key connection instead of presenting it as generic MCP', () => {
    const agent = makeAgent({
      mcp_servers: {
        'notion-personal': {
          command: 'npx',
          args: ['-y', '@notionhq/notion-mcp-server'],
          env: { NOTION_TOKEN: '${NOTION_PERSONAL_API_KEY}' },
        },
      },
    });

    const notion = capability(
      agent,
      'notion',
      { NOTION_PERSONAL_API_KEY: 'configured' },
      discovered('notion-personal', 'claude.ai Notion'),
    );

    expect(notion).toMatchObject({
      label: 'Personal Notion',
      source: 'configured_api',
      server_name: 'notion-personal',
      status: 'connected',
    });
  });

  it('identifies an account-backed catalog connection as MCP', () => {
    const notion = capability(
      makeAgent(),
      'notion',
      EMPTY_ENV,
      discovered('claude.ai Notion'),
    );

    expect(notion).toMatchObject({
      label: 'Notion (Claude account)',
      source: 'account',
      server_name: 'claude_ai_Notion',
    });
  });

  it('keeps reusable Personal and Claude Notion connections separate for editing', () => {
    const rows = deriveCapabilities(
      makeAgent({ tools: ['Read'] }),
      { NOTION_PERSONAL_API_KEY: 'configured' },
      discovered('claude.ai Notion'),
      availableNotionConnections,
    ).filter((entry) => entry.label.includes('Notion'));

    expect(rows).toEqual([
      expect.objectContaining({
        id: 'connection:mcp:notion-personal:one',
        label: 'Personal Notion',
        source: 'configured_api',
        enabled: false,
        custom: false,
      }),
      expect.objectContaining({
        id: 'connection:runtime:claude.ai%20Notion',
        label: 'Notion (Claude account)',
        source: 'account',
        custom: false,
      }),
    ]);
  });

  it('does not report a connection ready when its grants name tools that it does not expose', () => {
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
    expect(capability(agent, 'notion').enabled).toBe(false);
    expect(capability(agent, 'read-files').enabled).toBe(true);
    // A service the agent never references (no server, no key, no connector)
    // does not appear at all.
    const ids = deriveCapabilities(agent, EMPTY_ENV, []).map((c) => c.id);
    expect(ids).not.toContain('slack');
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

  it('reports env readiness once a service is configured', () => {
    const agent = makeAgent();
    // With the key present the service surfaces and reads ready.
    expect(capability(agent, 'notion', { NOTION_API_KEY: 'secret' }).env_ready).toBe(true);
    expect(capability(agent, 'tripmaster', { TRIPMASTER_API_KEY: 'k' }).env_ready).toBe(true);
    // Without the key the service does not appear (no clutter).
    const bare = deriveCapabilities(agent, {}, []).map((c) => c.id);
    expect(bare).not.toContain('notion');
    expect(bare).not.toContain('tripmaster');
  });

  it('reports the auth model for each capability', () => {
    const agent = makeAgent();
    // Local abilities and the builtin are always present.
    expect(capability(agent, 'read-files').auth).toBe('none'); // local tools
    expect(capability(agent, 'calendar').auth).toBe('none'); // builtin eventkit
    // Key- and OAuth-based services need to be configured or discovered first.
    expect(capability(agent, 'notion', { NOTION_API_KEY: 'x' }).auth).toBe('api_key');
    expect(capability(agent, 'tripmaster', { TRIPMASTER_API_KEY: 'x' }).auth).toBe('api_key');
    const conns = discovered('claude.ai Linear', 'claude.ai CalorieNerds');
    expect(capability(agent, 'linear', EMPTY_ENV, conns).auth).toBe('oauth');
    expect(capability(agent, 'calorienerds', EMPTY_ENV, conns).auth).toBe('oauth');
  });

  it('normalizes runtime server names to their mcp tool key', () => {
    expect(mcpServerKey('claude.ai Slack')).toBe('claude_ai_Slack');
    expect(mcpServerKey('claude.ai Customer.io')).toBe('claude_ai_Customer_io');
    expect(mcpServerKey('plugin:figma:figma')).toBe('plugin_figma_figma');
    expect(mcpServerKey('eventkit')).toBe('eventkit');
    expect(mcpServerKey('claude.ai Name: Parallel Search MCP')).toBe(
      'claude_ai_Name_Parallel_Search_MCP',
    );
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
  it('attaches an existing named API connection by its reviewed identity', () => {
    const agent = makeAgent({ tools: ['Read'], permissions: { allow: ['Read'], deny: [] } });

    const updates = applyCapabilityChanges(
      agent,
      [{ id: 'connection:mcp:notion-personal:one', enabled: true }],
      { NOTION_PERSONAL_API_KEY: 'configured' },
      [],
      availableNotionConnections,
    );

    expect(updates.mcp_servers).toEqual({ 'notion-personal': personalNotionConfig });
    expect(updates.permissions?.allow).toContain('mcp__notion-personal__API-post-page');
  });
  it('removes file editing from the authoritative permissions policy', () => {
    const agent = makeAgent({
      tools: ['Read', 'Write', 'Edit', 'Bash'],
      permissions: {
        allow: ['Read', 'Write', 'Edit', 'Bash', 'mcp__notion-personal__notion-search'],
        deny: [],
      },
    });

    const updates = applyCapabilityChanges(agent, [{ id: 'write-files', enabled: false }]);

    expect(updates.permissions).toEqual({
      allow: ['Read', 'Bash', 'mcp__notion-personal__notion-search'],
      deny: ['Write', 'Edit'],
    });
    expect(updates.disallowed_tools).toBeUndefined();
    expect(deriveCapabilities({ ...agent, ...updates })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'write-files', enabled: false }),
        expect.objectContaining({ id: 'read-files', enabled: true }),
      ]),
    );
  });

  it('restores a local capability without changing unrelated permission grants', () => {
    const agent = makeAgent({
      permissions: {
        allow: ['Read', 'Write', 'Edit', 'mcp__notion-personal__notion-search'],
        deny: ['Write', 'Edit'],
      },
    });

    const updates = applyCapabilityChanges(agent, [{ id: 'write-files', enabled: true }]);

    expect(updates.permissions).toEqual({
      allow: ['Read', 'Write', 'Edit', 'mcp__notion-personal__notion-search'],
      deny: [],
    });
  });

  it('disables one connected service in the authoritative permissions policy', () => {
    const agent = makeAgent({
      mcp_servers: { 'notion-personal': { command: 'npx' } },
      permissions: {
        allow: [
          'Read',
          'mcp__notion-personal__notion-search',
          'mcp__notion-personal__notion-create-pages',
        ],
        deny: [],
      },
    });

    const updates = applyCapabilityChanges(agent, [{ id: 'notion', enabled: false }]);

    expect(updates.permissions).toEqual({
      allow: agent.permissions?.allow,
      deny: ['mcp__notion-personal__*'],
    });
    expect(capability({ ...agent, ...updates }, 'notion').enabled).toBe(false);
  });

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

  it('grants the real least-privilege tools exposed by Personal Notion', () => {
    const agent = makeAgent({
      mcp_servers: {
        'notion-personal': {
          command: 'npx',
          args: ['-y', '@notionhq/notion-mcp-server'],
          env: { NOTION_TOKEN: '${NOTION_PERSONAL_API_KEY}' },
        },
      },
      permissions: {
        allow: ['Read', 'mcp__notion-personal__notion-create-pages'],
        deny: ['mcp__notion-personal__*'],
      },
    });

    const updates = applyCapabilityChanges(
      agent,
      [{ id: 'notion', enabled: true }],
      { NOTION_PERSONAL_API_KEY: 'configured' },
    );

    expect(updates.permissions?.allow).toEqual(expect.arrayContaining([
      'mcp__notion-personal__API-query-data-source',
      'mcp__notion-personal__API-post-page',
    ]));
    expect(updates.permissions?.allow).not.toContain('mcp__notion-personal__*');
    expect(updates.permissions?.deny).not.toContain('mcp__notion-personal__*');
  });

  it('rejects enabling a named connection when its exact key is missing', () => {
    const agent = makeAgent({
      mcp_servers: {
        'notion-personal': {
          command: 'npx',
          args: ['-y', '@notionhq/notion-mcp-server'],
          env: { NOTION_TOKEN: '${NOTION_PERSONAL_API_KEY}' },
        },
      },
    });

    expect(() => applyCapabilityChanges(agent, [{ id: 'notion', enabled: true }], {
      NOTION_API_KEY: 'wrong-account',
    })).toThrow(expect.objectContaining({
      code: 'missing_env',
      missingEnv: ['NOTION_PERSONAL_API_KEY'],
    }));
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

  it('enables an account connector without writing a server or needing a key', () => {
    // Slack is available as an account connector, so enabling it just grants
    // allowlist coverage on the runtime key — no BYO server, no missing_env.
    const agent = makeAgent({ tools: ['Read'] });
    const updates = applyCapabilityChanges(
      agent,
      [{ id: 'slack', enabled: true }],
      EMPTY_ENV,
      discovered('claude.ai Slack'),
    );
    expect(updates.mcp_servers).toBeUndefined();
    expect(updates.tools).toEqual(['Read', 'mcp__claude_ai_Slack']);
  });

  it('disables an account connector by denying its runtime key', () => {
    const updates = applyCapabilityChanges(
      makeAgent(),
      [{ id: 'slack', enabled: false }],
      EMPTY_ENV,
      discovered('claude.ai Slack'),
    );
    expect(updates.disallowed_tools).toEqual(['mcp__claude_ai_Slack']);
    expect(updates.mcp_servers).toBeUndefined();
  });

  it('toggles a discovered non-catalog connector that the agent does not declare', () => {
    const agent = makeAgent({ tools: ['Read'] });
    const updates = applyCapabilityChanges(
      agent,
      [{ id: 'mcp:claude_ai_Hex', enabled: true }],
      EMPTY_ENV,
      discovered('claude.ai Hex'),
    );
    expect(updates.tools).toEqual(['Read', 'mcp__claude_ai_Hex']);
    expect(updates.mcp_servers).toBeUndefined();
  });

  it('still writes a BYO server when the service is not an account connector', () => {
    // No discovered Notion connector: enabling falls back to the BYO server.
    const updates = applyCapabilityChanges(
      makeAgent(),
      [{ id: 'notion', enabled: true }],
      { NOTION_API_KEY: 'secret' },
      discovered('claude.ai Slack'),
    );
    expect(updates.mcp_servers?.notion).toBeDefined();
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
