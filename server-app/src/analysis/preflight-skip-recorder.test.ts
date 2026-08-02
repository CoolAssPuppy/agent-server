import { describe, expect, it } from 'vitest';
import { makeAgent } from '../test-factories.js';
import { RunStore } from '../reporting/store.js';
import { PreflightSkipRecorder } from './preflight-skip-recorder.js';

describe('automatic preflight skips', () => {
  it('records one clear skipped run per unchanged blocked configuration', () => {
    const store = new RunStore();
    const recorder = new PreflightSkipRecorder(store, {
      createRunId: (() => {
        let value = 0;
        return () => `skip-${value += 1}`;
      })(),
      now: () => new Date('2026-07-18T12:00:00Z'),
    });
    const agent = makeAgent({ id: 'scheduled-report', name: 'Scheduled report' });
    const blocked = {
      allowed: false as const,
      code: 'review_required' as const,
      message: 'Security review is required before this agent can run automatically.',
      contentHash: `sha256:${'a'.repeat(64)}`,
    };

    expect(recorder.record(agent, blocked, 'schedule')).toBe('skip-1');
    expect(recorder.record(agent, blocked, 'schedule')).toBeUndefined();
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]).toMatchObject({
      status: 'skipped',
      code: 'security_preflight_review_required',
      summary: 'Scheduled run skipped pending security review',
      error: blocked.message,
      progressMessages: ['Security review required before automatic run.'],
    });

    expect(recorder.record(agent, { ...blocked, contentHash: `sha256:${'b'.repeat(64)}` }, 'schedule')).toBe('skip-2');
    expect(store.list()).toHaveLength(2);
  });

  it('clears deduplication after a configuration becomes allowed', () => {
    const store = new RunStore();
    const recorder = new PreflightSkipRecorder(store);
    const agent = makeAgent();
    const blocked = {
      allowed: false as const,
      code: 'blocked' as const,
      message: 'Critical risk',
      contentHash: `sha256:${'a'.repeat(64)}`,
    };
    recorder.record(agent, blocked, 'watcher');
    recorder.clear(agent.id);
    expect(recorder.record(agent, blocked, 'watcher')).toBeDefined();
  });

  it('evicts the oldest denial after five hundred tracked agents', () => {
    const store = new RunStore(600);
    let runCount = 0;
    const recorder = new PreflightSkipRecorder(store, { createRunId: () => `skip-${runCount += 1}` });
    const blocked = {
      allowed: false as const,
      code: 'review_required' as const,
      message: 'Review required',
      contentHash: `sha256:${'a'.repeat(64)}`,
    };
    for (let index = 0; index < 501; index += 1) {
      recorder.record(makeAgent({ id: `agent-${index}` }), blocked, 'schedule');
    }
    expect(recorder.record(makeAgent({ id: 'agent-0' }), blocked, 'schedule')).toBeDefined();
  });
});
