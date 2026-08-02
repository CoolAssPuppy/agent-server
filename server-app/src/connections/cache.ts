import type { McpServerInfo } from '../execution/executor.js';

/**
 * A snapshot of what the Claude runtime could reach the last time we probed.
 * `discovered_at` is null until the first successful probe.
 */
export type ConnectionSnapshot = {
  servers: McpServerInfo[];
  discovered_at: string | null;
  probe_failed: boolean;
};

type ProbeFn = () => Promise<McpServerInfo[]>;

/**
 * App-wide cache of the MCP discovery probe result. The probe (see
 * `probeMcpServers`) costs an MCP connection, so we run it on demand and hold
 * the result rather than probing on every capability read.
 *
 * This is a REGENERABLE CACHE, never a source of truth: the account connectors
 * it lists live in the user's claude.ai account, not in any file Agent Server
 * owns. `refresh()` re-probes (the "Refresh connections" action); `ensure()`
 * probes once lazily; `get()` is a synchronous read for the request path.
 *
 * A failed probe degrades to the last good snapshot instead of wiping it, so a
 * transient runtime hiccup never blanks the user's connection list.
 */
export class ConnectionCache {
  private snapshot: ConnectionSnapshot = {
    servers: [],
    discovered_at: null,
    probe_failed: false,
  };
  private inflight: Promise<ConnectionSnapshot> | null = null;
  private readonly now: () => string;

  constructor(
    private readonly probe: ProbeFn,
    options?: { now?: () => string },
  ) {
    this.now = options?.now ?? (() => new Date().toISOString());
  }

  /** Synchronous read of the current snapshot. Empty until first probe. */
  get(): ConnectionSnapshot {
    return this.snapshot;
  }

  /** The discovered servers alone, for callers that only need the list. */
  servers(): McpServerInfo[] {
    return this.snapshot.servers;
  }

  /** Force a fresh probe. Concurrent callers share one in-flight probe. */
  refresh(): Promise<ConnectionSnapshot> {
    if (this.inflight) return this.inflight;
    this.inflight = this.runProbe();
    return this.inflight;
  }

  /** Probe once if never probed; otherwise serve the cache. */
  ensure(): Promise<ConnectionSnapshot> {
    if (this.snapshot.discovered_at !== null) return Promise.resolve(this.snapshot);
    return this.refresh();
  }

  private async runProbe(): Promise<ConnectionSnapshot> {
    try {
      const probed = await this.probe();
      const latestByName = new Map(probed.map((server) => [server.name, server]));
      const knownNames = new Set(this.snapshot.servers.map(({ name }) => name));
      const servers = this.snapshot.servers.map((server) => latestByName.get(server.name) ?? server);
      servers.push(...probed.filter(({ name }) => !knownNames.has(name)));
      this.snapshot = { servers, discovered_at: this.now(), probe_failed: false };
    } catch {
      // Keep the last good snapshot; a transient failure must not blank it.
      this.snapshot = { ...this.snapshot, probe_failed: true };
    } finally {
      this.inflight = null;
    }
    return this.snapshot;
  }
}
