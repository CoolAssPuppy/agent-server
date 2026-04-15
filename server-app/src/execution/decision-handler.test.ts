import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import {
  awaitResolution,
  formatResolution,
  postDecision,
  type DecisionResolutionPayload,
  type SseEventBus,
} from './decision-handler.js';
import type { DecisionInput } from '../interaction/schema.js';

function makeBus(): SseEventBus {
  return new EventEmitter() as SseEventBus;
}

describe('awaitResolution', () => {
  it('resolves when a matching decision_resolved event arrives', async () => {
    const bus = makeBus();
    const promise = awaitResolution({
      decisionId: 'dec-1',
      eventBus: bus,
    });

    setImmediate(() => {
      bus.emit('decision_resolved', {
        id: 1,
        type: 'decision_resolved',
        decision_id: 'dec-1',
        task_run_id: 'run-1',
        resolution: { action_id: 'approve' },
      });
    });

    const resolution = await promise;
    expect(resolution.action_id).toBe('approve');
  });

  it('ignores events for other decisions', async () => {
    const bus = makeBus();
    const promise = awaitResolution({
      decisionId: 'dec-1',
      eventBus: bus,
      timeoutMs: 50,
    });

    bus.emit('decision_resolved', {
      id: 1,
      type: 'decision_resolved',
      decision_id: 'dec-OTHER',
      task_run_id: 'run-1',
      resolution: { action_id: 'approve' },
    });

    await expect(promise).rejects.toThrow('Decision timed out');
  });

  it('rejects with timeout after timeoutMs', async () => {
    const bus = makeBus();
    await expect(
      awaitResolution({ decisionId: 'dec-x', eventBus: bus, timeoutMs: 20 }),
    ).rejects.toThrow('Decision timed out');
  });

  it('removes listener after resolving', async () => {
    const bus = makeBus();
    const promise = awaitResolution({ decisionId: 'dec-1', eventBus: bus });

    bus.emit('decision_resolved', {
      id: 1,
      type: 'decision_resolved',
      decision_id: 'dec-1',
      task_run_id: 'run-1',
      resolution: { action_id: 'approve' },
    });
    await promise;
    expect((bus as EventEmitter).listenerCount('decision_resolved')).toBe(0);
  });

  it('removes listener after timing out', async () => {
    const bus = makeBus();
    await expect(
      awaitResolution({ decisionId: 'dec-1', eventBus: bus, timeoutMs: 10 }),
    ).rejects.toThrow('Decision timed out');
    expect((bus as EventEmitter).listenerCount('decision_resolved')).toBe(0);
  });
});

describe('formatResolution', () => {
  it('formats approve=approved with approve_label', () => {
    const decision: DecisionInput = {
      type: 'approve',
      title: 't',
      approve_label: 'Ship it',
      sources: [],
    };
    const res: DecisionResolutionPayload = { action_id: 'approve' };
    expect(formatResolution(res, decision)).toBe('User approved: Ship it.');
  });

  it('formats approve=declined with decline_label', () => {
    const decision: DecisionInput = {
      type: 'approve',
      title: 't',
      decline_label: 'Nope',
      sources: [],
    };
    const res: DecisionResolutionPayload = { action_id: 'decline' };
    expect(formatResolution(res, decision)).toBe('User declined: Nope.');
  });

  it('falls back to default labels when missing', () => {
    const decision: DecisionInput = { type: 'approve', title: 't', sources: [] };
    expect(formatResolution({ action_id: 'approve' }, decision)).toBe('User approved: Approve.');
    expect(formatResolution({ action_id: 'decline' }, decision)).toBe('User declined: Decline.');
  });

  it('formats pick with option label', () => {
    const decision: DecisionInput = {
      type: 'pick',
      title: 't',
      sources: [],
      options: [
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Beta' },
      ],
    };
    expect(formatResolution({ action_id: 'b' }, decision)).toBe('User picked: Beta.');
  });

  it('formats pick with unknown option id falls back to id', () => {
    const decision: DecisionInput = {
      type: 'pick',
      title: 't',
      sources: [],
      options: [
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Beta' },
      ],
    };
    expect(formatResolution({ action_id: 'c' }, decision)).toBe('User picked: c.');
  });

  it('formats pick none selected', () => {
    const decision: DecisionInput = {
      type: 'pick',
      title: 't',
      sources: [],
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    };
    expect(formatResolution({ action_id: 'none' }, decision)).toBe('User chose none of the provided options.');
  });

  it('formats answer with input text', () => {
    const decision: DecisionInput = {
      type: 'answer',
      title: 't',
      prompt: 'What?',
      sources: [],
    };
    expect(
      formatResolution({ action_id: 'answer', input: 'banana' }, decision),
    ).toBe('User answered: banana');
  });
});

describe('runDecisionCycle', () => {
  it('posts decision, awaits resolution, returns formatted resumption text', async () => {
    const { runDecisionCycle } = await import('./decision-handler.js');
    const bus = makeBus();
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ decision_id: 'dec-99' }),
    });

    const decision: DecisionInput = {
      type: 'approve',
      title: 'ok?',
      approve_label: 'Yes',
      sources: [],
    };

    const promise = runDecisionCycle(decision, {
      runId: 'r1',
      panelUrl: 'https://p',
      panelApiKey: 'k',
      eventBus: bus,
      fetch: fetchFn,
    });

    setImmediate(() => {
      bus.emit('decision_resolved', {
        id: 1,
        type: 'decision_resolved',
        decision_id: 'dec-99',
        task_run_id: 'r1',
        resolution: { action_id: 'approve' },
      });
    });

    const outcome = await promise;
    expect(outcome.status).toBe('resolved');
    if (outcome.status === 'resolved') {
      expect(outcome.resumptionText).toBe('User approved: Yes.');
    }
  });

  it('returns timeout without posting a failed state (runner handles failure via reporter)', async () => {
    const { runDecisionCycle } = await import('./decision-handler.js');
    const bus = makeBus();
    const fetchFn = vi.fn()
      // only call: postDecision. No second POST — the runner/reporter is
      // responsible for the terminal failed event to avoid double-terminal.
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ decision_id: 'dec-T' }),
      });

    const decision: DecisionInput = {
      type: 'approve',
      title: 't',
      sources: [],
      due_at: new Date(Date.now() - 10 * 60_000).toISOString(), // far past → clamped to 1ms timeout
    };

    const outcome = await runDecisionCycle(decision, {
      runId: 'r1',
      panelUrl: 'https://p',
      panelApiKey: 'k',
      eventBus: bus,
      fetch: fetchFn,
    });

    expect(outcome.status).toBe('timeout');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const firstCallBody = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(firstCallBody.state).toBe('input_required');
  });
});

describe('postDecision', () => {
  it('POSTs to /api/runs/{runId}/status and returns decision_id', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ decision_id: 'dec-42' }),
    });

    const decision: DecisionInput = { type: 'approve', title: 'ok?', sources: [] };
    const id = await postDecision({
      runId: 'run-1',
      decision,
      panelUrl: 'https://panel.example',
      panelApiKey: 'key-abc',
      fetch: fetchFn,
    });

    expect(id).toBe('dec-42');
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://panel.example/api/runs/run-1/status');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer key-abc');
    const body = JSON.parse(init.body);
    expect(body.state).toBe('input_required');
    expect(body.decision).toEqual(decision);
  });

  it('throws when the panel returns non-ok', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    });
    const decision: DecisionInput = { type: 'approve', title: 'ok?', sources: [] };

    await expect(
      postDecision({
        runId: 'run-1',
        decision,
        panelUrl: 'https://p',
        panelApiKey: 'k',
        fetch: fetchFn,
      }),
    ).rejects.toThrow(/500/);
  });
});
