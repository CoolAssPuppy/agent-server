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
      if (runResult) return runResult;
      const activeReporter = options.createReporter(
        options.runId ?? 'missing-run-id',
        options.agent.name,
        options.conversationId,
      );
      const result = await options.execute(options.agent, activeReporter, {
        runId: options.runId ?? 'missing-run-id',
      });
      return { runId: options.runId, status: 'completed', result };
    }),
    notify,
    onInteraction: vi.fn(),
    onTerminal,
  });

  return { lifecycle, store, events, notify, onTerminal, createReporter, executionResult };
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
    expect(onTerminal).toHaveBeenCalledWith(agent, 'completed');
  });

  it('keeps safe tests isolated from downstream triggers', async () => {
    const { lifecycle, onTerminal } = createHarness();

    const runId = lifecycle.trigger(makeAgent(), { mode: 'safe_test' });
    await lifecycle.waitForTerminal(runId);

    expect(onTerminal).not.toHaveBeenCalled();
  });

  it('records runner failures and invokes the failure hooks once', async () => {
    const failure: RunResult = { status: 'failed', error: 'Connection unavailable' };
    const { lifecycle, store, events, notify, onTerminal } = createHarness(failure);
    const agent = makeAgent();

    const runId = lifecycle.trigger(agent);
    await lifecycle.waitForTerminal(runId);

    expect(store.get(runId)).toMatchObject({
      status: 'failed',
      error: 'Connection unavailable',
    });
    expect(events.map((event) => event.type)).toEqual(['run_started', 'run_failed']);
    expect(notify).toHaveBeenCalledWith(agent, runId, {
      status: 'failed',
      error: 'Connection unavailable',
    });
    expect(onTerminal).toHaveBeenCalledWith(agent, 'failed');
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
