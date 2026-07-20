import { afterEach, describe, expect, it } from 'vitest';
import { makeAgent } from '../test-factories.js';
import {
  buildClaudeChildEnvironment,
  buildCodexChildEnvironment,
  buildKimiChildEnvironment,
  resolveApprovedMcpValues,
  resolveApprovedProviderKey,
} from './environment-policy.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('agent environment policy', () => {
  it('gives subscription agents only safe runtime variables', () => {
    process.env.PATH = '/usr/bin';
    process.env.HOME = '/Users/tester';
    process.env.AGENT_SERVER_API_KEY = 'server-secret';
    process.env.DATABASE_URL = 'postgres://secret';

    const environment = buildClaudeChildEnvironment(makeAgent());

    expect(environment.PATH).toBe('/usr/bin');
    expect(environment.HOME).toBe('/Users/tester');
    expect(environment.AGENT_SERVER_API_KEY).toBeUndefined();
    expect(environment.DATABASE_URL).toBeUndefined();
  });

  it('keeps Codex login settings without passing unrelated server secrets', () => {
    const environment = buildCodexChildEnvironment({
      CODEX_HOME: '/Users/tester/.codex',
      HOME: '/Users/tester',
      PATH: '/usr/bin',
      AGENT_SERVER_API_KEY: 'server-secret',
      OPENAI_API_KEY: 'unneeded-key',
    });

    expect(environment).toMatchObject({
      CODEX_HOME: '/Users/tester/.codex',
      HOME: '/Users/tester',
      PATH: '/usr/bin',
    });
    expect(environment.AGENT_SERVER_API_KEY).toBeUndefined();
    expect(environment.OPENAI_API_KEY).toBeUndefined();
  });

  it('keeps Kimi Code login settings without passing server or provider secrets', () => {
    const environment = buildKimiChildEnvironment({
      KIMI_CODE_HOME: '/Users/tester/.kimi-code',
      HOME: '/Users/tester',
      LANG: 'en_US.UTF-8',
      PATH: '/usr/bin',
      TMPDIR: '/private/tmp',
      AGENT_SERVER_API_KEY: 'server-secret',
      KIMI_API_KEY: 'provider-secret',
      MOONSHOT_API_KEY: 'moonshot-secret',
      NOTION_API_KEY: 'notion-secret',
      HTTPS_PROXY: 'https://proxy-user:proxy-secret@example.com',
    });

    expect(environment).toEqual({
      HOME: '/Users/tester',
      LANG: 'en_US.UTF-8',
      PATH: '/usr/bin',
      TMPDIR: '/private/tmp',
      KIMI_CODE_HOME: '/Users/tester/.kimi-code',
      KIMI_DISABLE_CRON: '1',
    });
  });

  it('adds only an approved provider credential', () => {
    const source = { MOONSHOT_API_KEY: 'moonshot-secret', DATABASE_URL: 'database-secret' };

    expect(resolveApprovedProviderKey(
      { base_url: 'https://api.moonshot.ai/v1', api_key: '${MOONSHOT_API_KEY}' },
      source,
    )).toBe('moonshot-secret');
    expect(() => resolveApprovedProviderKey(
      { base_url: 'https://database.attacker.example/v1', api_key: '${DATABASE_URL}' },
      source,
    )).toThrow(/not approved/i);
  });

  it('resolves trusted catalog MCP variables and rejects renamed exfiltration', () => {
    const source = { NOTION_API_KEY: 'notion-secret', DATABASE_URL: 'database-secret' };
    expect(resolveApprovedMcpValues(
      { name: 'notion', command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'] },
      { NOTION_TOKEN: '${NOTION_API_KEY}' },
      source,
    )).toEqual({ NOTION_TOKEN: 'notion-secret' });
    expect(() => resolveApprovedMcpValues(
      { name: 'database', command: 'database-mcp' },
      { DATABASE_TOKEN: '${DATABASE_URL}' },
      source,
    )).toThrow(/not approved/i);
  });

  it('keeps existing Personal Notion and Hex connection references compatible', () => {
    const source = {
      NOTION_PERSONAL_API_KEY: 'personal-notion-secret',
      HEX_PERSONAL_ACCESS_TOKEN: 'hex-secret',
    };

    expect(resolveApprovedMcpValues(
      { name: 'notion-personal', command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'] },
      { NOTION_TOKEN: '${NOTION_PERSONAL_API_KEY}' },
      source,
    )).toEqual({ NOTION_TOKEN: 'personal-notion-secret' });
    expect(resolveApprovedMcpValues(
      { name: 'hex', url: 'https://app.hex.tech/mcp' },
      { Authorization: 'Bearer ${HEX_PERSONAL_ACCESS_TOKEN}' },
      source,
    )).toEqual({ Authorization: 'Bearer hex-secret' });
  });

  it('binds personal connection credentials to their canonical transports', () => {
    const source = {
      NOTION_PERSONAL_API_KEY: 'personal-notion-secret',
      HEX_PERSONAL_ACCESS_TOKEN: 'hex-secret',
    };

    expect(() => resolveApprovedMcpValues(
      { name: 'notion-personal', command: 'attacker-command' },
      { TOKEN: '${NOTION_PERSONAL_API_KEY}' },
      source,
    )).toThrow(/not approved/i);
    expect(() => resolveApprovedMcpValues(
      { name: 'notion-personal', command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'] },
      { TOKEN: '${NOTION_API_KEY}' },
      { NOTION_API_KEY: 'work-notion-secret' },
    )).toThrow(/not approved/i);
    expect(() => resolveApprovedMcpValues(
      { name: 'NOTION-PERSONAL', command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'] },
      { TOKEN: '${NOTION_API_KEY}' },
      { NOTION_API_KEY: 'work-notion-secret' },
    )).toThrow(/not approved/i);
    expect(() => resolveApprovedMcpValues(
      { name: 'other-notion', command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'] },
      { TOKEN: '${NOTION_PERSONAL_API_KEY}' },
      source,
    )).toThrow(/not approved/i);
    expect(() => resolveApprovedMcpValues(
      { name: 'hex', url: 'https://attacker.example/mcp' },
      { Authorization: 'Bearer ${HEX_PERSONAL_ACCESS_TOKEN}' },
      source,
    )).toThrow(/not approved/i);
    expect(() => resolveApprovedMcpValues(
      { name: 'notion-personal', command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'] },
      {
        NOTION_TOKEN: '${NOTION_PERSONAL_API_KEY}',
        PATH: '/tmp/attacker-bin',
      },
      source,
    )).toThrow(/not approved/i);
  });

  it('binds every catalog credential to its intended field and transport', () => {
    const source = { SLACK_BOT_TOKEN: 'bot-secret', SLACK_TEAM_ID: 'team-id' };
    const slack = {
      name: 'slack',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
    } as const;

    expect(() => resolveApprovedMcpValues(
      slack,
      { SLACK_TEAM_ID: '${SLACK_BOT_TOKEN}', SLACK_BOT_TOKEN: '${SLACK_TEAM_ID}' },
      source,
    )).toThrow(/not approved/i);
    expect(() => resolveApprovedMcpValues(
      { name: 'slack', command: 'attacker-command' },
      { SLACK_BOT_TOKEN: '${SLACK_BOT_TOKEN}' },
      source,
    )).toThrow(/not approved/i);
    expect(() => resolveApprovedMcpValues(
      slack,
      { constructor: '${SLACK_BOT_TOKEN}' },
      source,
    )).toThrow(/not approved/i);
  });
});
