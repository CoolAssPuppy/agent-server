import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CronExpressionParser } from 'cron-parser';
import {
  buildAgentSyncPayload,
  syncAgentSchedule,
  ScheduleSync,
  type WatchDirectory,
} from './sync-schedule.js';
import { makeAgent } from '../test-factories.js';

function createTempDir(label = 'sync-schedule'): string {
  const dir = join(tmpdir(), `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createMockFetch(response: { ok: boolean; status: number; body?: unknown } = { ok: true, status: 200, body: { ok: true } }) {
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status,
    json: async () => response.body,
  });
}

function createWatchHarness(): {
  watchDirectory: WatchDirectory;
  emit: (filename: string) => void;
  close: ReturnType<typeof vi.fn>;
} {
  let onChange: ((filename: string | Buffer | null) => void) | undefined;
  const close = vi.fn();
  return {
    watchDirectory: (_path, listener) => {
      onChange = listener;
      return { close, onError: () => {} };
    },
    emit: (filename) => onChange?.(filename),
    close,
  };
}

describe('buildAgentSyncPayload', () => {
  it('builds payload for scheduled, watch-only, and on-demand agents while excluding disabled agents', () => {
    const now = new Date('2026-04-14T10:00:00Z');
    const agents = [
      makeAgent({
        id: 'scheduled',
        name: 'Scheduled Agent',
        description: 'Runs on a cron.',
        schedule: '0 9 * * *',
        timezone: 'UTC',
      }),
      makeAgent({
        id: 'watch-only',
        name: 'Watch-Only Agent',
        description: 'Triggered by a file change.',
        schedule: undefined,
        timezone: undefined,
        watch: [{ path: '/tmp/manuscript.docx' }],
      }),
      makeAgent({
        id: 'on-demand',
        name: 'On-Demand Agent',
        description: 'Triggered manually.',
        schedule: undefined,
        timezone: undefined,
      }),
      makeAgent({ id: 'disabled', enabled: false, schedule: undefined }),
    ];

    const payload = buildAgentSyncPayload(agents, now);

    expect(payload.agents).toHaveLength(3);
    expect(payload.agents[0]).toMatchObject({
      slug: 'scheduled',
      name: 'Scheduled Agent',
      cron_expression: '0 9 * * *',
      timezone: 'UTC',
    });
    expect(typeof payload.agents[0].next_run_at).toBe('string');
    expect(payload.agents[1]).toMatchObject({
      slug: 'watch-only',
      name: 'Watch-Only Agent',
    });
    expect(payload.agents[1].cron_expression).toBeUndefined();
    expect(payload.agents[1].next_run_at).toBeUndefined();
    expect(payload.agents[2]).toMatchObject({
      slug: 'on-demand',
      name: 'On-Demand Agent',
    });
    expect(payload.agents[2].cron_expression).toBeUndefined();
    expect(payload.agents[2].next_run_at).toBeUndefined();
    expect(payload.agents.map((agent) => agent.slug)).not.toContain('disabled');
  });

  it('never projects descriptions or instructions into legacy Panel sync', () => {
    const payload = buildAgentSyncPayload([
      makeAgent({
        id: 'private-assistant',
        description: 'Private customer description',
        prompt: 'Read /Users/private/customer-notes.md and publish the result.',
      }),
    ], new Date('2026-04-14T10:00:00Z'));

    expect(payload.agents[0]).not.toHaveProperty('description');
    expect(JSON.stringify(payload)).not.toContain('Private customer');
    expect(JSON.stringify(payload)).not.toContain('/Users/private');
  });

  it('computes next_run_at correctly for cron + timezone', () => {
    const now = new Date('2026-04-14T10:00:00Z');
    const agent = makeAgent({
      id: 'daily',
      schedule: '30 14 * * *',
      timezone: 'America/Los_Angeles',
    });

    const payload = buildAgentSyncPayload([agent], now);
    const expectedNext = CronExpressionParser.parse('30 14 * * *', {
      currentDate: now,
      tz: 'America/Los_Angeles',
    }).next().toDate().toISOString();

    expect(payload.agents[0].next_run_at).toBe(expectedNext);
  });

  it('skips disabled agents', () => {
    const agents = [
      makeAgent({ id: 'on' }),
      makeAgent({ id: 'off', enabled: false }),
    ];
    const payload = buildAgentSyncPayload(agents, new Date());
    expect(payload.agents.map((a) => a.slug)).toEqual(['on']);
  });

  it('omits next_run_at when cron is invalid rather than throwing', () => {
    const agent = makeAgent({ id: 'bad-cron', schedule: 'not a cron' });
    const payload = buildAgentSyncPayload([agent], new Date());
    expect(payload.agents[0].next_run_at).toBeUndefined();
    expect(payload.agents[0].cron_expression).toBe('not a cron');
  });
});

describe('syncAgentSchedule', () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeAgent(filename: string, content: string): void {
    writeFileSync(join(dir, filename), content, 'utf-8');
  }

  it('POSTs the expected payload with bearer auth', async () => {
    writeAgent('a.yaml', [
      'id: news',
      'name: News',
      'description: Daily news digest.',
      'schedule: "0 9 * * *"',
      'timezone: UTC',
      'prompt: Do news.',
    ].join('\n'));

    const fetchFn = createMockFetch();
    const result = await syncAgentSchedule({
      agentsDir: dir,
      panelUrl: 'https://panel.example.com',
      panelApiKey: 'test-key',
      fetch: fetchFn,
    });

    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, options] = fetchFn.mock.calls[0];
    expect(url).toBe('https://panel.example.com/api/agents/sync');
    expect(options.method).toBe('POST');
    expect(options.headers['Authorization']).toBe('Bearer test-key');
    expect(options.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(options.body);
    expect(body.agents[0]).toMatchObject({
      slug: 'news',
      name: 'News',
      cron_expression: '0 9 * * *',
      timezone: 'UTC',
    });
    expect(typeof body.agents[0].next_run_at).toBe('string');
  });

  it('returns ok=false when server responds non-2xx without throwing', async () => {
    writeAgent('a.yaml', 'id: x\nname: X\nprompt: p\n');
    const fetchFn = createMockFetch({ ok: false, status: 500, body: { error: 'boom' } });

    const result = await syncAgentSchedule({
      agentsDir: dir,
      panelUrl: 'https://panel.example.com',
      panelApiKey: 'test-key',
      fetch: fetchFn,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  it('returns ok=false when fetch throws, without crashing', async () => {
    writeAgent('a.yaml', 'id: x\nname: X\nprompt: p\n');
    const fetchFn = vi.fn().mockRejectedValue(new Error('network down'));

    const result = await syncAgentSchedule({
      agentsDir: dir,
      panelUrl: 'https://panel.example.com',
      panelApiKey: 'test-key',
      fetch: fetchFn,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('network down');
  });

  it('bounds a Panel request that never settles and aborts it at the deadline', async () => {
    writeAgent('a.yaml', 'id: x\nname: X\nprompt: p\n');
    let requestSignal: AbortSignal | undefined;
    const fetchFn = vi.fn<typeof fetch>((_input, init) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });

    const result = await syncAgentSchedule({
      agentsDir: dir,
      panelUrl: 'https://panel.example.com',
      panelApiKey: 'test-key',
      fetch: fetchFn,
      requestTimeoutMs: 25,
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('timed out'),
    });
    expect(requestSignal?.aborted).toBe(true);
  });

  it('does not extract private instructions from a markdown body', async () => {
    writeAgent('doc.md', [
      '---',
      'id: doc',
      'name: Doc Agent',
      'schedule: "0 9 * * *"',
      '---',
      '',
      'This is the first paragraph of the agent body.',
      '',
      'Second paragraph details.',
    ].join('\n'));

    const fetchFn = createMockFetch();
    await syncAgentSchedule({
      agentsDir: dir,
      panelUrl: 'https://panel.example.com',
      panelApiKey: 'test-key',
      fetch: fetchFn,
    });

    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.agents[0].description).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('first paragraph');
  });
});

describe('ScheduleSync', () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempDir('sync-sync');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeAgent(filename: string, content: string): void {
    writeFileSync(join(dir, filename), content, 'utf-8');
  }

  it('fires sync on startup', async () => {
    writeAgent('a.yaml', 'id: x\nname: X\nprompt: p\n');
    const fetchFn = createMockFetch();
    const watcher = createWatchHarness();

    const sync = new ScheduleSync({
      agentsDir: dir,
      panelUrl: 'https://panel.example.com',
      panelApiKey: 'test-key',
      fetch: fetchFn,
      watchDirectory: watcher.watchDirectory,
      fileChangeDebounceMs: 10,
      hourlyIntervalMs: 3_600_000,
    });

    await sync.start();
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
    sync.stop();

    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('fires sync on agent file change, debounced', async () => {
    writeAgent('a.yaml', 'id: x\nname: X\nprompt: p\n');
    const fetchFn = createMockFetch();
    const watcher = createWatchHarness();

    const sync = new ScheduleSync({
      agentsDir: dir,
      panelUrl: 'https://panel.example.com',
      panelApiKey: 'test-key',
      fetch: fetchFn,
      watchDirectory: watcher.watchDirectory,
      fileChangeDebounceMs: 50,
      hourlyIntervalMs: 3_600_000,
    });

    await sync.start();
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());

    watcher.emit('a.yaml');
    watcher.emit('a.yaml');
    writeAgent('b.yaml', 'id: y\nname: Y\nprompt: q\n');
    watcher.emit('b.yaml');

    await vi.waitFor(
      () => expect(fetchFn.mock.calls.length).toBeGreaterThanOrEqual(2),
      { timeout: 1_000 },
    );

    sync.stop();

    expect(fetchFn.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('observes agent changes while the startup sync is still pending', async () => {
    writeAgent('a.yaml', 'id: x\nname: X\nprompt: p\n');
    const watcher = createWatchHarness();
    let finishStartup: ((response: Response) => void) | undefined;
    const fetchFn = vi.fn<typeof fetch>(() => {
      if (fetchFn.mock.calls.length === 1) {
        return new Promise<Response>((resolve) => {
          finishStartup = resolve;
        });
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    const sync = new ScheduleSync({
      agentsDir: dir,
      panelUrl: 'https://panel.example.com',
      panelApiKey: 'test-key',
      fetch: fetchFn,
      watchDirectory: watcher.watchDirectory,
      fileChangeDebounceMs: 25,
      hourlyIntervalMs: 3_600_000,
    });

    const startup = sync.start();
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
    watcher.emit('a.yaml');

    await vi.waitFor(
      () => expect(fetchFn.mock.calls.length).toBeGreaterThanOrEqual(2),
      { timeout: 1_000 },
    );
    finishStartup?.(new Response('{}', { status: 200 }));
    await startup;
    sync.stop();
  });

  it('finishes startup while the initial Panel sync is still pending', async () => {
    writeAgent('a.yaml', 'id: x\nname: X\nprompt: p\n');
    const watcher = createWatchHarness();
    let finishFetch: ((response: Response) => void) | undefined;
    const fetchFn = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => {
      finishFetch = resolve;
    }));
    const sync = new ScheduleSync({
      agentsDir: dir,
      panelUrl: 'https://panel.example.com',
      panelApiKey: 'test-key',
      fetch: fetchFn,
      watchDirectory: watcher.watchDirectory,
      fileChangeDebounceMs: 10,
      hourlyIntervalMs: 3_600_000,
    });

    const startup = sync.start();
    try {
      await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
      const outcome = await Promise.race([
        startup.then(() => 'started' as const),
        new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 50)),
      ]);

      expect(outcome).toBe('started');
    } finally {
      finishFetch?.(new Response('{}', { status: 200 }));
      await startup;
      sync.stop();
    }
  });

  it('does not install timers or watchers after stop wins a pending startup', async () => {
    writeAgent('a.yaml', 'id: x\nname: X\nprompt: p\n');
    const watcher = createWatchHarness();
    let finishFetch: ((response: Response) => void) | undefined;
    const fetchFn = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => {
      finishFetch = resolve;
    }));
    const sync = new ScheduleSync({
      agentsDir: dir,
      panelUrl: 'https://panel.example.com',
      panelApiKey: 'test-key',
      fetch: fetchFn,
      watchDirectory: watcher.watchDirectory,
      fileChangeDebounceMs: 10,
      hourlyIntervalMs: 10,
    });

    const startup = sync.start();
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
    sync.stop();
    finishFetch?.(new Response('{}', { status: 200 }));
    await startup;

    await new Promise((resolve) => setTimeout(resolve, 40));
    sync.stop();

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(watcher.close).toHaveBeenCalledOnce();
  });
});
