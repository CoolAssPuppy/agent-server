import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SseClient, type AgentServerEvent } from './sse-client.js';

type FetchArgs = {
  url: string;
  options: RequestInit;
};

function encode(chunk: string): Uint8Array {
  return new TextEncoder().encode(chunk);
}

function streamFromChunks(chunks: string[], options: { neverEnd?: boolean } = {}): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encode(chunk));
      }
      if (!options.neverEnd) {
        controller.close();
      }
    },
  });
}

function makeResponse(body: ReadableStream<Uint8Array>, init: { ok?: boolean; status?: number } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    statusText: 'OK',
  });
}

type MockFetchOptions = {
  responses: Response[];
  onCall?: (args: FetchArgs) => void;
};

function createMockFetch(options: MockFetchOptions): ReturnType<typeof vi.fn> {
  let i = 0;
  return vi.fn(async (url: string, opts: RequestInit) => {
    if (options.onCall) options.onCall({ url, options: opts });
    const response = options.responses[i] ?? options.responses[options.responses.length - 1];
    i += 1;
    return response;
  });
}

function createTempCursorPath(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sse-cursor-'));
  return { dir, path: join(dir, 'cursor') };
}

describe('SseClient', () => {
  let tempDirs: string[];

  beforeEach(() => {
    tempDirs = [];
  });

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function cursorPath(): string {
    const { dir, path } = createTempCursorPath();
    tempDirs.push(dir);
    return path;
  }

  it('parses JSON events from SSE lines and dispatches to emitter', async () => {
    const body = streamFromChunks([
      ':keepalive\n\n',
      'data: {"id":1,"type":"run_trigger","trigger_id":"t1","task_slug":"foo"}\n\n',
      'data: {"id":2,"type":"agent_file_poke","reason":"sync_requested"}\n\n',
    ]);

    const fetchFn = createMockFetch({ responses: [makeResponse(body)] });
    const received: AgentServerEvent[] = [];

    const client = new SseClient({
      panelUrl: 'https://panel.test',
      panelApiKey: 'key-123',
      cursorPath: cursorPath(),
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      initialBackoffMs: 10,
      maxBackoffMs: 20,
      idleTimeoutMs: 60_000,
    });

    client.events.on('run_trigger', (e) => received.push(e));
    client.events.on('agent_file_poke', (e) => received.push(e));

    await client.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    client.stop();

    expect(received).toHaveLength(2);
    expect(received[0]).toMatchObject({ id: 1, type: 'run_trigger', trigger_id: 't1', task_slug: 'foo' });
    expect(received[1]).toMatchObject({ id: 2, type: 'agent_file_poke' });
  });

  it('includes bearer auth and since cursor in request', async () => {
    const calls: FetchArgs[] = [];
    const body = streamFromChunks(['data: {"id":5,"type":"run_trigger","trigger_id":"x","task_slug":"y"}\n\n']);

    const fetchFn = createMockFetch({
      responses: [makeResponse(body)],
      onCall: (a) => calls.push(a),
    });

    const client = new SseClient({
      panelUrl: 'https://panel.test',
      panelApiKey: 'sekret',
      cursorPath: cursorPath(),
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      initialBackoffMs: 10,
      maxBackoffMs: 20,
      idleTimeoutMs: 60_000,
      initialCursor: 42,
    });

    await client.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    client.stop();

    expect(calls[0].url).toBe('https://panel.test/api/agent-server/events?since=42');
    const headers = calls[0].options.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sekret');
  });

  it('persists the cursor to disk after each event', async () => {
    const path = cursorPath();
    const body = streamFromChunks([
      'data: {"id":10,"type":"run_trigger","trigger_id":"a","task_slug":"x"}\n\n',
      'data: {"id":11,"type":"run_trigger","trigger_id":"b","task_slug":"x"}\n\n',
    ]);

    const fetchFn = createMockFetch({ responses: [makeResponse(body)] });

    const client = new SseClient({
      panelUrl: 'https://panel.test',
      panelApiKey: 'k',
      cursorPath: path,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      initialBackoffMs: 10,
      maxBackoffMs: 20,
      idleTimeoutMs: 60_000,
    });

    await client.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    client.stop();

    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf-8').trim()).toBe('11');
  });

  it('reconnects after stream ends, resuming from last cursor', async () => {
    const calls: FetchArgs[] = [];
    const body1 = streamFromChunks(['data: {"id":7,"type":"run_trigger","trigger_id":"a","task_slug":"s"}\n\n']);
    const body2 = streamFromChunks(['data: {"id":8,"type":"run_trigger","trigger_id":"b","task_slug":"s"}\n\n']);

    const fetchFn = createMockFetch({
      responses: [makeResponse(body1), makeResponse(body2)],
      onCall: (a) => calls.push(a),
    });

    const client = new SseClient({
      panelUrl: 'https://panel.test',
      panelApiKey: 'k',
      cursorPath: cursorPath(),
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      initialBackoffMs: 5,
      maxBackoffMs: 10,
      idleTimeoutMs: 60_000,
    });

    await client.start();
    await new Promise((resolve) => setTimeout(resolve, 80));
    client.stop();

    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0].url).toContain('since=0');
    expect(calls[1].url).toContain('since=7');
  });

  it('backs off exponentially on repeated failures, capped', async () => {
    const calls: number[] = [];
    const fetchFn = vi.fn(async () => {
      calls.push(Date.now());
      throw new Error('boom');
    });

    const client = new SseClient({
      panelUrl: 'https://panel.test',
      panelApiKey: 'k',
      cursorPath: cursorPath(),
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      initialBackoffMs: 10,
      maxBackoffMs: 40,
      idleTimeoutMs: 60_000,
    });

    await client.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    client.stop();

    expect(calls.length).toBeGreaterThanOrEqual(3);
    const firstGap = calls[1] - calls[0];
    const secondGap = calls[2] - calls[1];
    expect(firstGap).toBeGreaterThanOrEqual(5);
    expect(secondGap).toBeGreaterThanOrEqual(firstGap - 5);
  });

  it('does not reconnect after stop() is called', async () => {
    const body = streamFromChunks(['data: {"id":1,"type":"run_trigger","trigger_id":"a","task_slug":"s"}\n\n']);
    const fetchFn = createMockFetch({ responses: [makeResponse(body), makeResponse(body)] });

    const client = new SseClient({
      panelUrl: 'https://panel.test',
      panelApiKey: 'k',
      cursorPath: cursorPath(),
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      initialBackoffMs: 10,
      maxBackoffMs: 20,
      idleTimeoutMs: 60_000,
    });

    await client.start();
    await new Promise((resolve) => setTimeout(resolve, 15));
    client.stop();
    const callsAtStop = fetchFn.mock.calls.length;

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fetchFn.mock.calls.length).toBe(callsAtStop);
  });

  it('closes and reconnects when idle beyond the idle timeout', async () => {
    const calls: FetchArgs[] = [];
    const idleBody = streamFromChunks([], { neverEnd: true });
    const nextBody = streamFromChunks(['data: {"id":9,"type":"run_trigger","trigger_id":"r","task_slug":"s"}\n\n']);

    const fetchFn = createMockFetch({
      responses: [makeResponse(idleBody), makeResponse(nextBody)],
      onCall: (a) => calls.push(a),
    });

    const client = new SseClient({
      panelUrl: 'https://panel.test',
      panelApiKey: 'k',
      cursorPath: cursorPath(),
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      initialBackoffMs: 5,
      maxBackoffMs: 10,
      idleTimeoutMs: 30,
    });

    await client.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    client.stop();

    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('ignores comment lines starting with ":"', async () => {
    const received: AgentServerEvent[] = [];
    const body = streamFromChunks([
      ': this is a keepalive\n\n',
      ':another comment\n',
      'data: {"id":3,"type":"run_trigger","trigger_id":"x","task_slug":"y"}\n\n',
    ]);

    const fetchFn = createMockFetch({ responses: [makeResponse(body)] });
    const client = new SseClient({
      panelUrl: 'https://panel.test',
      panelApiKey: 'k',
      cursorPath: cursorPath(),
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      initialBackoffMs: 10,
      maxBackoffMs: 20,
      idleTimeoutMs: 60_000,
    });

    client.events.on('run_trigger', (e) => received.push(e));
    await client.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    client.stop();

    expect(received).toHaveLength(1);
    expect(received[0].id).toBe(3);
  });

  it('loads persisted cursor from disk on first connection', async () => {
    const path = cursorPath();
    const { writeFileSync } = await import('fs');
    writeFileSync(path, '99', 'utf-8');

    const calls: FetchArgs[] = [];
    const body = streamFromChunks([]);
    const fetchFn = createMockFetch({
      responses: [makeResponse(body)],
      onCall: (a) => calls.push(a),
    });

    const client = new SseClient({
      panelUrl: 'https://panel.test',
      panelApiKey: 'k',
      cursorPath: path,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      initialBackoffMs: 5,
      maxBackoffMs: 10,
      idleTimeoutMs: 60_000,
    });

    await client.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    client.stop();

    expect(calls[0].url).toContain('since=99');
  });
});
