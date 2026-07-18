import { afterEach, describe, expect, it } from 'vitest';
import { makeAgent } from '../test-factories.js';
import {
  buildClaudeChildEnvironment,
  buildCodexChildEnvironment,
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
      'notion',
      { NOTION_TOKEN: '${NOTION_API_KEY}' },
      source,
    )).toEqual({ NOTION_TOKEN: 'notion-secret' });
    expect(() => resolveApprovedMcpValues(
      'database',
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
      'notion-personal',
      { NOTION_TOKEN: '${NOTION_PERSONAL_API_KEY}' },
      source,
    )).toEqual({ NOTION_TOKEN: 'personal-notion-secret' });
    expect(resolveApprovedMcpValues(
      'hex',
      { Authorization: 'Bearer ${HEX_PERSONAL_ACCESS_TOKEN}' },
      source,
    )).toEqual({ Authorization: 'Bearer hex-secret' });
  });
});
