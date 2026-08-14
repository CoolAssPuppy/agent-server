import { describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { runAgent, type Reporter, type RunResult } from '../execution/runner.js';
import { RunStore } from '../reporting/store.js';
import { AgentLogger, AgentLogStore } from '../logging/index.js';
import {
  createTempDir,
  makeAgent,
  makeExecutionResult,
  makeRecordingAnalytics,
  makeStoredRun,
} from '../test-factories.js';
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
  now?: () => Date,
) {
  const store = new RunStore();
  const broadcaster = new ProgressBroadcaster();
  const events: ProgressEvent[] = [];
  broadcaster.subscribe((event) => events.push(event));
  const notify = vi.fn();
  const onTerminal = vi.fn();
  const createReporter = vi.fn(() => reporter);
  const run = vi.fn(async (options) => {
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
    return { runId: options.runId, status: 'completed' as const, result };
  });
  const analytics = makeRecordingAnalytics();
  const lifecycle = createRunLifecycle({
    analytics,
    maxConcurrentRuns: 2,
    lockDir: '/tmp/agent-server-lifecycle-test-locks',
    runTimeoutMs: 30_000,
    store,
    broadcaster,
    execute: vi.fn().mockResolvedValue(executionResult),
    createReporter,
    run,
    notify,
    onInteraction,
    onTerminal,
    now,
  });

  return {
    analytics,
    lifecycle,
    store,
    events,
    notify,
    onTerminal,
    onInteraction,
    createReporter,
    executionResult,
    run,
  };
}

describe('run lifecycle', () => {
  it('skips an opted-in agent that already completed on the same local calendar day', async () => {
    const now = new Date('2026-07-21T10:00:00.000Z');
    const harness = createHarness(undefined, undefined, undefined, () => now);
    const agent = makeAgent({
      id: 'daily-focus',
      timezone: 'Europe/Lisbon',
      rerun_policy: 'skip_if_completed_today',
    });
    harness.store.add(makeStoredRun({
      runId: 'earlier-run',
      agentId: agent.id,
      status: 'completed',
      startedAt: new Date('2026-07-20T23:30:00.000Z'),
      completedAt: new Date('2026-07-21T00:00:00.000Z'),
    }));

    const runId = harness.lifecycle.trigger(agent);
    await harness.lifecycle.waitForTerminal(runId);

    expect(harness.run).not.toHaveBeenCalled();
    expect(harness.store.get(runId)).toMatchObject({
      status: 'skipped',
      code: 'already_completed_today',
      summary: 'Already completed today.',
      error: 'Already completed today.',
    });
    expect(harness.events.map((event) => event.type)).toEqual(['run_started', 'run_skipped']);
  });

  it('runs an opted-in agent when its last completion was on the prior local day', async () => {
    const now = new Date('2026-07-21T10:00:00.000Z');
    const harness = createHarness(undefined, undefined, undefined, () => now);
    const agent = makeAgent({
      id: 'daily-focus',
      timezone: 'Europe/Lisbon',
      rerun_policy: 'skip_if_completed_today',
    });
    harness.store.add(makeStoredRun({
      runId: 'yesterday-run',
      agentId: agent.id,
      status: 'completed',
      startedAt: new Date('2026-07-20T20:00:00.000Z'),
      completedAt: new Date('2026-07-20T21:00:00.000Z'),
    }));

    const runId = harness.lifecycle.trigger(agent);
    await harness.lifecycle.waitForTerminal(runId);

    expect(harness.run).toHaveBeenCalledOnce();
    expect(harness.store.get(runId)?.status).toBe('completed');
  });

  it('runs instead of stranding history when an opted-in agent has an invalid timezone', async () => {
    const harness = createHarness();
    const agent = makeAgent({
      id: 'daily-focus',
      timezone: 'Not/A-Timezone',
      rerun_policy: 'skip_if_completed_today',
    });
    harness.store.add(makeStoredRun({
      runId: 'earlier-run',
      agentId: agent.id,
      status: 'completed',
    }));

    const runId = harness.lifecycle.trigger(agent);
    await harness.lifecycle.waitForTerminal(runId);

    expect(harness.run).toHaveBeenCalledOnce();
    expect(harness.store.get(runId)?.status).toBe('completed');
  });

  it('does not apply a daily rerun policy to safe tests or contextual runs', async () => {
    const now = new Date('2026-07-21T10:00:00.000Z');
    const harness = createHarness(undefined, undefined, undefined, () => now);
    const agent = makeAgent({
      id: 'daily-focus',
      timezone: 'Europe/Lisbon',
      rerun_policy: 'skip_if_completed_today',
    });
    harness.store.add(makeStoredRun({
      runId: 'earlier-run',
      agentId: agent.id,
      status: 'completed',
      completedAt: new Date('2026-07-21T07:00:00.000Z'),
    }));

    const safeTestId = harness.lifecycle.trigger(agent, { mode: 'safe_test' });
    await harness.lifecycle.waitForTerminal(safeTestId);
    const contextualId = harness.lifecycle.trigger(agent, { promptSuffix: 'Use this new context.' });
    await harness.lifecycle.waitForTerminal(contextualId);

    expect(harness.run).toHaveBeenCalledTimes(2);
    expect(harness.store.get(safeTestId)?.status).toBe('completed');
    expect(harness.store.get(contextualId)?.status).toBe('completed');
  });

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

  it('records a factual safe-test result instead of claiming the assistant is ready', async () => {
    const harness = createHarness(undefined, {
        summary: 'Everything looks good and is ready.',
        output: {},
        usage: {},
        turnCount: 1,
        toolsUsed: ['Read'],
        filesRead: ['/Users/test/Reference/notes.md'],
        filesWritten: [],
        commandsRun: [],
    });
    const runId = harness.lifecycle.trigger(makeAgent(), { mode: 'safe_test' });

    await vi.waitFor(() => expect(harness.store.get(runId)?.status).toBe('completed'));

    expect(harness.store.get(runId)?.summary).toBe(
      'Safe test finished. It read notes.md from its reviewed local files. External actions were not performed. '
      + 'File creation, command execution, messages, and connected-service changes were blocked.',
    );
    expect(harness.store.get(runId)?.summary).not.toContain('ready');
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
    const run = vi.fn((options: Parameters<typeof runAgent>[0]) => new Promise<RunResult>((resolve) => {
      options.abortController?.signal.addEventListener('abort', () => {
        const reason = options.abortController?.signal.reason;
        const code = reason && typeof reason === 'object' && 'code' in reason
          ? String(reason.code)
          : undefined;
        resolve({ runId: options.runId, status: 'failed', error: 'Canceled', code });
      });
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
    await lifecycle.drain({ overallTimeoutMs: 100, perRunTimeoutMs: 100 });

    expect(store.get(runId)).toMatchObject({
      status: 'failed',
      error: 'Canceled',
      code: 'user_canceled',
    });
    expect(lifecycle.cancel(runId)).toBe(false);
  });

  it('rejects new runs as soon as shutdown admission closes', async () => {
    const { lifecycle, store } = createHarness();

    lifecycle.stopAccepting();

    expect(() => lifecycle.trigger(makeAgent())).toThrow('Server is shutting down.');
    expect(store.list()).toEqual([]);
  });

  it('lets active runs finish during the shutdown grace period without aborting them', async () => {
    let finishRun: ((result: RunResult) => void) | undefined;
    let abortCount = 0;
    const run = vi.fn((options: Parameters<typeof runAgent>[0]) => new Promise<RunResult>((resolve) => {
      finishRun = resolve;
      options.abortController?.signal.addEventListener('abort', () => { abortCount += 1; });
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
    lifecycle.stopAccepting();
    const draining = lifecycle.drain({
      graceTimeoutMs: 100,
      overallTimeoutMs: 100,
      perRunTimeoutMs: 100,
    });
    finishRun?.({ runId, status: 'failed', error: 'Finished naturally' });

    await expect(draining).resolves.toBe(true);
    expect(abortCount).toBe(0);
  });

  it('cancels only runs left after the shutdown grace period with a stable reason', async () => {
    vi.useFakeTimers();
    try {
      let shutdownCode: string | undefined;
      const run = vi.fn((options: Parameters<typeof runAgent>[0]) => new Promise<RunResult>((resolve) => {
        options.abortController?.signal.addEventListener('abort', () => {
          const reason = options.abortController?.signal.reason;
          shutdownCode = reason && typeof reason === 'object' && 'code' in reason
            ? String(reason.code)
            : undefined;
          resolve({ runId: options.runId, status: 'failed', error: 'Stopped', code: shutdownCode });
        });
      }));
      const lifecycle = createRunLifecycle({
        maxConcurrentRuns: 1,
        lockDir: '/tmp/agent-server-lifecycle-test-locks',
        runTimeoutMs: 30_000,
        store: new RunStore(),
        broadcaster: new ProgressBroadcaster(),
        execute: vi.fn(),
        createReporter: () => reporter,
        run,
        notify: vi.fn(),
        onInteraction: vi.fn(),
        onTerminal: vi.fn(),
      });

      lifecycle.trigger(makeAgent());
      const draining = lifecycle.drain({
        graceTimeoutMs: 50,
        overallTimeoutMs: 100,
        perRunTimeoutMs: 100,
      });
      await vi.advanceTimersByTimeAsync(50);

      await expect(draining).resolves.toBe(true);
      expect(shutdownCode).toBe('server_shutdown');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports when terminal work remains after the bounded drain', async () => {
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
    lifecycle.stopAccepting();

    await expect(lifecycle.drain({ overallTimeoutMs: 5, perRunTimeoutMs: 5 }))
      .resolves.toBe(false);
    finishRun?.({ runId, status: 'failed', error: 'Canceled' });
    await lifecycle.waitForTerminal(runId);

    expect(store.get(runId)).toMatchObject({ status: 'failed', error: 'Canceled' });
  });

  it('clears losing shutdown timers when terminal work drains early', async () => {
    vi.useFakeTimers();
    try {
      const { lifecycle } = createHarness();
      lifecycle.trigger(makeAgent());

      await expect(lifecycle.drain({ overallTimeoutMs: 10_000, perRunTimeoutMs: 3_000 }))
        .resolves.toBe(true);

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('run lifecycle analytics', () => {
  it('records a dispatched run with its shape and no user content', async () => {
    const harness = createHarness();
    const agent = makeAgent({ id: 'daily-report', executor: 'codex', prompt: 'Email finance.' });

    const runId = harness.lifecycle.trigger(agent);
    await harness.lifecycle.waitForTerminal(runId);

    expect(harness.analytics.find('agent_run_dispatched')?.properties).toEqual({
      agent_id: 'daily-report',
      executor: 'codex',
      mode: 'normal',
      scheduled: true,
      chained: false,
      conversational: false,
      retry: false,
    });
  });

  it('records a settled run with its outcome and effort', async () => {
    const harness = createHarness();

    const runId = harness.lifecycle.trigger(makeAgent({ id: 'daily-report' }));
    await harness.lifecycle.waitForTerminal(runId);

    expect(harness.analytics.find('agent_run_settled')?.properties).toMatchObject({
      agent_id: 'daily-report',
      status: 'completed',
      turn_count: 3,
      tool_count: 1,
    });
  });

  it('records a failed run by its code rather than its message', async () => {
    const harness = createHarness({
      runId: 'run-1',
      status: 'failed',
      error: 'Agent could not read /Users/sam/notes.md',
      code: 'lock_contention',
    });

    const runId = harness.lifecycle.trigger(makeAgent({ id: 'daily-report' }));
    await harness.lifecycle.waitForTerminal(runId);

    const settled = harness.analytics.find('agent_run_settled');
    expect(settled?.properties).toMatchObject({ status: 'failed', code: 'lock_contention' });
    expect(JSON.stringify(settled?.properties)).not.toContain('notes.md');
  });

  it('records a run rejected by the concurrency ceiling', async () => {
    const harness = createHarness();
    const agent = makeAgent({ id: 'busy' });

    harness.lifecycle.trigger(agent);
    harness.lifecycle.trigger(agent);
    expect(() => harness.lifecycle.trigger(agent)).toThrow('Too many active runs');

    expect(harness.analytics.find('agent_run_rejected')?.properties).toMatchObject({
      agent_id: 'busy',
      reason: 'concurrency_limit',
      active_runs: 2,
    });
  });

  it('tells the executor which run it is, so the agent log tool is bound to this run', async () => {
    const lockDir = createTempDir('lifecycle-locks');
    const execute = vi.fn().mockResolvedValue(makeExecutionResult({ summary: 'Done' }));
    const store = new RunStore();
    const lifecycle = createRunLifecycle({
      maxConcurrentRuns: 2,
      lockDir,
      runTimeoutMs: 30_000,
      store,
      broadcaster: new ProgressBroadcaster(),
      execute,
      createReporter: () => reporter,
      notify: vi.fn(),
      onInteraction: vi.fn(),
      onTerminal: vi.fn(),
    });

    const runId = lifecycle.trigger(makeAgent({ id: 'daily-manuscript-review' }));
    await lifecycle.waitForTerminal(runId);
    rmSync(lockDir, { recursive: true, force: true });

    expect(execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ runId }),
    );
  });

  it('fails a run whose agent logged its own failure', async () => {
    const lockDir = createTempDir('lifecycle-locks');
    const logRoot = createTempDir('lifecycle-logs');
    const logger = new AgentLogger({
      readsFrom: new AgentLogStore({ root: logRoot }),
      machineId: 'machine-uuid',
      hostname: 'test-mac',
    });
    const store = new RunStore();
    const lifecycle = createRunLifecycle({
      maxConcurrentRuns: 2,
      lockDir,
      runTimeoutMs: 30_000,
      store,
      broadcaster: new ProgressBroadcaster(),
      logger,
      execute: async (agent, _reporter, options) => {
        logger.append({
          agentId: agent.id,
          runId: options?.runId ?? 'missing-run-id',
          level: 'error',
          message: 'Stopped. The run cannot proceed.',
          source: 'agent',
        });
        return makeExecutionResult({ summary: 'Stopped. The run cannot proceed.' });
      },
      createReporter: () => reporter,
      notify: vi.fn(),
      onInteraction: vi.fn(),
      onTerminal: vi.fn(),
    });

    const runId = lifecycle.trigger(makeAgent({ id: 'daily-manuscript-review' }));
    await lifecycle.waitForTerminal(runId);
    rmSync(lockDir, { recursive: true, force: true });
    rmSync(logRoot, { recursive: true, force: true });

    expect(store.get(runId)).toMatchObject({
      status: 'failed',
      error: 'The agent logged a failure: Stopped. The run cannot proceed.',
    });
  });

  it('records a run rejected because the server is shutting down', () => {
    const harness = createHarness();
    harness.lifecycle.stopAccepting();

    expect(() => harness.lifecycle.trigger(makeAgent({ id: 'late' }))).toThrow('shutting down');

    expect(harness.analytics.find('agent_run_rejected')?.properties).toMatchObject({
      reason: 'shutting_down',
    });
  });
});
