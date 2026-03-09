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
};

const DEFAULT_MAX_RUNS = 200;

export class RunStore {
  private readonly runs = new Map<string, StoredRun>();
  private readonly maxRuns: number;

  constructor(maxRuns: number = DEFAULT_MAX_RUNS) {
    this.maxRuns = maxRuns;
  }

  add(run: StoredRun): void {
    this.runs.set(run.runId, { ...run });
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
    return this.list().filter((r) => r.agentId === agentId);
  }

  update(runId: string, updates: Partial<StoredRun>): void {
    const run = this.runs.get(runId);
    if (!run) return;
    Object.assign(run, updates);
  }

  addProgress(runId: string, message: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    run.progressMessages.push(message);
  }

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
