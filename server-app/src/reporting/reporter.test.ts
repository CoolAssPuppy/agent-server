import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { TelemetryReporter, type StatusEvent } from './reporter.js';

function createMockFetch() {
  return vi.fn().mockResolvedValue({ ok: true, status: 200 });
}

// Tests can schedule deferred retries that outlive the test. If we don't
// isolate the pending-terminals dir, those retries eventually write real
// files into `~/.agent-server/pending-terminals/` on the developer's Mac.
let testPendingDir = '';

function makeReporter(overrides: {
  runId?: string;
  fetch?: typeof fetch;
  heartbeatMs?: number;
  progressMode?: 'live' | 'batched';
  progressSampleMs?: number;
  requestTimeoutMs?: number;
} = {}) {
  const runId = overrides.runId ?? 'run-123';
  return new TelemetryReporter({
    runId,
    agentName: 'Test Agent',
    endpoint: `https://panel.example.com/api/runs/${runId}/status`,
    apiKey: 'ap_live_test',
    fetch: overrides.fetch ?? createMockFetch(),
    heartbeatMs: overrides.heartbeatMs ?? 0,
    progressMode: overrides.progressMode,
    progressSampleMs: overrides.progressSampleMs,
    requestTimeoutMs: overrides.requestTimeoutMs,
    pendingTerminalsDir: testPendingDir,
  });
}

describe('TelemetryReporter', () => {
  beforeAll(() => {
    testPendingDir = mkdtempSync(join(tmpdir(), 'reporter-test-pending-'));
  });

  afterAll(() => {
    rmSync(testPendingDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a working event on start', async () => {
    const mockFetch = createMockFetch();
    const reporter = makeReporter({ fetch: mockFetch });

    await reporter.start();
    reporter.stop();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://panel.example.com/api/runs/run-123/status');
    const body = JSON.parse(options.body) as StatusEvent;
    expect(body.state).toBe('working');
    expect(body.agent).toBe('Test Agent');
  });

  it('bounds a panel request that never settles', async () => {
    const mockFetch = vi.fn(() => new Promise<Response>(() => {}));
    const reporter = makeReporter({ fetch: mockFetch as typeof fetch, requestTimeoutMs: 100 });

    const startPromise = reporter.start();
    await vi.advanceTimersByTimeAsync(100);
    await expect(startPromise).resolves.toBeUndefined();

    const options = mockFetch.mock.calls[0]?.[1];
    expect(options?.signal?.aborted).toBe(true);
  });

  it('does not wait for a hanging Panel request before startup completes', async () => {
    vi.useRealTimers();
    let releaseRequest: ((response: Response) => void) | undefined;
    const mockFetch = vi.fn(() => new Promise<Response>((resolve) => {
      releaseRequest = resolve;
    }));
    const reporter = makeReporter({ fetch: mockFetch as typeof fetch });

    const startup = reporter.start();
    try {
      const outcome = await Promise.race([
        startup.then(() => 'started' as const),
        new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 50)),
      ]);

      expect(outcome).toBe('started');
      expect(mockFetch).toHaveBeenCalledOnce();
    } finally {
      releaseRequest?.(new Response('{}', { status: 200 }));
      await startup;
      reporter.stop();
    }
  });

  it('sends a schema-compatible operational completion', async () => {
    const mockFetch = createMockFetch();
    const reporter = makeReporter({ fetch: mockFetch });

    await reporter.start();
    await reporter.complete({
      summary: 'Created report',
      output: {},
      usage: { turns: 5, files_read: 3, files_written: 1, commands_run: 2 },
      turnCount: 5,
      toolsUsed: ['Read', 'Write', 'Bash'],
      filesRead: ['/a.ts', '/b.ts', '/c.ts'],
      filesWritten: ['/output.md'],
      commandsRun: ['npm test', 'npm run build'],
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const body = JSON.parse(mockFetch.mock.calls[1][1].body) as StatusEvent;
    expect(body.state).toBe('completed');
    expect(body.result?.summary).toBe('Run completed.');
    expect(body.result?.accomplishments).toEqual(['Run completed.']);
    expect(body.result?.usage).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      estimated_cost_usd: 0,
    });
    expect(body.result?.model).toBe('not_shared');
    expect(body.result?.accomplishments?.length ?? 0).toBeGreaterThan(0);
    expect(body.result?.output).toBeUndefined();
  });

  it('redacts secrets from every terminal result string', async () => {
    const mockFetch = createMockFetch();
    const reporter = makeReporter({ fetch: mockFetch });

    await reporter.start();
    await reporter.complete({
      summary: 'Authorization: Bearer hidden-summary-token',
      output: {},
      usage: {},
      turnCount: 1,
      toolsUsed: ['tool token=hidden-tool-token'],
      filesRead: ['/tmp/password=hidden-read-secret'],
      filesWritten: ['/tmp/token=hidden-write-secret'],
      commandsRun: ['curl -H "Authorization: Bearer hidden-command-token"'],
    });

    const bodyText = String(mockFetch.mock.calls[1][1].body);
    expect(bodyText).not.toContain('[REDACTED]');
    expect(bodyText).not.toContain('hidden-summary-token');
    expect(bodyText).not.toContain('hidden-tool-token');
    expect(bodyText).not.toContain('hidden-read-secret');
    expect(bodyText).not.toContain('hidden-write-secret');
    expect(bodyText).not.toContain('hidden-command-token');
  });

  it('defaults to an operational allowlist without local result content', async () => {
    const mockFetch = createMockFetch();
    const reporter = makeReporter({ fetch: mockFetch });

    await reporter.progress('Reading /Users/private/customer-notes.md', {
      turns_completed: 2,
      tools_used: ['Read', 'mcp__notion__search'],
      customer: 'Private customer name',
    });
    await reporter.complete({
      summary: 'Private customer summary',
      output: { document: 'Private document body' },
      usage: { input_tokens: 400, output_tokens: 200, estimated_cost_usd: 1.25 },
      turnCount: 2,
      toolsUsed: ['Read', 'mcp__notion__search'],
      filesRead: ['/Users/private/customer-notes.md'],
      filesWritten: ['/Users/private/report.md'],
      commandsRun: ['publish --customer private'],
      model: 'private-model-name',
    });

    const payloads = mockFetch.mock.calls.map((call) => String(call[1].body)).join('\n');
    expect(payloads).not.toContain('Private customer');
    expect(payloads).not.toContain('/Users/private');
    expect(payloads).not.toContain('mcp__notion');
    expect(payloads).not.toContain('publish --customer');
    expect(payloads).not.toContain('private-model-name');

    const terminal = JSON.parse(mockFetch.mock.calls.at(-1)?.[1].body) as StatusEvent;
    expect(terminal.result).toEqual({
      summary: 'Run completed.',
      accomplishments: ['Run completed.'],
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0,
      },
      model: 'not_shared',
    });
  });

  it('sends a failed event on error', async () => {
    const mockFetch = createMockFetch();
    const reporter = makeReporter({ fetch: mockFetch });

    await reporter.start();
    await reporter.fail(new Error('Something broke'));

    const body = JSON.parse(mockFetch.mock.calls[1][1].body) as StatusEvent;
    expect(body.state).toBe('failed');
    expect(body.error?.message).toBe('Run failed.');
  });

  it('sends a stable machine-readable failure code', async () => {
    const mockFetch = createMockFetch();
    const reporter = makeReporter({ fetch: mockFetch });
    const error = Object.assign(new Error('The required result was not created.'), {
      code: 'output_contract_unmet',
    });

    await reporter.start();
    await reporter.fail(error);

    const body = JSON.parse(mockFetch.mock.calls[1][1].body) as StatusEvent;
    expect(body.error).toEqual({
      message: 'Run failed.',
      code: 'output_contract_unmet',
    });
  });

  it('sends progress state without local message or metadata', async () => {
    const mockFetch = createMockFetch();
    const reporter = makeReporter({ fetch: mockFetch });

    await reporter.start();
    await reporter.progress('Processing items', {
      turns_completed: 5,
      tools_used: ['web_search'],
    });

    const body = JSON.parse(mockFetch.mock.calls[1][1].body) as StatusEvent;
    expect(body.state).toBe('working');
    expect(body.message).toBeUndefined();
    expect(body.metadata).toBeUndefined();
  });

  it('throttles high-frequency progress updates in live mode', async () => {
    const mockFetch = createMockFetch();
    const reporter = makeReporter({ fetch: mockFetch, progressSampleMs: 10_000 });

    await reporter.start();
    await reporter.progress('step 1');
    await reporter.progress('step 2');
    await reporter.progress('step 3');

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const body = JSON.parse(mockFetch.mock.calls[1][1].body) as StatusEvent;
    expect(body.message).toBeUndefined();
  });

  it('does not place batched local progress into the terminal payload', async () => {
    const mockFetch = createMockFetch();
    const reporter = makeReporter({ fetch: mockFetch, progressMode: 'batched' });

    await reporter.start();
    await reporter.progress('step 1', { turns_completed: 1, tools_used: ['Read'] });
    await reporter.progress('step 2', { turns_completed: 2, tools_used: ['Write'] });
    await reporter.complete({
      summary: 'done',
      output: {},
      usage: {},
      turnCount: 2,
      toolsUsed: ['Read', 'Write'],
      filesRead: [],
      filesWritten: [],
      commandsRun: [],
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const body = JSON.parse(mockFetch.mock.calls[1][1].body) as StatusEvent;
    expect(body.result?.output).toBeUndefined();
  });

  it('includes authorization header', async () => {
    const mockFetch = createMockFetch();
    const reporter = makeReporter({ fetch: mockFetch });

    await reporter.start();
    reporter.stop();

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['Authorization']).toBe('Bearer ap_live_test');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('includes ISO timestamp in events', async () => {
    const mockFetch = createMockFetch();
    const reporter = makeReporter({ fetch: mockFetch });

    await reporter.start();
    reporter.stop();

    const body = JSON.parse(mockFetch.mock.calls[0][1].body) as StatusEvent;
    expect(body.timestamp).toBeDefined();
    expect(() => new Date(body.timestamp!)).not.toThrow();
  });

  it('includes worker_id in metadata when serverId is set', async () => {
    const mockFetch = createMockFetch();
    const reporter = new TelemetryReporter({
      runId: 'run-123',
      agentName: 'Test Agent',
      endpoint: 'https://panel.example.com/api/runs/run-123/status',
      apiKey: 'ap_live_test',
      fetch: mockFetch,
      heartbeatMs: 0,
      serverId: 'myhost-1234',
    });

    await reporter.start();
    reporter.stop();

    const body = JSON.parse(mockFetch.mock.calls[0][1].body) as StatusEvent;
    expect(body.metadata?.worker_id).toBe('myhost-1234');
  });

  it('includes conversation_id in metadata when conversationId is set', async () => {
    const mockFetch = createMockFetch();
    const reporter = new TelemetryReporter({
      runId: 'run-123',
      agentName: 'Test Agent',
      endpoint: 'https://panel.example.com/api/runs/run-123/status',
      apiKey: 'ap_live_test',
      fetch: mockFetch,
      heartbeatMs: 0,
      conversationId: 'conv-abc-123',
    });

    await reporter.start();
    reporter.stop();

    const body = JSON.parse(mockFetch.mock.calls[0][1].body) as StatusEvent;
    expect(body.metadata?.conversation_id).toBe('conv-abc-123');
  });

  it('includes both worker_id and conversation_id in metadata when both are set', async () => {
    const mockFetch = createMockFetch();
    const reporter = new TelemetryReporter({
      runId: 'run-123',
      agentName: 'Test Agent',
      endpoint: 'https://panel.example.com/api/runs/run-123/status',
      apiKey: 'ap_live_test',
      fetch: mockFetch,
      heartbeatMs: 0,
      serverId: 'myhost-1234',
      conversationId: 'conv-abc-123',
    });

    await reporter.start();
    reporter.stop();

    const body = JSON.parse(mockFetch.mock.calls[0][1].body) as StatusEvent;
    expect(body.metadata?.worker_id).toBe('myhost-1234');
    expect(body.metadata?.conversation_id).toBe('conv-abc-123');
  });

  it('does not throw when fetch fails', async () => {
    const failingFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    const reporter = makeReporter({ fetch: failingFetch });

    await expect(reporter.start()).resolves.toBeUndefined();
    reporter.stop();
  });

  it('retries completed event up to 3 times on failure then succeeds', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })   // start
      .mockRejectedValueOnce(new Error('Network error'))   // complete attempt 1
      .mockResolvedValueOnce({ ok: false, status: 502 })   // complete attempt 2
      .mockResolvedValueOnce({ ok: true, status: 200 });   // complete attempt 3

    const reporter = makeReporter({ fetch: mockFetch });
    await reporter.start();

    const completePromise = reporter.complete({
      summary: 'Done',
      output: {},
      usage: {},
      turnCount: 1,
      toolsUsed: [],
      filesRead: [],
      filesWritten: [],
      commandsRun: [],
    });

    await completePromise;
    // Delivery begins after the durable queue write. Advance past retry delays (500ms, 1000ms).
    await vi.advanceTimersByTimeAsync(2000);

    // start (1) + 3 complete attempts = 4 total
    expect(mockFetch).toHaveBeenCalledTimes(4);
    const lastBody = JSON.parse(mockFetch.mock.calls[3][1].body) as StatusEvent;
    expect(lastBody.state).toBe('completed');
  });

  it('retries failed event up to 3 times on failure then succeeds', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })   // start
      .mockRejectedValueOnce(new Error('Timeout'))         // fail attempt 1
      .mockResolvedValueOnce({ ok: true, status: 200 });   // fail attempt 2

    const reporter = makeReporter({ fetch: mockFetch });
    await reporter.start();

    const failPromise = reporter.fail(new Error('Agent crashed'));
    await failPromise;
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockFetch).toHaveBeenCalledTimes(3);
    const lastBody = JSON.parse(mockFetch.mock.calls[2][1].body) as StatusEvent;
    expect(lastBody.state).toBe('failed');
  });

  it('gives up after max retries for terminal events', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })   // start
      .mockRejectedValueOnce(new Error('err1'))            // complete attempt 1
      .mockRejectedValueOnce(new Error('err2'))            // complete attempt 2
      .mockRejectedValueOnce(new Error('err3'));           // complete attempt 3

    const reporter = makeReporter({ fetch: mockFetch });
    await reporter.start();

    const completePromise = reporter.complete({
      summary: 'Done',
      output: {},
      usage: {},
      turnCount: 1,
      toolsUsed: [],
      filesRead: [],
      filesWritten: [],
      commandsRun: [],
    });

    await completePromise;
    await vi.advanceTimersByTimeAsync(3000);

    // start (1) + 3 failed attempts = 4
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('schedules deferred retries when all immediate retries fail for terminal events', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })   // start
      .mockRejectedValueOnce(new Error('err1'))            // complete attempt 1
      .mockRejectedValueOnce(new Error('err2'))            // complete attempt 2
      .mockRejectedValueOnce(new Error('err3'))            // complete attempt 3 (immediate retries exhausted)
      .mockResolvedValueOnce({ ok: true, status: 200 });   // deferred retry 1 succeeds

    const reporter = makeReporter({ fetch: mockFetch });
    await reporter.start();

    const completePromise = reporter.complete({
      summary: 'Done',
      output: {},
      usage: {},
      turnCount: 1,
      toolsUsed: [],
      filesRead: [],
      filesWritten: [],
      commandsRun: [],
    });

    await completePromise;
    // Delivery begins after the durable queue write. Advance past immediate retry delays.
    await vi.advanceTimersByTimeAsync(3000);

    // start (1) + 3 failed immediate attempts = 4 so far
    expect(mockFetch).toHaveBeenCalledTimes(4);

    // Advance past first deferred retry delay (5s)
    await vi.advanceTimersByTimeAsync(5000);

    // start (1) + 3 immediate (failed) + 1 deferred (success) = 5
    expect(mockFetch).toHaveBeenCalledTimes(5);
    const lastBody = JSON.parse(mockFetch.mock.calls[4][1].body) as StatusEvent;
    expect(lastBody.state).toBe('completed');
  });

  it('chains deferred retries until one succeeds', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })   // start
      .mockRejectedValueOnce(new Error('err1'))            // immediate 1
      .mockRejectedValueOnce(new Error('err2'))            // immediate 2
      .mockRejectedValueOnce(new Error('err3'))            // immediate 3
      .mockRejectedValueOnce(new Error('err4'))            // deferred 1
      .mockRejectedValueOnce(new Error('err5'))            // deferred 2
      .mockResolvedValueOnce({ ok: true, status: 200 });   // deferred 3 succeeds

    const reporter = makeReporter({ fetch: mockFetch });
    await reporter.start();

    const failPromise = reporter.fail(new Error('Agent crashed'));
    await failPromise;
    await vi.advanceTimersByTimeAsync(3000);

    // Deferred retry 1 at 5s
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockFetch).toHaveBeenCalledTimes(5);

    // Deferred retry 2 at 10s
    await vi.advanceTimersByTimeAsync(10000);
    expect(mockFetch).toHaveBeenCalledTimes(6);

    // Deferred retry 3 at 20s
    await vi.advanceTimersByTimeAsync(20000);
    expect(mockFetch).toHaveBeenCalledTimes(7);

    const lastBody = JSON.parse(mockFetch.mock.calls[6][1].body) as StatusEvent;
    expect(lastBody.state).toBe('failed');
  });

  it('stops deferred retries after max attempts', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })   // start
      .mockRejectedValue(new Error('always fails'));        // everything else fails

    const reporter = makeReporter({ fetch: mockFetch });
    await reporter.start();

    const completePromise = reporter.complete({
      summary: 'Done',
      output: {},
      usage: {},
      turnCount: 1,
      toolsUsed: [],
      filesRead: [],
      filesWritten: [],
      commandsRun: [],
    });

    await completePromise;
    await vi.advanceTimersByTimeAsync(3000);

    // 1 (start) + 3 (immediate) = 4
    expect(mockFetch).toHaveBeenCalledTimes(4);

    // Advance through all 5 deferred retries: 5s + 10s + 20s + 40s + 80s = 155s
    await vi.advanceTimersByTimeAsync(160000);

    // 1 (start) + 3 (immediate) + 5 (deferred) = 9
    expect(mockFetch).toHaveBeenCalledTimes(9);

    // No more retries after max deferred attempts
    await vi.advanceTimersByTimeAsync(200000);
    expect(mockFetch).toHaveBeenCalledTimes(9);
  });

  it('does not retry non-terminal events like heartbeats', async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error('Network error'));  // start fails

    const reporter = makeReporter({ fetch: mockFetch });
    await reporter.start();
    reporter.stop();

    // Only 1 attempt, no retry
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('sends heartbeat events at configured interval', async () => {
    const mockFetch = createMockFetch();
    const reporter = makeReporter({ fetch: mockFetch, heartbeatMs: 1000 });

    await reporter.start();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(mockFetch).toHaveBeenCalledTimes(3);

    reporter.stop();
  });

  it('sends a canceled event with a generic message and stable code', async () => {
    const mockFetch = createMockFetch();
    const reporter = makeReporter({ fetch: mockFetch });

    await reporter.start();
    await reporter.cancel('Another run in progress', 'lock_contention');

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const body = JSON.parse(mockFetch.mock.calls[1][1].body) as StatusEvent;
    expect(body.state).toBe('canceled');
    expect(body.error?.message).toBe('Run canceled.');
    expect(body.error?.code).toBe('lock_contention');
  });

  it.each([
    {
      name: 'completion',
      state: 'completed',
      report: (reporter: TelemetryReporter) => reporter.complete({
        summary: 'Done',
        output: {},
        usage: {},
        turnCount: 1,
        toolsUsed: [],
        filesRead: [],
        filesWritten: [],
        commandsRun: [],
      }),
    },
    {
      name: 'failure',
      state: 'failed',
      report: (reporter: TelemetryReporter) => reporter.fail(new Error('Agent failed')),
    },
    {
      name: 'cancellation',
      state: 'canceled',
      report: (reporter: TelemetryReporter) => reporter.cancel('Canceled', 'user_canceled'),
    },
  ])('durably queues $name before returning while Panel delivery hangs', async ({ state, report }) => {
    vi.useRealTimers();
    const runId = `hanging-${state}`;
    const pendingFile = join(testPendingDir, `${runId}.json`);
    rmSync(pendingFile, { force: true });
    let didExistWhenDeliveryStarted = false;
    let releaseRequest: ((response: Response) => void) | undefined;
    const mockFetch = vi.fn(() => {
      didExistWhenDeliveryStarted = existsSync(pendingFile);
      return new Promise<Response>((resolve) => {
        releaseRequest = resolve;
      });
    });
    const reporter = makeReporter({ runId, fetch: mockFetch as typeof fetch });

    const reporting = report(reporter);
    try {
      const outcome = await Promise.race([
        reporting.then(() => 'queued' as const),
        new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 100)),
      ]);

      expect(outcome).toBe('queued');
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(didExistWhenDeliveryStarted).toBe(true);
      const pending = JSON.parse(readFileSync(pendingFile, 'utf8')) as { body: StatusEvent };
      expect(pending.body.state).toBe(state);
    } finally {
      releaseRequest?.(new Response('{}', { status: 200 }));
      await reporting;
      reporter.stop();
    }
  });

  it('defaults accomplishments to non-empty when no side effects occurred', async () => {
    const mockFetch = createMockFetch();
    const reporter = makeReporter({ fetch: mockFetch });

    await reporter.start();
    await reporter.complete({
      summary: 'No-op run',
      output: {},
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 },
      turnCount: 2,
      toolsUsed: [],
      filesRead: [],
      filesWritten: [],
      commandsRun: [],
      model: 'claude-haiku-4-5-20251001',
    });

    const body = JSON.parse(mockFetch.mock.calls[1][1].body) as StatusEvent;
    expect(body.result?.accomplishments).toEqual(['Run completed.']);
    expect(body.result?.model).toBe('not_shared');
  });

  it('treats 409 from the panel as terminal success (no retry)', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })   // start
      .mockResolvedValueOnce({ ok: false, status: 409 }); // complete already-terminal

    const reporter = makeReporter({ fetch: mockFetch });
    await reporter.start();

    const completePromise = reporter.complete({
      summary: 'Done',
      output: {},
      usage: {},
      turnCount: 1,
      toolsUsed: [],
      filesRead: [],
      filesWritten: [],
      commandsRun: [],
    });
    // Advance in case a retry was (wrongly) scheduled.
    await vi.advanceTimersByTimeAsync(5000);
    await completePromise;

    // Exactly 2 calls: start + complete. No retry despite non-2xx.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('clears any pending deferred retry timer when stop() is called', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })   // start
      .mockRejectedValue(new Error('always fails'));      // everything else

    const reporter = makeReporter({ fetch: mockFetch });
    await reporter.start();

    const completePromise = reporter.complete({
      summary: 'Done',
      output: {},
      usage: {},
      turnCount: 1,
      toolsUsed: [],
      filesRead: [],
      filesWritten: [],
      commandsRun: [],
    });
    await completePromise;
    await vi.advanceTimersByTimeAsync(3000);

    // After immediate retries: 1 start + 3 complete attempts = 4.
    expect(mockFetch).toHaveBeenCalledTimes(4);

    // External cleanup — no further deferred retries should fire.
    reporter.stop();

    await vi.advanceTimersByTimeAsync(200_000);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('persists a terminal event before stop cancels deferred retries', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockRejectedValue(new Error('panel unavailable'));
    const reporter = makeReporter({ fetch: mockFetch });
    await reporter.start();

    const completePromise = reporter.complete({
      summary: 'Durable result',
      output: {},
      usage: {},
      turnCount: 1,
      toolsUsed: [],
      filesRead: [],
      filesWritten: [],
      commandsRun: [],
    });
    await vi.advanceTimersByTimeAsync(3_000);
    await completePromise;
    reporter.stop();

    const pendingFile = join(testPendingDir, 'run-123.json');
    expect(existsSync(pendingFile)).toBe(true);
    const pending = JSON.parse(readFileSync(pendingFile, 'utf8')) as { body: StatusEvent };
    expect(pending.body.state).toBe('completed');
    expect(pending.body.result?.summary).toBe('Run completed.');
  });

  it('stops heartbeat when stop is called', async () => {
    const mockFetch = createMockFetch();
    const reporter = makeReporter({ fetch: mockFetch, heartbeatMs: 1000 });

    await reporter.start();
    reporter.stop();

    await vi.advanceTimersByTimeAsync(5000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
