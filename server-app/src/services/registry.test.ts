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
        name: 'Work Notion',
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
});
