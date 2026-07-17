import { describe, it, expect, vi } from 'vitest';
import { ConnectionCache } from './cache.js';
import type { McpServerInfo } from '../execution/executor.js';

const servers = (...names: string[]): McpServerInfo[] =>
  names.map((name) => ({ name, status: 'connected' }));

describe('ConnectionCache', () => {
  it('starts empty and never-probed', () => {
    const cache = new ConnectionCache(async () => servers('eventkit'));
    const state = cache.get();
    expect(state.servers).toEqual([]);
    expect(state.discovered_at).toBeNull();
  });

  it('populates from a refresh and stamps discovered_at', async () => {
    const cache = new ConnectionCache(async () => servers('claude.ai Slack'), {
      now: () => '2026-07-18T00:00:00.000Z',
    });
    const state = await cache.refresh();
    expect(state.servers.map((s) => s.name)).toEqual(['claude.ai Slack']);
    expect(state.discovered_at).toBe('2026-07-18T00:00:00.000Z');
    // The synchronous getter now returns the same cached snapshot.
    expect(cache.get()).toEqual(state);
  });

  it('ensure() probes once, then serves the cache without re-probing', async () => {
    const probe = vi.fn(async () => servers('eventkit'));
    const cache = new ConnectionCache(probe);
    await cache.ensure();
    await cache.ensure();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('refresh() always re-probes even when already populated', async () => {
    const probe = vi
      .fn<() => Promise<McpServerInfo[]>>()
      .mockResolvedValueOnce(servers('a'))
      .mockResolvedValueOnce(servers('a', 'b'));
    const cache = new ConnectionCache(probe);
    await cache.refresh();
    const second = await cache.refresh();
    expect(probe).toHaveBeenCalledTimes(2);
    expect(second.servers.map((s) => s.name)).toEqual(['a', 'b']);
  });

  it('coalesces concurrent refreshes into a single probe', async () => {
    let resolveProbe: (v: McpServerInfo[]) => void = () => {};
    const probe = vi.fn(
      () =>
        new Promise<McpServerInfo[]>((resolve) => {
          resolveProbe = resolve;
        }),
    );
    const cache = new ConnectionCache(probe);
    const a = cache.refresh();
    const b = cache.refresh();
    resolveProbe(servers('eventkit'));
    const [ra, rb] = await Promise.all([a, b]);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(ra).toEqual(rb);
  });

  it('keeps the previous snapshot when a probe throws', async () => {
    const probe = vi
      .fn<() => Promise<McpServerInfo[]>>()
      .mockResolvedValueOnce(servers('eventkit'))
      .mockRejectedValueOnce(new Error('probe failed'));
    const cache = new ConnectionCache(probe);
    await cache.refresh();
    const after = await cache.refresh();
    // The failed refresh degrades to the last good snapshot rather than wiping it.
    expect(after.servers.map((s) => s.name)).toEqual(['eventkit']);
  });
});
