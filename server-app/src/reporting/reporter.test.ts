import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelemetryReporter, type StatusEvent } from './reporter.js';

function createMockFetch() {
  return vi.fn().mockResolvedValue({ ok: true, status: 200 });
}

function makeReporter(overrides: { fetch?: typeof fetch; heartbeatMs?: number } = {}) {
  return new TelemetryReporter({
    runId: 'run-123',
    agentName: 'Test Agent',
    endpoint: 'https://panel.example.com/api/runs/run-123/status',
    apiKey: 'ap_live_test',
    fetch: overrides.fetch ?? createMockFetch(),
    heartbeatMs: overrides.heartbeatMs ?? 0,
  });
}

describe('TelemetryReporter', () => {
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
    expect(body.result?.usage).toEqual({ turns: 5, files_read: 3, files_written: 1, commands_run: 2 });
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

  it('stops heartbeat when stop is called', async () => {
    const mockFetch = createMockFetch();
    const reporter = makeReporter({ fetch: mockFetch, heartbeatMs: 1000 });

    await reporter.start();
    reporter.stop();

    await vi.advanceTimersByTimeAsync(5000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
