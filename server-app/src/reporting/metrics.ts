import type { StoredRun } from './store.js';

/**
 * Aggregate per-agent run statistics, computed from the durable run store.
 * Local, no panel — this is the data behind an "agent health" view.
 */
export type AgentMetrics = {
  agentId: string;
  agentName: string;
  totalRuns: number;
  completed: number;
  failed: number;
  skipped: number;
  running: number;
  /** completed / (completed + failed); 0 when neither has happened. */
  successRate: number;
  /** Mean duration of completed runs that recorded one, in ms. */
  avgDurationMs?: number;
  /** Sum of estimated cost across runs that recorded one, in USD. */
  totalCostUsd?: number;
  /** ISO timestamp of the most recent run's start. */
  lastRunAt?: string;
  lastStatus?: StoredRun['status'];
};

/**
 * Fold a flat list of runs into one metrics row per agent, newest-run-first by
 * `lastRunAt`. Pure: the caller supplies the runs (from any store).
 */
export function computeAgentMetrics(runs: StoredRun[]): AgentMetrics[] {
  const byAgent = new Map<string, StoredRun[]>();
  for (const run of runs) {
    const list = byAgent.get(run.agentId) ?? [];
    list.push(run);
    byAgent.set(run.agentId, list);
  }

  const metrics: AgentMetrics[] = [];
  for (const [agentId, agentRuns] of byAgent) {
    metrics.push(aggregate(agentId, agentRuns));
  }

  return metrics.sort((a, b) => (b.lastRunAt ?? '').localeCompare(a.lastRunAt ?? ''));
}

function aggregate(agentId: string, runs: StoredRun[]): AgentMetrics {
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let running = 0;

  let durationSum = 0;
  let durationCount = 0;
  let costSum = 0;
  let costCount = 0;

  let latest: StoredRun | undefined;

  for (const run of runs) {
    switch (run.status) {
      case 'completed': completed++; break;
      case 'failed': failed++; break;
      case 'skipped': skipped++; break;
      case 'running': running++; break;
    }

    if (typeof run.durationMs === 'number' && Number.isFinite(run.durationMs)) {
      durationSum += run.durationMs;
      durationCount++;
    }
    if (typeof run.estimatedCostUsd === 'number' && Number.isFinite(run.estimatedCostUsd)) {
      costSum += run.estimatedCostUsd;
      costCount++;
    }

    if (!latest || run.startedAt.getTime() > latest.startedAt.getTime()) {
      latest = run;
    }
  }

  const decided = completed + failed;

  return {
    agentId,
    agentName: latest?.agentName ?? runs[0]?.agentName ?? agentId,
    totalRuns: runs.length,
    completed,
    failed,
    skipped,
    running,
    successRate: decided > 0 ? completed / decided : 0,
    avgDurationMs: durationCount > 0 ? durationSum / durationCount : undefined,
    totalCostUsd: costCount > 0 ? costSum : undefined,
    lastRunAt: latest?.startedAt.toISOString(),
    lastStatus: latest?.status,
  };
}
