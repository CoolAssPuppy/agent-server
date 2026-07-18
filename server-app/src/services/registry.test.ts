import { describe, expect, it } from 'vitest';
import { makeAgent } from '../test-factories.js';
import { buildServiceRegistry } from './registry.js';

describe('consumer service registry', () => {
  it('distinguishes an account connector from a personal API-key connection', () => {
    const personal = makeAgent({
      id: 'personal-notes',
      mcp_servers: {
        'notion-personal': {
          command: 'npx',
          args: ['-y', '@notionhq/notion-mcp-server'],
          env: { NOTION_TOKEN: '${NOTION_PERSONAL_API_KEY}' },
        },
      },
    });

    const services = buildServiceRegistry({
      agents: [personal],
      environment: { NOTION_PERSONAL_API_KEY: 'configured-secret' },
      discovered: [{ name: 'claude.ai Notion', status: 'connected' }],
    }).connections;

    expect(services).toEqual(expect.arrayContaining([
      expect.objectContaining({
        service_id: 'notion',
        name: 'Personal Notion',
        source: 'configured_api',
        status: 'connected',
      }),
      expect.objectContaining({
        service_id: 'notion',
        name: 'Notion (Claude account)',
        source: 'account',
        status: 'connected',
      }),
    ]));
    expect(new Set(services.map((service) => service.id)).size).toBe(services.length);
    expect(JSON.stringify(services)).not.toContain('configured-secret');
    expect(JSON.stringify(services)).not.toContain('NOTION_PERSONAL_API_KEY');
  });

  it('offers configured catalog APIs without requiring a discovered MCP account', () => {
    const services = buildServiceRegistry({
      agents: [],
      environment: { TRIPMASTER_API_KEY: 'configured-secret' },
      discovered: [],
    }).connections;

    expect(services).toContainEqual(expect.objectContaining({
      id: 'catalog:tripmaster',
      service_id: 'tripmaster',
      name: 'TripMaster',
      source: 'configured_api',
      status: 'connected',
    }));
  });

  it('deduplicates reusable agent MCP configurations', () => {
    const server = {
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server'],
      env: { NOTION_TOKEN: '${NOTION_PERSONAL_API_KEY}' },
    } as const;
    const services = buildServiceRegistry({
      agents: [
        makeAgent({ id: 'one', mcp_servers: { 'notion-personal': server } }),
        makeAgent({ id: 'two', mcp_servers: { 'notion-personal': server } }),
      ],
      environment: { NOTION_PERSONAL_API_KEY: 'configured-secret' },
      discovered: [],
    }).connections;

    expect(services.filter((service) => service.name === 'Personal Notion')).toHaveLength(1);
  });

  it('lists native Mac services with independent availability', () => {
    const services = buildServiceRegistry({
      agents: [],
      environment: {},
      discovered: [],
      nativeServices: [
        { id: 'calendar', name: 'Calendar', status: 'connected', actions: ['read', 'write'] },
        { id: 'contacts', name: 'Contacts', status: 'needs_setup', actions: ['read'] },
        { id: 'reminders', name: 'Reminders', status: 'connected', actions: ['read', 'write'] },
        { id: 'apple-music', name: 'Apple Music', status: 'unavailable', actions: ['read'] },
      ],
    }).connections;

    expect(services.filter((service) => service.source === 'macos')).toMatchObject([
      { id: 'macos:calendar', status: 'connected' },
      { id: 'macos:contacts', status: 'needs_setup' },
      { id: 'macos:reminders', status: 'connected' },
      { id: 'macos:apple-music', status: 'unavailable' },
    ]);
  });

  it('does not brand hostile catalog-like servers as official services', () => {
    const services = buildServiceRegistry({
      agents: [makeAgent({
        mcp_servers: {
          'notion-export': { type: 'http', url: 'https://attacker.example/mcp' },
        },
      })],
      environment: {},
      discovered: [],
    }).connections;

    expect(services).toContainEqual(expect.objectContaining({
      service_id: 'custom:notion-export',
      source: 'mcp',
      actions: [],
      actions_known: false,
    }));
  });

  it('never makes a literal credential reusable', () => {
    const registry = buildServiceRegistry({
      agents: [makeAgent({
        mcp_servers: {
          notion: {
            command: 'npx',
            args: ['-y', '@notionhq/notion-mcp-server'],
            env: { NOTION_TOKEN: 'literal-secret' },
          },
        },
      })],
      environment: {},
      discovered: [],
    });

    expect(registry.connections.some((service) => service.id.startsWith('mcp:notion:'))).toBe(false);
    expect(JSON.stringify(registry.connections)).not.toContain('literal-secret');
  });

  it('accepts a fixed authorization scheme around a referenced credential', () => {
    const registry = buildServiceRegistry({
      agents: [makeAgent({
        mcp_servers: {
          tripmaster: {
            type: 'http',
            url: 'https://www.tripmaster.dev/mcp',
            headers: { Authorization: 'Bearer ${TRIPMASTER_API_KEY}' },
          },
        },
      })],
      environment: { TRIPMASTER_API_KEY: 'configured-secret' },
      discovered: [],
    });

    expect(registry.connections).toContainEqual(expect.objectContaining({
      name: 'TripMaster connection',
      status: 'connected',
    }));
  });

  it('marks conflicting configurations for one runtime key as unavailable', () => {
    const registry = buildServiceRegistry({
      agents: [
        makeAgent({
          id: 'one',
          mcp_servers: { notion: { command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'] } },
        }),
        makeAgent({
          id: 'two',
          mcp_servers: { notion: { command: 'other-notion-command' } },
        }),
      ],
      environment: {},
      discovered: [],
    });

    expect(registry.connections.filter((service) => service.name.includes('Notion connection')))
      .toEqual(expect.arrayContaining([expect.objectContaining({ status: 'conflict' })]));
  });

  it('preserves unavailable runtime status and lists setup candidates', () => {
    const services = buildServiceRegistry({
      agents: [],
      environment: {},
      discovered: [{ name: 'claude.ai Notion', status: 'failed' }],
    }).connections;

    expect(services).toContainEqual(expect.objectContaining({
      id: 'catalog:slack',
      status: 'needs_setup',
    }));
    expect(services).toContainEqual(expect.objectContaining({
      id: 'runtime:claude.ai%20Notion',
      status: 'unavailable',
    }));
  });
});
