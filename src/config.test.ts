import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';
import { homedir } from 'os';
import { join } from 'path';

describe('loadConfig', () => {
  it('uses defaults when no env vars are set', () => {
    const config = loadConfig({});
    expect(config.agentsDir).toBe(join(homedir(), '.agent-server', 'agents'));
    expect(config.lockDir).toBe(join(homedir(), '.agent-server', 'locks'));
    expect(config.checkIntervalMs).toBe(60_000);
    expect(config.heartbeatMs).toBe(30_000);
    expect(config.port).toBe(47821);
    expect(config.panelUrl).toBeUndefined();
    expect(config.panelApiKey).toBeUndefined();
  });

  it('reads from environment variables', () => {
    const config = loadConfig({
      AGENT_SERVER_AGENTS_DIR: '/tmp/agents',
      AGENT_SERVER_LOCK_DIR: '/tmp/locks',
      AGENT_SERVER_PANEL_URL: 'https://panel.example.com',
      AGENT_SERVER_PANEL_API_KEY: 'ap_live_test',
      AGENT_SERVER_CHECK_INTERVAL_MS: '5000',
      AGENT_SERVER_PORT: '8080',
    });
    expect(config.agentsDir).toBe('/tmp/agents');
    expect(config.lockDir).toBe('/tmp/locks');
    expect(config.panelUrl).toBe('https://panel.example.com');
    expect(config.panelApiKey).toBe('ap_live_test');
    expect(config.checkIntervalMs).toBe(5000);
    expect(config.port).toBe(8080);
  });

  it('treats empty panel URL as undefined', () => {
    const config = loadConfig({ AGENT_SERVER_PANEL_URL: '' });
    expect(config.panelUrl).toBeUndefined();
  });
});
