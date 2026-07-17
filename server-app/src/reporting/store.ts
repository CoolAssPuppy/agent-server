import {
  MAX_PROGRESS_MESSAGES_PER_RUN,
  normalizeStoredRun,
  truncateProgressMessage,
} from './run-normalization.js';

export type StoredRun = {
  runId: string;
  agentId: string;
  agentName: string;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  startedAt: Date;
  completedAt?: Date;
  summary?: string;
  error?: string;
  turnCount: number;
  toolsUsed: string[];
  filesRead: string[];
  filesWritten: string[];
  commandsRun: string[];
  progressMessages: string[];
  conversationId?: string;
  // Populated from the executor's ExecutionResult.usage so clients
  // (the macOS app, the panel) can render per-run duration and cost
  // without waiting for panel-side hydration.
  durationMs?: number;
  estimatedCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
};

/**
 * The contract the server depends on for run history. Both the in-memory
 * `RunStore` and the durable `SqliteRunStore` implement it, so the server can
 * hold either without knowing where runs live. `close()` releases any
 * underlying handle (a no-op for the in-memory store).
 */
export interface RunStoreLike {
  add(run: StoredRun): void;
  get(runId: string): StoredRun | undefined;
  list(): StoredRun[];
  listByAgent(agentId: string): StoredRun[];
  update(runId: string, updates: Partial<StoredRun>): void;
  delete(runId: string): boolean;
  addProgress(runId: string, message: string): void;
  close(): void;
}

const DEFAULT_MAX_RUNS = 200;

export class RunStore implements RunStoreLike {
  private readonly runs = new Map<string, StoredRun>();
  private readonly maxRuns: number;

  constructor(maxRuns: number = DEFAULT_MAX_RUNS) {
    this.maxRuns = maxRuns;
  }

  add(run: StoredRun): void {
    this.runs.set(run.runId, normalizeStoredRun({ ...run }));
    this.evictOldest();
  }

  get(runId: string): StoredRun | undefined {
    const run = this.runs.get(runId);
    return run ? { ...run } : undefined;
  }

  list(): StoredRun[] {
    return [...this.runs.values()]
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }

  listByAgent(agentId: string): StoredRun[] {
    return [...this.runs.values()]
      .filter((r) => r.agentId === agentId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }

  update(runId: string, updates: Partial<StoredRun>): void {
    const run = this.runs.get(runId);
    if (!run) return;
    this.runs.set(runId, normalizeStoredRun({ ...run, ...updates }));
  }

  delete(runId: string): boolean {
    return this.runs.delete(runId);
  }

  addProgress(runId: string, message: string): void {
    const run = this.runs.get(runId);
    if (!run) return;

    const nextMessages = [...run.progressMessages, truncateProgressMessage(message)];
    this.runs.set(runId, {
      ...run,
      progressMessages: nextMessages.slice(-MAX_PROGRESS_MESSAGES_PER_RUN),
    });
  }

  /** No-op: the in-memory store holds no external handle. */
  close(): void {}

  private evictOldest(): void {
    if (this.runs.size <= this.maxRuns) return;

    const sorted = [...this.runs.entries()]
      .sort(([, a], [, b]) => a.startedAt.getTime() - b.startedAt.getTime());

    const toRemove = sorted.slice(0, this.runs.size - this.maxRuns);
    for (const [key] of toRemove) {
      this.runs.delete(key);
    }
  }
}
