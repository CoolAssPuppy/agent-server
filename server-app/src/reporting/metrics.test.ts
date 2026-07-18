import { describe, it, expect } from 'vitest';
import { computeAgentMetrics } from './metrics.js';
import { makeStoredRun } from '../test-factories.js';

describe('computeAgentMetrics', () => {
  it('returns an empty list for no runs', () => {
    expect(computeAgentMetrics([])).toEqual([]);
  });

  it('counts outcomes and computes success rate per agent', () => {
    const runs = [
      makeStoredRun({ runId: 'a1', agentId: 'a', status: 'completed' }),
      makeStoredRun({ runId: 'a2', agentId: 'a', status: 'completed' }),
      makeStoredRun({ runId: 'a3', agentId: 'a', status: 'failed' }),
      makeStoredRun({ runId: 'a4', agentId: 'a', status: 'skipped' }),
      makeStoredRun({ runId: 'a5', agentId: 'a', status: 'running' }),
    ];
    const [m] = computeAgentMetrics(runs);
    expect(m.agentId).toBe('a');
    expect(m.totalRuns).toBe(5);
    expect(m.completed).toBe(2);
    expect(m.failed).toBe(1);
    expect(m.skipped).toBe(1);
    expect(m.running).toBe(1);
    expect(m.successRate).toBeCloseTo(2 / 3);
  });

  it('averages duration and sums cost only over runs that recorded them', () => {
    const runs = [
      makeStoredRun({ runId: 'r1', agentId: 'a', status: 'completed', durationMs: 1000, estimatedCostUsd: 0.02 }),
      makeStoredRun({ runId: 'r2', agentId: 'a', status: 'completed', durationMs: 3000, estimatedCostUsd: 0.04 }),
      makeStoredRun({ runId: 'r3', agentId: 'a', status: 'failed' }), // no duration/cost
    ];
    const [m] = computeAgentMetrics(runs);
    expect(m.avgDurationMs).toBe(2000);
    expect(m.totalCostUsd).toBeCloseTo(0.06);
  });

  it('reports the most recent run as last, and orders agents newest-first', () => {
    const runs = [
      makeStoredRun({ runId: 'a-old', agentId: 'a', startedAt: new Date('2026-03-01T10:00:00Z'), status: 'completed' }),
      makeStoredRun({ runId: 'a-new', agentId: 'a', startedAt: new Date('2026-03-03T10:00:00Z'), status: 'failed' }),
      makeStoredRun({ runId: 'b', agentId: 'b', startedAt: new Date('2026-03-02T10:00:00Z'), status: 'completed' }),
    ];
    const metrics = computeAgentMetrics(runs);
    expect(metrics.map((m) => m.agentId)).toEqual(['a', 'b']); // a's latest (03-03) newer than b (03-02)
    const a = metrics.find((m) => m.agentId === 'a')!;
    expect(a.lastRunAt).toBe('2026-03-03T10:00:00.000Z');
    expect(a.lastStatus).toBe('failed');
  });

  it('has a zero success rate when nothing has completed or failed', () => {
    const [m] = computeAgentMetrics([makeStoredRun({ agentId: 'a', status: 'running' })]);
    expect(m.successRate).toBe(0);
    expect(m.avgDurationMs).toBeUndefined();
    expect(m.totalCostUsd).toBeUndefined();
  });
});
