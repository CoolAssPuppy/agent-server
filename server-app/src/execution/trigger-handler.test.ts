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

/**
 * Inbound triggers.
 *
 * These arrive from a provider webhook that Panel routed here, so the payload
 * is written by whoever filed the issue. Two things change compared with a
 * person pressing Run Now: the acknowledgement decides whether this daemon
 * actually holds the trigger, and an agent that can write back to the source
 * is refused rather than run.
 */
describe('TriggerHandler and inbound triggers', () => {
  let dir: string;
  let emitter: EventEmitter;

  beforeEach(() => {
    dir = createTempDir('trigger-inbound');
    emitter = new EventEmitter();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function fireAndWait(event: RunTriggerEvent, waitMs = 50): Promise<void> {
    emitter.emit('run_trigger', event);
    return new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  /** An agent that reads Linear and writes elsewhere, so it may run from Linear. */
  function writeReadOnlyLinearAgent(directory: string, slug: string): void {
    writeFileSync(
      join(directory, `${slug}.yaml`),
      [
        `id: ${slug}`,
        `name: ${slug}`,
        'prompt: Capture the issue.',
        'tools:',
        '  - mcp__claude_ai_Linear',
        'permissions:',
        '  allow:',
        '    - "mcp__claude_ai_Linear__get_*"',
        '  deny:',
        '    - "mcp__claude_ai_Linear__save_*"',
        '    - "mcp__claude_ai_Linear__create_*"',
        '    - "mcp__claude_ai_Linear__update_*"',
        '    - "mcp__claude_ai_Linear__delete_*"',
        '    - "mcp__claude_ai_Linear__merge_*"',
        '    - "mcp__claude_ai_Linear__submit_*"',
        '    - "mcp__claude_ai_Linear__resolve_*"',
        '',
      ].join('\n'),
      'utf-8',
    );
  }

  function recorderWith(ackBody: unknown) {
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
      if (url.endsWith('/ack')) {
        return new Response(JSON.stringify(ackBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(null, { status: 200 });
    });
    return { fetch: fetchFn, calls };
  }

  const inboundEvent = (input: Record<string, unknown> = {}): RunTriggerEvent => ({
    id: 1,
    type: 'run_trigger',
    trigger_id: 'trig_inbound',
    task_slug: 'linear-capture',
    trigger_kind: 'inbound',
    input: {
      trigger: 'inbound',
      source: 'linear',
      event_type: 'issue.assigned',
      subject_id: 'ENG-1234',
      subject_title: 'Rework the onboarding email',
      subject_url: 'https://linear.app/acme/issue/ENG-1234',
      actor: 'Nate',
      ...input,
    },
  });

  it('does not run when another device already claimed the trigger', async () => {
    writeReadOnlyLinearAgent(dir, 'linear-capture');
    const { fetch: fetchFn, calls } = recorderWith({ ok: true, claimed: false });
    const invokeRun = vi.fn<InvokeRun>(async () => ({ status: 'completed', runId: 'r' }));

    const handler = new TriggerHandler({
      agentsDir: dir,
      panelUrl: 'https://panel.test',
      panelApiKey: 'secret',
      machineId: 'device-1',
      sseEvents: emitter,
      invokeRun,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    handler.start();

    await fireAndWait(inboundEvent());
    handler.stop();

    expect(invokeRun).not.toHaveBeenCalled();
    // The acknowledgement is the only call. Reporting a terminal state for a
    // run somebody else is doing would overwrite their result.
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ machine_id: 'device-1' });
  });

  it('runs when it wins the claim', async () => {
    writeReadOnlyLinearAgent(dir, 'linear-capture');
    const { fetch: fetchFn } = recorderWith({ ok: true, claimed: true });
    const invokeRun = vi.fn<InvokeRun>(async (opts) => {
      await opts.onRunStart('run-1');
      return { status: 'completed', runId: 'run-1' };
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

    await fireAndWait(inboundEvent());
    handler.stop();

    expect(invokeRun).toHaveBeenCalledTimes(1);
    expect(invokeRun.mock.calls[0][0].trigger).toBe('inbound');
  });

  it('runs when an older Panel does not report a claim at all', async () => {
    writeReadOnlyLinearAgent(dir, 'linear-capture');
    const { fetch: fetchFn } = recorderWith({ ok: true, status: 'acknowledged' });
    const invokeRun = vi.fn<InvokeRun>(async () => ({ status: 'completed', runId: 'r' }));

    const handler = new TriggerHandler({
      agentsDir: dir,
      panelUrl: 'https://panel.test',
      panelApiKey: 'secret',
      sseEvents: emitter,
      invokeRun,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    handler.start();

    await fireAndWait(inboundEvent());
    handler.stop();

    expect(invokeRun).toHaveBeenCalledTimes(1);
  });

  it('renders the trigger as labeled lines rather than JSON', async () => {
    writeReadOnlyLinearAgent(dir, 'linear-capture');
    const { fetch: fetchFn } = recorderWith({ ok: true, claimed: true });
    const invokeRun = vi.fn<InvokeRun>(async () => ({ status: 'completed', runId: 'r' }));

    const handler = new TriggerHandler({
      agentsDir: dir,
      panelUrl: 'https://panel.test',
      panelApiKey: 'secret',
      sseEvents: emitter,
      invokeRun,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    handler.start();

    await fireAndWait(inboundEvent());
    handler.stop();

    const suffix = invokeRun.mock.calls[0][0].promptSuffix ?? '';
    expect(suffix).toContain('Subject id: ENG-1234');
    expect(suffix).toContain('Source: linear');
    expect(suffix).not.toContain('{');
    // `trigger: inbound` is how the renderer recognised the shape. Repeating it
    // to the agent spends budget on something the agent cannot act on.
    expect(suffix).not.toContain('Trigger:');
  });

  it('refuses an agent that can write back to the source that triggered it', async () => {
    writeFileSync(
      join(dir, 'linear-capture.yaml'),
      [
        'id: linear-capture',
        'name: Linear Capture',
        'prompt: Reply on the issue.',
        'tools:',
        '  - mcp__claude_ai_Linear',
        'permissions:',
        '  allow:',
        '    - "mcp__claude_ai_Linear__save_comment"',
        '  deny: []',
        '',
      ].join('\n'),
      'utf-8',
    );

    const { fetch: fetchFn, calls } = recorderWith({ ok: true, claimed: true });
    const invokeRun = vi.fn<InvokeRun>(async () => ({ status: 'completed', runId: 'r' }));

    const handler = new TriggerHandler({
      agentsDir: dir,
      panelUrl: 'https://panel.test',
      panelApiKey: 'secret',
      sseEvents: emitter,
      invokeRun,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    handler.start();

    await fireAndWait(inboundEvent());
    handler.stop();

    expect(invokeRun).not.toHaveBeenCalled();

    const complete = calls.find((call) => call.url.endsWith('/complete'));
    expect(complete?.body).toMatchObject({ status: 'failed' });
    expect(String((complete?.body as { error_message: string }).error_message))
      .toContain('may not be started by a linear event');
  });

  it('applies no such refusal to a run a person asked for', async () => {
    writeFileSync(
      join(dir, 'linear-capture.yaml'),
      [
        'id: linear-capture',
        'name: Linear Capture',
        'prompt: Reply on the issue.',
        'tools:',
        '  - mcp__claude_ai_Linear',
        'permissions:',
        '  allow:',
        '    - "mcp__claude_ai_Linear__save_comment"',
        '  deny: []',
        '',
      ].join('\n'),
      'utf-8',
    );

    const { fetch: fetchFn } = recorderWith({ ok: true, claimed: true });
    const invokeRun = vi.fn<InvokeRun>(async () => ({ status: 'completed', runId: 'r' }));

    const handler = new TriggerHandler({
      agentsDir: dir,
      panelUrl: 'https://panel.test',
      panelApiKey: 'secret',
      sseEvents: emitter,
      invokeRun,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    handler.start();

    await fireAndWait({ ...inboundEvent(), trigger_kind: 'manual' });
    handler.stop();

    // A person choosing to run an agent is a different act from a stranger's
    // issue title choosing it.
    expect(invokeRun).toHaveBeenCalledTimes(1);
  });
});

/**
 * What the daemon does when the claim does not come back cleanly.
 *
 * A refusal and an outage are different answers. Panel saying the trigger is
 * not ours is the one case we definitely know not to run; a Panel we cannot
 * reach is a case we know nothing about, and skipping there would drop
 * triggers every time the network hiccups.
 */
describe('TriggerHandler when the claim is not a clean yes', () => {
  let dir: string;
  let emitter: EventEmitter;

  beforeEach(() => {
    dir = createTempDir('trigger-claim');
    emitter = new EventEmitter();
    writeAgentFile(dir, 'demo-agent');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function runWith(status: number, body?: unknown) {
    const invokeRun = vi.fn<InvokeRun>(async () => ({ status: 'completed', runId: 'r' }));
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/ack')) {
        return new Response(body === undefined ? null : JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(null, { status: 200 });
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

    emitter.emit('run_trigger', makeRunTrigger());
    return new Promise<typeof invokeRun>((resolve) =>
      setTimeout(() => {
        handler.stop();
        resolve(invokeRun);
      }, 50),
    );
  }

  it('does not run when Panel says the trigger is not there', async () => {
    expect(await runWith(404)).not.toHaveBeenCalled();
  });

  it('does not run when Panel says the trigger belongs to somebody else', async () => {
    expect(await runWith(403)).not.toHaveBeenCalled();
  });

  it('runs when Panel is broken, because that is not an answer', async () => {
    // Skipping on a 500 would drop a real trigger every time Panel wobbles.
    expect(await runWith(500)).toHaveBeenCalledTimes(1);
  });

  it('runs when Panel cannot be reached at all', async () => {
    const invokeRun = vi.fn<InvokeRun>(async () => ({ status: 'completed', runId: 'r' }));
    const fetchFn = vi.fn(async () => {
      throw new Error('network down');
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
    emitter.emit('run_trigger', makeRunTrigger());
    await new Promise((resolve) => setTimeout(resolve, 50));
    handler.stop();

    expect(invokeRun).toHaveBeenCalledTimes(1);
  });
});
