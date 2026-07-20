import { describe, it, expect } from 'vitest';
import { loadConfig, loadEnvFile } from './config.js';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import {
  ENVIRONMENT_VARIABLE_REFERENCE,
  renderEnvironmentReferenceTable,
} from './environment-reference.js';

describe('loadConfig', () => {
  it('uses defaults when no env vars are set', () => {
    const config = loadConfig({});
    expect(config.agentsDir).toBe(join(homedir(), '.agent-server', 'agents'));
    expect(config.lockDir).toBe(join(homedir(), '.agent-server', 'locks'));
    expect(config.checkIntervalMs).toBe(60_000);
    expect(config.heartbeatMs).toBe(30_000);
    expect(config.telemetryProgressMode).toBe('live');
    expect(config.telemetryProgressSampleMs).toBe(5_000);
    expect(config.telemetryProgressMaxEntries).toBe(50);
    expect(config.telemetryProgressIncludeMetadata).toBe(false);
    expect(config.port).toBe(47821);
    expect(config.host).toBe('127.0.0.1');
    expect(config.panelUrl).toBeUndefined();
    expect(config.panelApiKey).toBeUndefined();
    expect(config.panelEnabled).toBe(true);
    expect(config.apiKey).toBeUndefined();
    expect(config.maxConcurrentRuns).toBe(8);
    expect(config.maxTriggerDepth).toBe(10);
    expect(config.maxWebSocketClients).toBe(100);
    expect(config.runDbPath).toBe(join(homedir(), '.agent-server', 'runs.db'));
  });

  it('derives local state from a custom Agent Server home', () => {
    const config = loadConfig({ AGENT_SERVER_HOME: '/Volumes/Work/Agent Server' });

    expect(config.agentsDir).toBe('/Volumes/Work/Agent Server/agents');
    expect(config.lockDir).toBe('/Volumes/Work/Agent Server/locks');
    expect(config.logsDir).toBe('/Volumes/Work/Agent Server/logs');
    expect(config.runDbPath).toBe('/Volumes/Work/Agent Server/runs.db');
  });

  it('keeps explicit advanced paths above the selected home', () => {
    const config = loadConfig({
      AGENT_SERVER_HOME: '/Volumes/Work/Agent Server',
      AGENT_SERVER_AGENTS_DIR: '/tmp/special-agents',
    });

    expect(config.agentsDir).toBe('/tmp/special-agents');
    expect(config.lockDir).toBe('/Volumes/Work/Agent Server/locks');
  });

  it('reads from environment variables', () => {
    const config = loadConfig({
      AGENT_SERVER_AGENTS_DIR: '/tmp/agents',
      AGENT_SERVER_LOCK_DIR: '/tmp/locks',
      AGENT_SERVER_PANEL_URL: 'https://panel.example.com',
      AGENT_SERVER_PANEL_API_KEY: 'ap_live_test',
      AGENT_SERVER_API_KEY: 'local-secret-key-123',
      AGENT_SERVER_CHECK_INTERVAL_MS: '5000',
      AGENT_SERVER_PORT: '8080',
      AGENT_SERVER_HOST: '0.0.0.0',
      AGENT_SERVER_MAX_CONCURRENT_RUNS: '3',
      AGENT_SERVER_MAX_TRIGGER_DEPTH: '4',
      AGENT_SERVER_MAX_WS_CLIENTS: '25',
      AGENT_SERVER_TELEMETRY_PROGRESS_MODE: 'batched',
      AGENT_SERVER_TELEMETRY_PROGRESS_SAMPLE_MS: '7000',
      AGENT_SERVER_TELEMETRY_PROGRESS_MAX_ENTRIES: '20',
      AGENT_SERVER_TELEMETRY_PROGRESS_INCLUDE_METADATA: 'true',
      AGENT_SERVER_RUN_DB: '/tmp/history.db',
    });
    expect(config.runDbPath).toBe('/tmp/history.db');
    expect(config.agentsDir).toBe('/tmp/agents');
    expect(config.lockDir).toBe('/tmp/locks');
    expect(config.panelUrl).toBe('https://panel.example.com');
    expect(config.panelApiKey).toBe('ap_live_test');
    expect(config.apiKey).toBe('local-secret-key-123');
    expect(config.checkIntervalMs).toBe(5000);
    expect(config.port).toBe(8080);
    expect(config.host).toBe('0.0.0.0');
    expect(config.maxConcurrentRuns).toBe(3);
    expect(config.maxTriggerDepth).toBe(4);
    expect(config.maxWebSocketClients).toBe(25);
    expect(config.telemetryProgressMode).toBe('batched');
    expect(config.telemetryProgressSampleMs).toBe(7000);
    expect(config.telemetryProgressMaxEntries).toBe(20);
    expect(config.telemetryProgressIncludeMetadata).toBe(true);
  });

  it('rejects short API keys', () => {
    expect(() => loadConfig({ AGENT_SERVER_API_KEY: 'short-key' })).toThrow();
  });

  it('treats empty panel URL as undefined', () => {
    const config = loadConfig({ AGENT_SERVER_PANEL_URL: '' });
    expect(config.panelUrl).toBeUndefined();
  });

  it('keeps panel credentials stored while disabling all panel traffic', () => {
    const config = loadConfig({
      AGENT_SERVER_PANEL_URL: 'https://panel.example.com',
      AGENT_SERVER_PANEL_API_KEY: 'ap_live_test',
      AGENT_SERVER_PANEL_ENABLED: 'false',
    });

    expect(config.panelEnabled).toBe(false);
    expect(config.panelUrl).toBeUndefined();
    expect(config.panelApiKey).toBeUndefined();
  });

  it('reads Slack tokens from bare or prefixed names', () => {
    const bare = loadConfig({ SLACK_BOT_TOKEN: 'xoxb-1', SLACK_APP_TOKEN: 'xapp-1' });
    expect(bare.slackBotToken).toBe('xoxb-1');
    expect(bare.slackAppToken).toBe('xapp-1');

    // The AGENT_SERVER_-prefixed form wins when both are present.
    const prefixed = loadConfig({
      AGENT_SERVER_SLACK_BOT_TOKEN: 'xoxb-pref',
      SLACK_BOT_TOKEN: 'xoxb-bare',
    });
    expect(prefixed.slackBotToken).toBe('xoxb-pref');
  });
});

describe('environment reference', () => {
  const readme = readFileSync(join(import.meta.dirname, '../../../README.md'), 'utf-8');

  it('matches the canonical generated table', () => {
    const table = readme.match(/\| Variable \| Default \| Description \|\n[\s\S]*?(?=\n\nExample)/)?.[0];
    expect(table).toBe(renderEnvironmentReferenceTable());
  });

  it('documents every Agent Server input that loadConfig accepts', () => {
    const configSource = readFileSync(join(import.meta.dirname, 'config.ts'), 'utf-8');
    const configuredNames = new Set(
      [...configSource.matchAll(/env\.(AGENT_SERVER_[A-Z0-9_]+)/g)].map((match) => match[1]),
    );
    const documentedNames = new Set(ENVIRONMENT_VARIABLE_REFERENCE.map(({ name }) => name));

    expect([...configuredNames].filter((name) => !documentedNames.has(name))).toEqual([]);
    expect(documentedNames.size).toBe(ENVIRONMENT_VARIABLE_REFERENCE.length);
  });

  it('states that local API authentication is required and init generates its key', () => {
    expect(readme).toContain('`AGENT_SERVER_API_KEY` is required for every server start.');
    expect(readme).toContain('`agent-server init` generates');
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

  it('uses .env as the only Agent Server environment file', () => {
    const dir = createTempDir();
    writeFileSync(join(dir, '.env'), 'NOTION_API_KEY=from-env\nSHARED=base\n');
    writeFileSync(join(dir, '.env.local'), 'NOTION_API_KEY=from-local\nLOCAL_ONLY=secret\n');

    const env = loadEnvFile(dir);

    expect(env.NOTION_API_KEY).toBe('from-env');
    expect(env.SHARED).toBe('base');
    expect(env.LOCAL_ONLY).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps shell env above .env', () => {
    const dir = createTempDir();
    writeFileSync(join(dir, '.env'), 'NOTION_API_KEY=from-env\n');

    const env = loadEnvFile(dir, { NOTION_API_KEY: 'from-shell' });

    expect(env.NOTION_API_KEY).toBe('from-shell');
    rmSync(dir, { recursive: true, force: true });
  });
});
