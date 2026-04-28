import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
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
  fetch?: typeof fetch;
  heartbeatMs?: number;
  progressMode?: 'live' | 'batched';
  progressSampleMs?: number;
} = {}) {
  return new TelemetryReporter({
    runId: 'run-123',
    agentName: 'Test Agent',
    endpoint: 'https://panel.example.com/api/runs/run-123/status',
    apiKey: 'ap_live_test',
    fetch: overrides.fetch ?? createMockFetch(),
    heartbeatMs: overrides.heartbeatMs ?? 0,
    progressMode: overrides.progressMode,
    progressSampleMs: overrides.progressSampleMs,
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

  it('sends a completed event with full execution data', async () => {
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
    expect(body.result?.summary).toBe('Created report');
    expect(body.result?.accomplishments).toEqual([
      'Wrote 1 file(s): /output.md',
      'Ran 2 command(s)',
      'Read 3 file(s)',
    ]);
    expect(body.result?.usage).toEqual({
      turns: 5,
      files_read: 3,
      files_written: 1,
      commands_run: 2,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      estimated_cost_usd: 0,
    });
    expect(body.result?.model).toBe('unknown');
    expect(body.result?.accomplishments?.length ?? 0).toBeGreaterThan(0);
    expect(body.result?.output).toEqual({
      turn_count: 5,
      tools_used: ['Read', 'Write', 'Bash'],
      files_read: ['/a.ts', '/b.ts', '/c.ts'],
      files_written: ['/output.md'],
      commands_run: ['npm test', 'npm run build'],
    });
  });

  it('sends a failed event on error', async () => {
    const mockFetch = createMockFetch();
    const reporter = makeReporter({ fetch: mockFetch });

    await reporter.start();
    await reporter.fail(new Error('Something broke'));

    const body = JSON.parse(mockFetch.mock.calls[1][1].body) as StatusEvent;
    expect(body.state).toBe('failed');
    expect(body.error?.message).toBe('Something broke');
  });

  it('sends progress events with message and metadata', async () => {
    const mockFetch = createMockFetch();
    const reporter = makeReporter({ fetch: mockFetch });

    await reporter.start();
    await reporter.progress('Processing items', {
      turns_completed: 5,
      tools_used: ['web_search'],
    });

    const body = JSON.parse(mockFetch.mock.calls[1][1].body) as StatusEvent;
    expect(body.state).toBe('working');
    expect(body.message).toBe('Processing items');
    expect(body.metadata?.turns_completed).toBe(5);
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
    expect(body.message).toBe('step 1');
  });

  it('batches progress updates into the terminal completed payload', async () => {
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
    const progressUpdates = (body.result?.output?.progress_updates ?? []) as Array<Record<string, unknown>>;
    expect(progressUpdates).toHaveLength(2);
    expect(progressUpdates[0].message).toBe('step 1');
    expect((progressUpdates[0].metadata as Record<string, unknown>).turns_completed).toBe(1);
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

    // Advance past retry delays (500ms, 1000ms)
    await vi.advanceTimersByTimeAsync(2000);
    await completePromise;

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
    await vi.advanceTimersByTimeAsync(1000);
    await failPromise;

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

    await vi.advanceTimersByTimeAsync(3000);
    await completePromise;

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

    // Advance past immediate retry delays (500ms + 1000ms)
    await vi.advanceTimersByTimeAsync(3000);
    await completePromise;

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
    await vi.advanceTimersByTimeAsync(3000);
    await failPromise;

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

    await vi.advanceTimersByTimeAsync(3000);
    await completePromise;

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

  it('sends a canceled event with the provided reason and code', async () => {
    const mockFetch = createMockFetch();
    const reporter = makeReporter({ fetch: mockFetch });

    await reporter.start();
    await reporter.cancel('Another run in progress', 'lock_contention');

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const body = JSON.parse(mockFetch.mock.calls[1][1].body) as StatusEvent;
    expect(body.state).toBe('canceled');
    expect(body.error?.message).toBe('Another run in progress');
    expect(body.error?.code).toBe('lock_contention');
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
    expect(body.result?.accomplishments).toEqual(['Completed in 2 turn(s)']);
    expect(body.result?.model).toBe('claude-haiku-4-5-20251001');
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
    await vi.advanceTimersByTimeAsync(3000);
    await completePromise;

    // After immediate retries: 1 start + 3 complete attempts = 4.
    expect(mockFetch).toHaveBeenCalledTimes(4);

    // External cleanup — no further deferred retries should fire.
    reporter.stop();

    await vi.advanceTimersByTimeAsync(200_000);
    expect(mockFetch).toHaveBeenCalledTimes(4);
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
