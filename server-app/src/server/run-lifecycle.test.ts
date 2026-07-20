import { describe, expect, it, vi } from 'vitest';
import type { Reporter, RunResult } from '../execution/runner.js';
import { RunStore } from '../reporting/store.js';
import { makeAgent, makeExecutionResult } from '../test-factories.js';
import { ProgressBroadcaster, type ProgressEvent } from './websocket.js';
import { createRunLifecycle } from './run-lifecycle.js';

const reporter: Reporter = {
  start: vi.fn(),
  progress: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  stop: vi.fn(),
};

function createHarness(
  runResult?: RunResult,
  executionResult = makeExecutionResult({
    summary: 'Created report',
    filesWritten: ['/tmp/report.md'],
  }),
  onInteraction = vi.fn(),
) {
  const store = new RunStore();
  const broadcaster = new ProgressBroadcaster();
  const events: ProgressEvent[] = [];
  broadcaster.subscribe((event) => events.push(event));
  const notify = vi.fn();
  const onTerminal = vi.fn();
  const createReporter = vi.fn(() => reporter);
  const lifecycle = createRunLifecycle({
    maxConcurrentRuns: 2,
    lockDir: '/tmp/agent-server-lifecycle-test-locks',
    runTimeoutMs: 30_000,
    store,
    broadcaster,
    execute: vi.fn().mockResolvedValue(executionResult),
    createReporter,
    run: vi.fn(async (options) => {
      const activeReporter = options.createReporter(
        options.runId ?? 'missing-run-id',
        options.agent.name,
        options.conversationId,
      );
      if (runResult?.status === 'failed') {
        await options.execute(options.agent, activeReporter, {
          runId: options.runId ?? 'missing-run-id',
        });
        return runResult;
      }
      if (runResult) return runResult;
      const result = await options.execute(options.agent, activeReporter, {
        runId: options.runId ?? 'missing-run-id',
      });
      return { runId: options.runId, status: 'completed', result };
    }),
    notify,
    onInteraction,
    onTerminal,
  });

  return {
    lifecycle,
    store,
    events,
    notify,
    onTerminal,
    onInteraction,
    createReporter,
    executionResult,
  };
}

describe('run lifecycle', () => {
  it('records and broadcasts a run through its terminal state', async () => {
    const { lifecycle, store, events, notify, onTerminal } = createHarness();
    const agent = makeAgent();

    const runId = lifecycle.trigger(agent);
    await lifecycle.waitForTerminal(runId);

    expect(store.get(runId)).toMatchObject({
      status: 'completed',
      summary: 'Created report',
      filesWritten: ['/tmp/report.md'],
    });
    expect(events.map((event) => event.type)).toEqual(['run_started', 'run_completed']);
    expect(notify).toHaveBeenCalledWith(agent, runId, expect.objectContaining({
      status: 'completed',
      summary: 'Created report',
    }));
    expect(onTerminal).toHaveBeenCalledWith(agent, 'completed', undefined);
  });

  it('keeps safe tests isolated from downstream triggers', async () => {
    const { lifecycle, onTerminal } = createHarness();

    const runId = lifecycle.trigger(makeAgent(), { mode: 'safe_test' });
    await lifecycle.waitForTerminal(runId);

    expect(onTerminal).not.toHaveBeenCalled();
  });

  it('records which messaging service owns a conversation run', async () => {
    const { lifecycle, store } = createHarness();

    const runId = lifecycle.trigger(makeAgent(), {
      conversationId: 'conversation-42',
      conversationChannel: 'slack',
    });
    await lifecycle.waitForTerminal(runId);

    expect(store.get(runId)).toMatchObject({
      conversationId: 'conversation-42',
      conversationChannel: 'slack',
    });
  });

  it('records runner failures and invokes the failure hooks once', async () => {
    const failure: RunResult = {
      status: 'failed',
      error: 'Connection unavailable',
      code: 'output_contract_unmet',
    };
    const { lifecycle, store, events, notify, onTerminal } = createHarness(failure);
    const agent = makeAgent();

    const runId = lifecycle.trigger(agent);
    await lifecycle.waitForTerminal(runId);

    expect(store.get(runId)).toMatchObject({
      status: 'failed',
      error: 'Connection unavailable',
      code: 'output_contract_unmet',
    });
    expect(events.map((event) => event.type)).toEqual(['run_started', 'run_failed']);
    expect(notify).toHaveBeenCalledWith(agent, runId, {
      status: 'failed',
      error: 'Connection unavailable',
    });
    expect(onTerminal).toHaveBeenCalledWith(agent, 'failed', undefined);
  });

  it('forwards trigger ancestry through the terminal hook', async () => {
    const { lifecycle, onTerminal } = createHarness();
    const agent = makeAgent({ id: 'downstream' });
    const chain = {
      id: 'chain-1',
      visitedAgentIds: ['source', 'downstream'],
      depth: 1,
    };

    const runId = lifecycle.trigger(agent, { chain });
    await lifecycle.waitForTerminal(runId);

    expect(onTerminal).toHaveBeenCalledWith(agent, 'completed', chain);
  });

  it('does not record executor completion until the runner accepts the result', async () => {
    const failure: RunResult = {
      status: 'failed',
      error: 'The agent finished without creating its required output.',
      code: 'output_contract_unmet',
    };
    const { lifecycle, store, events, notify } = createHarness(failure);

    const runId = lifecycle.trigger(makeAgent());
    await lifecycle.waitForTerminal(runId);

    expect(store.get(runId)).toMatchObject({ status: 'failed', code: 'output_contract_unmet' });
    expect(events.map((event) => event.type)).toEqual(['run_started', 'run_failed']);
    expect(notify).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('closes every lifecycle hook when a concurrent run is skipped', async () => {
    const skipped: RunResult = {
      status: 'skipped',
      code: 'lock_contention',
      error: 'This run was skipped because Test Agent is already running.',
    };
    const { lifecycle, store, events, notify, onTerminal } = createHarness(skipped);
    const onDone = vi.fn();
    const agent = makeAgent();

    const runId = lifecycle.trigger(agent, { onDone });
    await lifecycle.waitForTerminal(runId);

    expect(store.get(runId)).toMatchObject({
      status: 'skipped',
      code: 'lock_contention',
      summary: 'This run was skipped because Test Agent is already running.',
      error: 'This run was skipped because Test Agent is already running.',
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'run_skipped',
      runId,
      code: 'lock_contention',
    }));
    expect(notify).toHaveBeenCalledWith(agent, runId, {
      status: 'skipped',
      error: 'This run was skipped because Test Agent is already running.',
    });
    expect(onDone).toHaveBeenCalledWith({
      status: 'skipped',
      error: 'This run was skipped because Test Agent is already running.',
    });
    expect(onTerminal).toHaveBeenCalledWith(agent, 'skipped', undefined);
  });

  it('waits for interaction delivery before marking a run complete', async () => {
    let finishDelivery: (() => void) | undefined;
    const onInteraction = vi.fn(() => new Promise<void>((resolve) => {
      finishDelivery = resolve;
    }));
    const result = makeExecutionResult({
      interaction: { message: 'Choose a time', options: [], freeText: true },
    });
    const { lifecycle, store, events } = createHarness(undefined, result, onInteraction);
    const agent = makeAgent({
      interaction: { channel: 'telegram', on_reply: 'reply-agent', timeout: '30m' },
    });

    const runId = lifecycle.trigger(agent);
    await vi.waitFor(() => expect(onInteraction).toHaveBeenCalled());

    expect(store.get(runId)?.status).toBe('running');
    expect(events.map((event) => event.type)).toEqual(['run_started']);

    finishDelivery?.();
    await lifecycle.waitForTerminal(runId);

    expect(store.get(runId)?.status).toBe('completed');
    expect(events.map((event) => event.type)).toEqual(['run_started', 'run_completed']);
  });

  it('records interaction delivery rejection as a terminal failure', async () => {
    const onInteraction = vi.fn().mockRejectedValue(new Error('Telegram unavailable'));
    const result = makeExecutionResult({
      interaction: { message: 'Choose a time', options: [], freeText: true },
    });
    const { lifecycle, store, events, notify, onTerminal } = createHarness(
      undefined,
      result,
      onInteraction,
    );
    const agent = makeAgent({
      interaction: { channel: 'telegram', on_reply: 'reply-agent', timeout: '30m' },
    });

    const runId = lifecycle.trigger(agent);
    await lifecycle.waitForTerminal(runId);

    expect(store.get(runId)).toMatchObject({
      status: 'failed',
      error: 'Telegram unavailable',
    });
    expect(events.map((event) => event.type)).toEqual(['run_started', 'run_failed']);
    expect(notify).toHaveBeenCalledWith(agent, runId, {
      status: 'failed',
      error: 'Telegram unavailable',
    });
    expect(onTerminal).toHaveBeenCalledWith(agent, 'failed', undefined);
  });

  it('preserves agent telemetry context for reporter creation', async () => {
    const { lifecycle, createReporter } = createHarness();
    const agent = makeAgent({ telemetry: { progress_mode: 'batched' } });

    const runId = lifecycle.trigger(agent);
    await lifecycle.waitForTerminal(runId);

    expect(createReporter).toHaveBeenCalledWith(runId, agent.name, undefined, agent);
  });

  it('records completion when an executor omits optional runtime usage data', async () => {
    const result = makeExecutionResult({ summary: 'No telemetry' });
    Reflect.deleteProperty(result, 'usage');
    const harness = createHarness(undefined, result);

    const runId = harness.lifecycle.trigger(makeAgent());
    await harness.lifecycle.waitForTerminal(runId);

    expect(harness.store.get(runId)).toMatchObject({ status: 'completed', summary: 'No telemetry' });
  });

  it('aborts active runs and drains their terminal bookkeeping', async () => {
    let finishRun: ((result: RunResult) => void) | undefined;
    const run = vi.fn(() => new Promise<RunResult>((resolve) => {
      finishRun = resolve;
    }));
    const store = new RunStore();
    const lifecycle = createRunLifecycle({
      maxConcurrentRuns: 1,
      lockDir: '/tmp/agent-server-lifecycle-test-locks',
      runTimeoutMs: 30_000,
      store,
      broadcaster: new ProgressBroadcaster(),
      execute: vi.fn(),
      createReporter: () => reporter,
      run,
      notify: vi.fn(),
      onInteraction: vi.fn(),
      onTerminal: vi.fn(),
    });

    const runId = lifecycle.trigger(makeAgent());
    expect(lifecycle.cancel(runId)).toBe(true);
    finishRun?.({ runId, status: 'failed', error: 'Canceled' });
    await lifecycle.drain({ overallTimeoutMs: 100, perRunTimeoutMs: 100 });

    expect(store.get(runId)).toMatchObject({ status: 'failed', error: 'Canceled' });
    expect(lifecycle.cancel(runId)).toBe(false);
  });
});
