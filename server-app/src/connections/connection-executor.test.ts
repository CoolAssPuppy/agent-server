import { describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile } from './profile.js';
import { createConnectionResolvingExecutor } from './connection-executor.js';
import { makeAgent, makeExecutionResult } from '../test-factories.js';

const profile: ConnectionProfile = {
  schema_version: 1,
  id: '11111111-1111-4111-8111-111111111111',
  label: 'Notes',
  adapter: { id: 'generic.mcp', version: 1 },
  runtime_name: 'notes',
  credentials: [],
  transport: { kind: 'mcp_stdio', command: 'notes-helper', args: [], environment: {} },
  created_at: '2026-07-19T18:00:00.000Z',
  updated_at: '2026-07-19T18:00:00.000Z',
};

describe('connection-resolving executor', () => {
  it('does not read the profile store for agents without saved bindings', async () => {
    const list = vi.fn().mockResolvedValue([profile]);
    const execute = vi.fn().mockResolvedValue(makeExecutionResult());
    const executor = createConnectionResolvingExecutor({ list }, () => execute);
    const reporter = {
      start: vi.fn(), progress: vi.fn(), complete: vi.fn(), fail: vi.fn(), stop: vi.fn(),
    };
    const unbound = makeAgent();

    await executor(unbound, reporter);

    expect(list).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(unbound, reporter, undefined);
  });

  it('loads profiles for each run and sends the resolved transport to the selected executor', async () => {
    const list = vi.fn().mockResolvedValue([profile]);
    const execute = vi.fn().mockResolvedValue(makeExecutionResult());
    const resolveExecutor = vi.fn().mockReturnValue(execute);
    const executor = createConnectionResolvingExecutor({ list }, resolveExecutor);
    const reporter = {
      start: vi.fn(), progress: vi.fn(), complete: vi.fn(), fail: vi.fn(), stop: vi.fn(),
    };
    const agent = makeAgent({
      connection_bindings: { notes: profile.id },
      mcp_servers: { notes: { command: 'stale-inline-helper' } },
    });

    await executor(agent, reporter);
    await executor(agent, reporter);

    expect(list).toHaveBeenCalledTimes(2);
    expect(resolveExecutor).toHaveBeenCalledWith(expect.objectContaining({
      mcp_servers: { notes: { command: 'notes-helper', args: [], env: {} } },
    }));
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      mcp_servers: { notes: { command: 'notes-helper', args: [], env: {} } },
    }), reporter, undefined);
  });
});
