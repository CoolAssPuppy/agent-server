import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { EventEmitter } from 'events';
import { TriggerHandler, type InvokeRun } from './trigger-handler.js';
import type { RunTriggerEvent } from '../reporting/realtime-client.js';

type FetchCall = {
  url: string;
  method: string;
  body: unknown;
  authorization?: string;
};

function createFetchRecorder(): { fetch: ReturnType<typeof vi.fn>; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchFn = vi.fn(async (url: string, opts: RequestInit) => {
    const headers = (opts.headers ?? {}) as Record<string, string>;
    const bodyText = typeof opts.body === 'string' ? opts.body : undefined;
    calls.push({
      url,
      method: opts.method ?? 'GET',
      body: bodyText ? JSON.parse(bodyText) : undefined,
      authorization: headers.Authorization,
    });
    return new Response(null, { status: 200 });
  });
  return { fetch: fetchFn, calls };
}

function createTempDir(label: string): string {
  const dir = join(tmpdir(), `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeAgentFile(dir: string, slug: string): void {
  writeFileSync(
    join(dir, `${slug}.yaml`),
    `id: ${slug}\nname: ${slug}\nprompt: Do work.\n`,
    'utf-8',
  );
}

function makeRunTrigger(overrides: Partial<RunTriggerEvent> = {}): RunTriggerEvent {
  return {
    id: 1,
    type: 'run_trigger',
    trigger_id: 'trig_abc',
    task_slug: 'demo-agent',
    ...overrides,
  };
}

describe('TriggerHandler', () => {
  let dir: string;
  let emitter: EventEmitter;

  beforeEach(() => {
    dir = createTempDir('trigger');
    emitter = new EventEmitter();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function fireAndWait(event: RunTriggerEvent, waitMs = 50): Promise<void> {
    emitter.emit('run_trigger', event);
    return new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  it('invokes the expected ack -> running -> complete sequence for a successful run', async () => {
    writeAgentFile(dir, 'demo-agent');
    const { fetch: fetchFn, calls } = createFetchRecorder();

    const invokeRun = vi.fn<InvokeRun>(async (opts) => {
      await opts.onRunStart('run-xyz');
      return { status: 'completed', runId: 'run-xyz' };
    });

    const handler = new TriggerHandler({
      agentsDir: dir,
      panelUrl: 'https://panel.test',
      panelApiKey: 'secret',
      sseEvents: emitter,
      invokeRun,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    handler.start();

    await fireAndWait(makeRunTrigger({ task_slug: 'demo-agent', input: 'hello world' }));
    handler.stop();

    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({
      url: 'https://panel.test/api/run-triggers/trig_abc/ack',
      method: 'POST',
      authorization: 'Bearer secret',
    });
    expect(calls[1]).toMatchObject({
      url: 'https://panel.test/api/run-triggers/trig_abc/running',
      method: 'POST',
      body: { task_run_id: 'run-xyz' },
    });
    expect(calls[2]).toMatchObject({
      url: 'https://panel.test/api/run-triggers/trig_abc/complete',
      method: 'POST',
      body: { status: 'completed' },
    });

    expect(invokeRun).toHaveBeenCalledOnce();
    const call = invokeRun.mock.calls[0][0];
    expect(call.agent.id).toBe('demo-agent');
    expect(call.trigger).toBe('manual');
    expect(call.promptSuffix).toBe('hello world');
  });

  it('posts complete with status=failed and error_message on failure', async () => {
    writeAgentFile(dir, 'demo-agent');
    const { fetch: fetchFn, calls } = createFetchRecorder();

    const invokeRun: InvokeRun = async (opts) => {
      await opts.onRunStart('run-1');
      return { status: 'failed', runId: 'run-1', error: 'boom' };
    };

    const handler = new TriggerHandler({
      agentsDir: dir,
      panelUrl: 'https://panel.test',
      panelApiKey: 'k',
      sseEvents: emitter,
      invokeRun,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    handler.start();

    await fireAndWait(makeRunTrigger());
    handler.stop();

    const complete = calls.find((c) => c.url.endsWith('/complete'));
    expect(complete?.body).toMatchObject({ status: 'failed', error_message: 'boom' });
  });

  it('posts complete with failed + task_slug not found when slug does not resolve', async () => {
    const { fetch: fetchFn, calls } = createFetchRecorder();
    const invokeRun = vi.fn<InvokeRun>();

    const handler = new TriggerHandler({
      agentsDir: dir,
      panelUrl: 'https://panel.test',
      panelApiKey: 'k',
      sseEvents: emitter,
      invokeRun,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    handler.start();

    await fireAndWait(makeRunTrigger({ task_slug: 'nonexistent' }));
    handler.stop();

    expect(invokeRun).not.toHaveBeenCalled();
    expect(calls.map((c) => c.url)).toEqual([
      'https://panel.test/api/run-triggers/trig_abc/ack',
      'https://panel.test/api/run-triggers/trig_abc/complete',
    ]);
    const complete = calls[1];
    expect(complete.body).toMatchObject({
      status: 'failed',
      error_message: 'task_slug not found',
    });
  });

  it('treats a skipped run as a failed trigger with a helpful message', async () => {
    writeAgentFile(dir, 'demo-agent');
    const { fetch: fetchFn, calls } = createFetchRecorder();

    const invokeRun: InvokeRun = async () => {
      return { status: 'skipped' };
    };

    const handler = new TriggerHandler({
      agentsDir: dir,
      panelUrl: 'https://panel.test',
      panelApiKey: 'k',
      sseEvents: emitter,
      invokeRun,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    handler.start();

    await fireAndWait(makeRunTrigger());
    handler.stop();

    const complete = calls.find((c) => c.url.endsWith('/complete'));
    expect(complete?.body).toMatchObject({ status: 'failed' });
    expect(complete?.body).toHaveProperty('error_message');
  });

  it('coerces non-string input into promptSuffix JSON', async () => {
    writeAgentFile(dir, 'demo-agent');
    const { fetch: fetchFn } = createFetchRecorder();

    const invokeRun = vi.fn<InvokeRun>(async (opts) => {
      await opts.onRunStart('r');
      return { status: 'completed', runId: 'r' };
    });

    const handler = new TriggerHandler({
      agentsDir: dir,
      panelUrl: 'https://panel.test',
      panelApiKey: 'k',
      sseEvents: emitter,
      invokeRun,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    handler.start();

    await fireAndWait(makeRunTrigger({ input: { foo: 'bar' } }));
    handler.stop();

    expect(invokeRun).toHaveBeenCalledOnce();
    const call = invokeRun.mock.calls[0][0];
    expect(typeof call.promptSuffix).toBe('string');
    expect(JSON.parse(call.promptSuffix!)).toEqual({ foo: 'bar' });
  });

  it('does not process events after stop()', async () => {
    writeAgentFile(dir, 'demo-agent');
    const { fetch: fetchFn, calls } = createFetchRecorder();
    const invokeRun = vi.fn<InvokeRun>(async (opts) => {
      await opts.onRunStart('r');
      return { status: 'completed', runId: 'r' };
    });

    const handler = new TriggerHandler({
      agentsDir: dir,
      panelUrl: 'https://panel.test',
      panelApiKey: 'k',
      sseEvents: emitter,
      invokeRun,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    handler.start();
    handler.stop();

    emitter.emit('run_trigger', makeRunTrigger());
    await new Promise((r) => setTimeout(r, 30));

    expect(invokeRun).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});
