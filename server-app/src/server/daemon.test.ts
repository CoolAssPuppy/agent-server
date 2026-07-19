import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('../plugins/claude-code.js', () => ({
  executeAgent: vi.fn().mockResolvedValue({
    summary: 'Mock done',
    output: {},
    usage: { turns: 1 },
    turnCount: 1,
    toolsUsed: [],
    filesRead: [],
    filesWritten: [],
    commandsRun: [],
  }),
}));

import { runDueAgents, listAgents, runSingleAgent } from './daemon.js';
import { executeAgent } from '../plugins/claude-code.js';
import type { ServerConfig } from '../platform/config.js';

function createTempDir(): string {
  const dir = join(tmpdir(), `daemon-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeAgent(dir: string, filename: string, content: string): void {
  writeFileSync(join(dir, filename), content, 'utf-8');
}

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const base = createTempDir();
  return {
    agentsDir: join(base, 'agents'),
    lockDir: join(base, 'locks'),
    logsDir: join(base, 'logs'),
    checkIntervalMs: 60000,
    heartbeatMs: 30000,
    port: 47821,
    ...overrides,
  };
}

const EVERY_MINUTE_AGENT = `
id: always-runs
name: Always Runs
schedule: "* * * * *"
prompt: Do it.
`;

const NEVER_RUNS_AGENT = `
id: never-runs
name: Never Runs
schedule: "0 0 31 12 *"
prompt: Only Dec 31 at midnight.
`;

describe('runDueAgents', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('runs agents whose schedule matches current time', async () => {
    const config = makeConfig();
    dirs.push(config.agentsDir, config.lockDir);
    mkdirSync(config.agentsDir, { recursive: true });
    writeAgent(config.agentsDir, 'always.yaml', EVERY_MINUTE_AGENT);

    await runDueAgents(config);
    // Should not throw; agent runs via mocked executor
  });

  it('skips agents whose schedule does not match', async () => {
    const config = makeConfig();
    dirs.push(config.agentsDir, config.lockDir);
    mkdirSync(config.agentsDir, { recursive: true });
    writeAgent(config.agentsDir, 'never.yaml', NEVER_RUNS_AGENT);

    await runDueAgents(config);
    // No agents should run
  });

  it('handles empty agents directory', async () => {
    const config = makeConfig();
    dirs.push(config.agentsDir, config.lockDir);
    mkdirSync(config.agentsDir, { recursive: true });

    await expect(runDueAgents(config)).resolves.toBeUndefined();
  });
});

describe('listAgents', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('lists discovered agents', async () => {
    const config = makeConfig();
    dirs.push(config.agentsDir);
    mkdirSync(config.agentsDir, { recursive: true });
    writeAgent(config.agentsDir, 'test.yaml', EVERY_MINUTE_AGENT);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await listAgents(config);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('1 agent'));
    consoleSpy.mockRestore();
  });

  it('shows message when no agents found', async () => {
    const config = makeConfig();
    dirs.push(config.agentsDir);
    mkdirSync(config.agentsDir, { recursive: true });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await listAgents(config);
    expect(consoleSpy).toHaveBeenCalledWith('No agents found.');
    consoleSpy.mockRestore();
  });
});

describe('runSingleAgent', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('runs a specific agent by id', async () => {
    const config = makeConfig();
    dirs.push(config.agentsDir, config.lockDir);
    mkdirSync(config.agentsDir, { recursive: true });
    writeAgent(config.agentsDir, 'test.yaml', EVERY_MINUTE_AGENT);

    await runSingleAgent(config, 'always-runs');
  });

  it('resolves saved connection bindings for direct CLI runs', async () => {
    const config = makeConfig();
    dirs.push(config.agentsDir, config.lockDir);
    mkdirSync(config.agentsDir, { recursive: true });
    const connectionId = '11111111-1111-4111-8111-111111111111';
    writeAgent(config.agentsDir, 'bound.yaml', `
id: bound
name: Bound
prompt: Use notes.
connection_bindings:
  notes: ${connectionId}
`);
    writeFileSync(join(config.agentsDir, '..', 'connections.json'), JSON.stringify({
      schema_version: 1,
      connections: [{
        schema_version: 1,
        id: connectionId,
        label: 'Notes',
        adapter: { id: 'generic.mcp', version: 1 },
        runtime_name: 'notes',
        credentials: [],
        transport: {
          kind: 'mcp_stdio', command: 'notes-helper', args: [], environment: {},
        },
        created_at: '2026-07-19T18:00:00.000Z',
        updated_at: '2026-07-19T18:00:00.000Z',
      }],
    }), 'utf-8');

    await runSingleAgent(config, 'bound');

    expect(vi.mocked(executeAgent)).toHaveBeenLastCalledWith(expect.objectContaining({
      mcp_servers: { notes: { command: 'notes-helper', args: [], env: {} } },
    }), expect.anything(), expect.anything());
  });

  it('reports error for unknown agent id', async () => {
    const config = makeConfig();
    dirs.push(config.agentsDir);
    mkdirSync(config.agentsDir, { recursive: true });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runSingleAgent(config, 'nonexistent');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Agent not found'));
    consoleSpy.mockRestore();
  });
});
