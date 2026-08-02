import { describe, expect, it } from 'vitest';
import {
  parseCodexMcpInventory,
  parseKimiMcpInventory,
  runtimeConnectionInventory,
} from './runtime-mcp-inventory.js';

describe('coding-agent MCP inventory', () => {
  it('reduces Codex configuration to names and coarse states', () => {
    const inventory = parseCodexMcpInventory([
      {
        name: 'github',
        enabled: true,
        auth_status: 'bearer_token',
        transport: { type: 'streamable_http', url: 'https://secret.example' },
      },
      {
        name: 'figma',
        enabled: true,
        auth_status: 'not_logged_in',
        transport: { type: 'streamable_http', bearer_token_env_var: 'SECRET_TOKEN' },
      },
      { name: 'computer-use', enabled: false, auth_status: 'unsupported' },
    ]);

    expect(inventory).toEqual([
      { name: 'computer-use', status: 'disabled' },
      { name: 'figma', status: 'needs_auth' },
      { name: 'github', status: 'configured' },
    ]);
    expect(JSON.stringify(inventory)).not.toContain('secret');
    expect(JSON.stringify(inventory)).not.toContain('SECRET_TOKEN');
  });

  it('reduces Kimi configuration without returning connection details', () => {
    const inventory = parseKimiMcpInventory({
      mcpServers: {
        notion: { url: 'https://secret.example', headers: { Authorization: 'secret' } },
        local: { command: 'private-command', enabled: false },
      },
    });

    expect(inventory).toEqual([
      { name: 'local', status: 'disabled' },
      { name: 'notion', status: 'configured' },
    ]);
    expect(JSON.stringify(inventory)).not.toContain('private-command');
  });

  it('keeps every coding agent and labels Claude health separately from configuration', () => {
    const runtimes = runtimeConnectionInventory({
      paths: {
        claudeExecutablePath: '/private/claude',
        codexExecutablePath: '/private/codex',
      },
      claudeServers: [
        { name: 'claude.ai Notion', status: 'connected' },
        { name: 'claude.ai Slack', status: 'needs-auth' },
      ],
      codexServers: [{ name: 'github', status: 'configured' }],
      kimiServers: [],
      codexState: 'ready',
      kimiState: 'ready',
    });

    expect(runtimes).toEqual([
      expect.objectContaining({
        id: 'claude-code',
        installed: true,
        mcp_servers: [
          { name: 'claude.ai Notion', status: 'connected' },
          { name: 'claude.ai Slack', status: 'needs_auth' },
        ],
      }),
      expect.objectContaining({
        id: 'codex',
        installed: true,
        mcp_servers: [{ name: 'github', status: 'configured' }],
      }),
      expect.objectContaining({ id: 'kimi-code', installed: false, mcp_servers: [] }),
    ]);
    expect(JSON.stringify(runtimes)).not.toContain('/private/');
  });

  it('retains known servers while reporting a failed inventory check', () => {
    const [runtime] = runtimeConnectionInventory({
      paths: { claudeExecutablePath: '/private/claude' },
      claudeServers: [{ name: 'Notion', status: 'pending' }],
      claudeState: 'failed',
      codexServers: [],
      kimiServers: [],
      codexState: 'unavailable',
      kimiState: 'unavailable',
    });

    expect(runtime).toEqual(expect.objectContaining({
      mcp_inventory_state: 'failed',
      mcp_servers: [{ name: 'Notion', status: 'pending' }],
    }));
  });
});
