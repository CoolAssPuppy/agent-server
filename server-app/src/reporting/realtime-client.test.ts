import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  RealtimeClient,
  type RunTriggerEvent,
  type DecisionResolvedEvent,
} from './realtime-client.js';

/**
 * Behaviour tests for the direct Supabase Realtime client. The transport is
 * faked at two seams: `fetch` (the panel token endpoint) and `createClient`
 * (the Supabase client — channels, subscribe callbacks, and REST query
 * builder). We assert the observable contract the rest of the daemon depends
 * on: exact `run_trigger` / `decision_resolved` payloads, catch-up + live-race
 * dedup, slug resolution, token refresh, and teardown.
 */

type PostgresHandler = (payload: { new: unknown; old?: unknown }) => void;

type QueuedRow = Record<string, unknown>;

// A minimal stand-in for the supabase-js query builder. Every filter method
// returns `this`; the terminal methods resolve to the seeded rows for the table.
class FakeQuery {
  constructor(
    private readonly table: string,
    private readonly rows: Record<string, QueuedRow[]>,
  ) {}

  select(): this {
    return this;
  }
  eq(): this {
    return this;
  }
  gt(): this {
    return this;
  }
  order(): Promise<{ data: QueuedRow[]; error: null }> {
    return Promise.resolve({ data: this.rows[this.table] ?? [], error: null });
  }
  async maybeSingle(): Promise<{ data: QueuedRow | null; error: null }> {
    const row = (this.rows[this.table] ?? [])[0] ?? null;
    return { data: row, error: null };
  }
}

class FakeChannel {
  handlers: { config: Record<string, unknown>; handler: PostgresHandler }[] = [];
  statusCallback: ((status: string) => void) | undefined;

  constructor(readonly name: string) {}

  on(_event: string, config: Record<string, unknown>, handler: PostgresHandler): this {
    this.handlers.push({ config, handler });
    return this;
  }

  subscribe(cb?: (status: string) => void): this {
    this.statusCallback = cb;
    return this;
  }

  fire(payload: { new: unknown; old?: unknown }): void {
    for (const { handler } of this.handlers) handler(payload);
  }
}

type FakeSupabase = {
  channel: (name: string) => FakeChannel;
  from: (table: string) => FakeQuery;
  realtime: { setAuth: (token: string) => void };
  removeAllChannels: () => Promise<'ok'[]>;
  channels: FakeChannel[];
  setAuthCalls: string[];
};

function createFakeSupabase(rows: Record<string, QueuedRow[]> = {}): FakeSupabase {
  const channels: FakeChannel[] = [];
  const setAuthCalls: string[] = [];
  return {
    channels,
    setAuthCalls,
    channel(name: string) {
      const ch = new FakeChannel(name);
      channels.push(ch);
      return ch;
    },
    from(table: string) {
      return new FakeQuery(table, rows);
    },
    realtime: {
      setAuth(token: string) {
        setAuthCalls.push(token);
      },
    },
    async removeAllChannels() {
      return ['ok'];
    },
  };
}

function tokenResponse(
  overrides: Partial<{
    token: string;
    expires_at: number;
    org_id: string;
    supabase_url: string;
    supabase_publishable_key: string;
  }> = {},
): Response {
  const body = {
    token: 'jwt-token',
    expires_at: Date.now() + 30 * 60 * 1000,
    org_id: 'org-1',
    supabase_url: 'https://db.test',
    supabase_publishable_key: 'sb_publishable',
    ...overrides,
  };
  return new Response(JSON.stringify(body), { status: 200 });
}

function subscribeAll(supabase: FakeSupabase): void {
  for (const ch of supabase.channels) ch.statusCallback?.('SUBSCRIBED');
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('RealtimeClient', () => {
  let tempDirs: string[];

  beforeEach(() => {
    tempDirs = [];
  });

  afterEach(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  function cursorPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'rt-cursor-'));
    tempDirs.push(dir);
    return join(dir, 'cursor');
  }

  function makeClient(opts: {
    supabase: FakeSupabase;
    fetch?: typeof globalThis.fetch;
    cursorPath?: string;
    initialCursor?: number;
    refreshSkewMs?: number;
  }): RealtimeClient {
    const fetchFn =
      opts.fetch ?? (vi.fn(async () => tokenResponse()) as unknown as typeof globalThis.fetch);
    return new RealtimeClient({
      panelUrl: 'https://panel.test',
      panelApiKey: 'ap_live_key',
      cursorPath: opts.cursorPath ?? cursorPath(),
      fetch: fetchFn,
      createClient: (() => opts.supabase) as never,
      initialCursor: opts.initialCursor,
      initialBackoffMs: 5,
      maxBackoffMs: 20,
      refreshSkewMs: opts.refreshSkewMs,
    });
  }

  it('fetches a token, authenticates the realtime socket, and subscribes to both tables', async () => {
    const supabase = createFakeSupabase();
    const fetchFn = vi.fn(async () => tokenResponse({ org_id: 'org-42' }));
    const client = makeClient({ supabase, fetch: fetchFn as unknown as typeof globalThis.fetch });

    await client.start();
    await flush();

    const call = fetchFn.mock.calls[0];
    expect(call[0]).toBe('https://panel.test/api/agent-server/realtime-token');
    expect((call[1] as RequestInit).method).toBe('POST');
    expect(((call[1] as RequestInit).headers as Record<string, string>).Authorization).toBe(
      'Bearer ap_live_key',
    );
    expect(supabase.setAuthCalls[0]).toBe('jwt-token');
    expect(supabase.channels.map((c) => c.name)).toEqual([
      'agent-server-run-triggers-org-42',
      'agent-server-decisions-org-42',
    ]);
    client.stop();
  });

  it('exposes a live INSERTed pending decision via getPendingDecisions', async () => {
    const supabase = createFakeSupabase();
    const client = makeClient({ supabase });

    await client.start();
    await flush();

    const decisionsChannel = supabase.channels[1];
    decisionsChannel.fire({
      new: {
        id: 'dec-1',
        task_run_id: 'run-1',
        agent_slug: 'weekly-report',
        type: 'approve',
        title: 'Ship the release?',
        payload: { approve_label: 'Ship' },
        status: 'pending',
        due_at: null,
        defer_until: null,
        created_at: '2026-07-02T00:00:00.000Z',
      },
    });
    await flush();

    expect(client.getPendingDecisions()).toEqual([
      {
        id: 'dec-1',
        task_run_id: 'run-1',
        agent_slug: 'weekly-report',
        type: 'approve',
        title: 'Ship the release?',
        payload: { approve_label: 'Ship' },
        status: 'pending',
        due_at: null,
        defer_until: null,
        created_at: '2026-07-02T00:00:00.000Z',
      },
    ]);
    client.stop();
  });

  it('drops a decision from pending once it resolves', async () => {
    const supabase = createFakeSupabase();
    const client = makeClient({ supabase });
    const resolved: DecisionResolvedEvent[] = [];
    client.events.on('decision_resolved', (e) => resolved.push(e));

    await client.start();
    await flush();

    const decisionsChannel = supabase.channels[1];
    const base = {
      id: 'dec-2',
      task_run_id: 'run-2',
      agent_slug: 'a',
      type: 'approve',
      title: 't',
      payload: {},
      due_at: null,
      defer_until: null,
      created_at: '2026-07-02T00:00:00.000Z',
    };
    decisionsChannel.fire({ new: { ...base, status: 'pending' } });
    await flush();
    expect(client.getPendingDecisions()).toHaveLength(1);

    decisionsChannel.fire({
      new: {
        ...base,
        status: 'resolved',
        resolved_at: '2026-07-02T01:00:00.000Z',
        resolution: { action_id: 'approve' },
      },
    });
    await flush();

    expect(client.getPendingDecisions()).toHaveLength(0);
    // The resolve transition still emits decision_resolved for run resumption.
    expect(resolved.map((e) => e.decision_id)).toEqual(['dec-2']);
    client.stop();
  });

  it('rebuilds pending decisions from catch-up on subscribe', async () => {
    const supabase = createFakeSupabase({
      decisions: [
        {
          id: 'dec-3',
          task_run_id: 'run-3',
          agent_slug: 'a',
          type: 'answer',
          title: 'Question?',
          payload: { prompt: 'Which?' },
          status: 'pending',
          due_at: null,
          defer_until: null,
          created_at: '2026-07-02T00:00:00.000Z',
        },
      ],
    });
    const client = makeClient({ supabase });

    await client.start();
    await flush();
    subscribeAll(supabase);
    await flush();
    await flush();

    expect(client.getPendingDecisions().map((d) => d.id)).toEqual(['dec-3']);
    client.stop();
  });

  it('builds the Supabase client from coordinates in the token response, not from config', async () => {
    const supabase = createFakeSupabase();
    const createArgs: Array<{ url: string; key: string }> = [];
    const fetchFn = vi.fn(async () =>
      tokenResponse({
        supabase_url: 'https://project-from-token.supabase.co',
        supabase_publishable_key: 'sb_publishable_from_token',
      }),
    );
    // The daemon has NO supabase config of its own; createClient must receive
    // exactly the URL + key the panel returned with the token.
    const client = new RealtimeClient({
      panelUrl: 'https://panel.test',
      panelApiKey: 'ap_live_key',
      cursorPath: cursorPath(),
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      createClient: ((url: string, key: string) => {
        createArgs.push({ url, key });
        return supabase;
      }) as never,
      initialBackoffMs: 5,
      maxBackoffMs: 20,
    });

    await client.start();
    await flush();

    expect(createArgs).toEqual([
      { url: 'https://project-from-token.supabase.co', key: 'sb_publishable_from_token' },
    ]);
    client.stop();
  });

  it('emits a live run_trigger with the exact payload shape after slug resolution', async () => {
    const supabase = createFakeSupabase({ agent_tasks: [{ slug: 'weekly-report' }] });
    const client = makeClient({ supabase });
    const received: RunTriggerEvent[] = [];
    client.events.on('run_trigger', (e) => received.push(e));

    await client.start();
    await flush();

    const triggerChannel = supabase.channels[0];
    triggerChannel.fire({
      new: {
        id: 'trig-1',
        task_id: 'task-1',
        status: 'queued',
        input: { foo: 'bar' },
        created_at: '2026-07-02T00:00:00.000Z',
      },
    });
    await flush();

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      id: new Date('2026-07-02T00:00:00.000Z').getTime(),
      type: 'run_trigger',
      trigger_id: 'trig-1',
      task_slug: 'weekly-report',
      input: { foo: 'bar' },
    });
    client.stop();
  });

  it('ignores run_triggers whose status is not queued', async () => {
    const supabase = createFakeSupabase({ agent_tasks: [{ slug: 's' }] });
    const client = makeClient({ supabase });
    const received: RunTriggerEvent[] = [];
    client.events.on('run_trigger', (e) => received.push(e));

    await client.start();
    await flush();
    supabase.channels[0].fire({
      new: { id: 't', task_id: 'task-1', status: 'acked', created_at: '2026-07-02T00:00:00.000Z' },
    });
    await flush();

    expect(received).toHaveLength(0);
    client.stop();
  });

  it('drops a run_trigger and never emits an empty slug when the task is unknown', async () => {
    const supabase = createFakeSupabase({ agent_tasks: [] });
    const client = makeClient({ supabase });
    const received: RunTriggerEvent[] = [];
    client.events.on('run_trigger', (e) => received.push(e));

    await client.start();
    await flush();
    supabase.channels[0].fire({
      new: { id: 't', task_id: 'ghost', status: 'queued', created_at: '2026-07-02T00:00:00.000Z' },
    });
    await flush();

    expect(received).toHaveLength(0);
    client.stop();
  });

  it('emits decision_resolved only on the queued -> resolved transition', async () => {
    const supabase = createFakeSupabase();
    const client = makeClient({ supabase });
    const received: DecisionResolvedEvent[] = [];
    client.events.on('decision_resolved', (e) => received.push(e));

    await client.start();
    await flush();
    const decisionChannel = supabase.channels[1];

    // Already-resolved -> resolved: no-op.
    decisionChannel.fire({
      new: {
        id: 'd1',
        task_run_id: 'run-1',
        status: 'resolved',
        resolved_at: '2026-07-02T01:00:00.000Z',
        resolution: { action_id: 'approve' },
      },
      old: { status: 'resolved' },
    });
    // Genuine transition.
    decisionChannel.fire({
      new: {
        id: 'd2',
        task_run_id: 'run-2',
        status: 'resolved',
        resolved_at: '2026-07-02T02:00:00.000Z',
        resolution: { action_id: 'pick', input: 'B' },
      },
      old: { status: 'pending' },
    });
    await flush();

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      id: new Date('2026-07-02T02:00:00.000Z').getTime(),
      type: 'decision_resolved',
      decision_id: 'd2',
      task_run_id: 'run-2',
      resolution: { action_id: 'pick', input: 'B' },
    });
    client.stop();
  });

  it('runs REST catch-up on SUBSCRIBED and dedups against the live event', async () => {
    const created = '2026-07-02T03:00:00.000Z';
    const supabase = createFakeSupabase({
      run_triggers: [
        { id: 'trig-9', task_id: 'task-9', input: null, created_at: created, agent_tasks: { slug: 'catchup-slug' } },
      ],
      agent_tasks: [{ slug: 'catchup-slug' }],
    });
    const client = makeClient({ supabase });
    const received: RunTriggerEvent[] = [];
    client.events.on('run_trigger', (e) => received.push(e));

    await client.start();
    await flush();

    // Both channels fire SUBSCRIBED (as at startup) -> catch-up coalesces to one pass.
    subscribeAll(supabase);
    await flush();

    // The same trigger also arrives live; dedup by trigger_id must suppress it.
    supabase.channels[0].fire({
      new: { id: 'trig-9', task_id: 'task-9', status: 'queued', input: null, created_at: created },
    });
    await flush();

    expect(received).toHaveLength(1);
    expect(received[0].trigger_id).toBe('trig-9');
    expect(received[0].task_slug).toBe('catchup-slug');
    client.stop();
  });

  it('persists the cursor and advances it monotonically', async () => {
    const path = cursorPath();
    const supabase = createFakeSupabase({ agent_tasks: [{ slug: 's' }] });
    const client = makeClient({ supabase, cursorPath: path });
    await client.start();
    await flush();

    const laterTs = '2026-07-02T05:00:00.000Z';
    const earlierTs = '2026-07-02T04:00:00.000Z';
    supabase.channels[0].fire({
      new: { id: 'a', task_id: 'task-1', status: 'queued', created_at: laterTs },
    });
    await flush();
    supabase.channels[0].fire({
      new: { id: 'b', task_id: 'task-1', status: 'queued', created_at: earlierTs },
    });
    await flush();

    expect(existsSync(path)).toBe(true);
    // An out-of-order (earlier) row must not rewind the persisted cursor.
    expect(readFileSync(path, 'utf-8').trim()).toBe(String(new Date(laterTs).getTime()));
    expect(client.getCursor()).toBe(new Date(laterTs).getTime());
    client.stop();
  });

  it('loads the persisted cursor from disk on construction', async () => {
    const path = cursorPath();
    writeFileSync(path, '12345', 'utf-8');
    const supabase = createFakeSupabase();
    const client = makeClient({ supabase, cursorPath: path });
    expect(client.getCursor()).toBe(12345);
    client.stop();
  });

  it('refreshes the token ahead of expiry and re-authenticates the socket', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    try {
      const supabase = createFakeSupabase();
      // Token id tracks the call count so we can prove the second one lands.
      const fetchFn = vi.fn(async () =>
        tokenResponse({
          token: `jwt-${fetchFn.mock.calls.length}`,
          expires_at: Date.now() + 20 * 60 * 1000,
        }),
      );
      const client = makeClient({
        supabase,
        fetch: fetchFn as unknown as typeof globalThis.fetch,
        refreshSkewMs: 5 * 60 * 1000,
      });

      await client.start();
      await vi.advanceTimersByTimeAsync(0); // flush the initial connect
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(supabase.setAuthCalls).toEqual(['jwt-1']);

      // 20m TTL - 5m skew => refresh fires at 15m.
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000 + 10);
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(supabase.setAuthCalls[1]).toBe('jwt-2');
      client.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps booting when the initial token fetch fails, then recovers', async () => {
    const supabase = createFakeSupabase();
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new Error('panel down');
      return tokenResponse();
    });
    const client = makeClient({ supabase, fetch: fetchFn as unknown as typeof globalThis.fetch });

    await client.start();
    // Let the backoff (5ms) elapse and the retry succeed.
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(fetchFn.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(supabase.channels.length).toBe(2);
    client.stop();
  });

  it('tears down channels on stop()', async () => {
    const supabase = createFakeSupabase();
    const removeSpy = vi.spyOn(supabase, 'removeAllChannels');
    const client = makeClient({ supabase });
    await client.start();
    await flush();
    client.stop();
    expect(removeSpy).toHaveBeenCalled();
  });
});
