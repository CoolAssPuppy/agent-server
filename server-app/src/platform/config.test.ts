import { describe, it, expect } from 'vitest';
import { loadConfig, loadEnvFile } from './config.js';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

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
    expect(config.apiKey).toBeUndefined();
  });

  it('reads from environment variables', () => {
    const config = loadConfig({
      AGENT_SERVER_AGENTS_DIR: '/tmp/agents',
      AGENT_SERVER_LOCK_DIR: '/tmp/locks',
      AGENT_SERVER_PANEL_URL: 'https://panel.example.com',
      AGENT_SERVER_PANEL_API_KEY: 'ap_live_test',
      AGENT_SERVER_API_KEY: 'local-secret',
      AGENT_SERVER_CHECK_INTERVAL_MS: '5000',
      AGENT_SERVER_PORT: '8080',
    });
    expect(config.agentsDir).toBe('/tmp/agents');
    expect(config.lockDir).toBe('/tmp/locks');
    expect(config.panelUrl).toBe('https://panel.example.com');
    expect(config.panelApiKey).toBe('ap_live_test');
    expect(config.apiKey).toBe('local-secret');
    expect(config.checkIntervalMs).toBe(5000);
    expect(config.port).toBe(8080);
  });

  it('treats empty panel URL as undefined', () => {
    const config = loadConfig({ AGENT_SERVER_PANEL_URL: '' });
    expect(config.panelUrl).toBeUndefined();
  });
});

function createTempDir(): string {
  const dir = join(tmpdir(), `agent-server-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('loadEnvFile', () => {
  it('loads variables from a .env file', () => {
    const dir = createTempDir();
    writeFileSync(join(dir, '.env'), 'AGENT_SERVER_PANEL_URL=https://panel.test.com\nAGENT_SERVER_PANEL_API_KEY=sk_test\n');

    const env = loadEnvFile(dir);

    expect(env.AGENT_SERVER_PANEL_URL).toBe('https://panel.test.com');
    expect(env.AGENT_SERVER_PANEL_API_KEY).toBe('sk_test');
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty object when no .env file exists', () => {
    const dir = createTempDir();

    const env = loadEnvFile(dir);

    expect(env).toEqual({});
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not override existing process.env values', () => {
    const dir = createTempDir();
    writeFileSync(join(dir, '.env'), 'AGENT_SERVER_PORT=9999\n');

    const existing = { AGENT_SERVER_PORT: '1234' };
    const env = loadEnvFile(dir, existing);

    expect(env.AGENT_SERVER_PORT).toBe('1234');
    rmSync(dir, { recursive: true, force: true });
  });

  it('fills in values not present in existing env', () => {
    const dir = createTempDir();
    writeFileSync(join(dir, '.env'), 'AGENT_SERVER_PORT=9999\nAGENT_SERVER_PANEL_URL=https://from-file.com\n');

    const existing = { AGENT_SERVER_PORT: '1234' };
    const env = loadEnvFile(dir, existing);

    expect(env.AGENT_SERVER_PORT).toBe('1234');
    expect(env.AGENT_SERVER_PANEL_URL).toBe('https://from-file.com');
    rmSync(dir, { recursive: true, force: true });
  });
});
