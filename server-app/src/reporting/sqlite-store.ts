import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import type { StoredRun, RunStoreLike } from './store.js';
import {
  MAX_PROGRESS_MESSAGES_PER_RUN,
  normalizeStoredRun,
  truncateProgressMessage,
} from './run-normalization.js';

const DEFAULT_MAX_RUNS = 5_000;

export type SqliteRunStoreOptions = {
  /** File path for the database, or `:memory:` for an ephemeral store. */
  path: string;
  /** Retain at most this many runs; older runs are evicted on write. */
  maxRuns?: number;
};

/**
 * A row exactly as stored: dates are epoch millis and string arrays are JSON
 * text, so the schema stays flat and portable.
 */
type RunRow = {
  run_id: string;
  agent_id: string;
  agent_name: string;
  status: string;
  started_at: number;
  completed_at: number | null;
  summary: string | null;
  error: string | null;
  code: string | null;
  turn_count: number;
  tools_used: string;
  files_read: string;
  files_written: string;
  commands_run: string;
  progress_messages: string;
  conversation_id: string | null;
  conversation_channel: string | null;
  duration_ms: number | null;
  estimated_cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  model: string | null;
  run_mode: string;
  retry_of_run_id: string | null;
  repair_id: string | null;
};

/**
 * Durable run history backed by SQLite (`node:sqlite`, built into Node — no
 * native dependency to compile or code-sign inside the macOS app bundle).
 *
 * Drop-in for the in-memory `RunStore`: same `RunStoreLike` contract, same
 * normalization bounds, same newest-first ordering and cap-based eviction. The
 * only difference the caller sees is that runs survive a process restart, which
 * is the foundation for retiring the panel as the source of run history.
 */
export class SqliteRunStore implements RunStoreLike {
  private readonly db: DatabaseSync;
  private readonly maxRuns: number;

  constructor(options: SqliteRunStoreOptions) {
    this.maxRuns = options.maxRuns ?? DEFAULT_MAX_RUNS;

    if (options.path !== ':memory:') {
      mkdirSync(dirname(options.path), { recursive: true });
    }

    this.db = new DatabaseSync(options.path);
    this.configure();
    this.migrate();
  }

  add(run: StoredRun): void {
    this.writeRun(normalizeStoredRun({ ...run }));
    this.evictOldest();
  }

  get(runId: string): StoredRun | undefined {
    const row = this.db
      .prepare('SELECT * FROM runs WHERE run_id = ?')
      .get(runId) as RunRow | undefined;
    return row ? rowToRun(row) : undefined;
  }

  list(): StoredRun[] {
    const rows = this.db
      .prepare('SELECT * FROM runs ORDER BY started_at DESC')
      .all() as RunRow[];
    return rows.map(rowToRun);
  }

  listByAgent(agentId: string): StoredRun[] {
    const rows = this.db
      .prepare('SELECT * FROM runs WHERE agent_id = ? ORDER BY started_at DESC')
      .all(agentId) as RunRow[];
    return rows.map(rowToRun);
  }

  update(runId: string, updates: Partial<StoredRun>): void {
    const existing = this.get(runId);
    if (!existing) return;
    this.writeRun(normalizeStoredRun({ ...existing, ...updates }));
  }

  delete(runId: string): boolean {
    const result = this.db.prepare('DELETE FROM runs WHERE run_id = ?').run(runId);
    return Number(result.changes) > 0;
  }

  addProgress(runId: string, message: string): void {
    const existing = this.get(runId);
    if (!existing) return;

    const nextMessages = [...existing.progressMessages, truncateProgressMessage(message)]
      .slice(-MAX_PROGRESS_MESSAGES_PER_RUN);
    this.db
      .prepare('UPDATE runs SET progress_messages = ? WHERE run_id = ?')
      .run(JSON.stringify(nextMessages), runId);
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  private configure(): void {
    // WAL keeps reads (the macOS app polling /runs) from blocking the writer,
    // and survives crashes cleanly. NORMAL is the durable-but-fast sync level
    // recommended with WAL. Neither applies to :memory:, where they are no-ops.
    try {
      this.db.exec('PRAGMA journal_mode = WAL');
      this.db.exec('PRAGMA synchronous = NORMAL');
      this.db.exec('PRAGMA busy_timeout = 5000');
    } catch {
      // A read-only or restricted environment may reject pragmas; the store
      // still functions without them.
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        summary TEXT,
        error TEXT,
        code TEXT,
        turn_count INTEGER NOT NULL DEFAULT 0,
        tools_used TEXT NOT NULL DEFAULT '[]',
        files_read TEXT NOT NULL DEFAULT '[]',
        files_written TEXT NOT NULL DEFAULT '[]',
        commands_run TEXT NOT NULL DEFAULT '[]',
        progress_messages TEXT NOT NULL DEFAULT '[]',
        conversation_id TEXT,
        conversation_channel TEXT,
        duration_ms INTEGER,
        estimated_cost_usd REAL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        model TEXT,
        run_mode TEXT NOT NULL DEFAULT 'normal',
        retry_of_run_id TEXT,
        repair_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs (started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_runs_agent_started ON runs (agent_id, started_at DESC);
    `);
    const columns = this.db.prepare('PRAGMA table_info(runs)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'run_mode')) {
      this.db.exec("ALTER TABLE runs ADD COLUMN run_mode TEXT NOT NULL DEFAULT 'normal'");
    }
    if (!columns.some((column) => column.name === 'retry_of_run_id')) {
      this.db.exec('ALTER TABLE runs ADD COLUMN retry_of_run_id TEXT');
    }
    if (!columns.some((column) => column.name === 'repair_id')) {
      this.db.exec('ALTER TABLE runs ADD COLUMN repair_id TEXT');
    }
    if (!columns.some((column) => column.name === 'code')) {
      this.db.exec('ALTER TABLE runs ADD COLUMN code TEXT');
    }
    if (!columns.some((column) => column.name === 'conversation_channel')) {
      this.db.exec('ALTER TABLE runs ADD COLUMN conversation_channel TEXT');
    }
  }

  private writeRun(run: StoredRun): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO runs (
          run_id, agent_id, agent_name, status, started_at, completed_at,
          summary, error, code, turn_count, tools_used, files_read, files_written,
          commands_run, progress_messages, conversation_id, conversation_channel, duration_ms,
          estimated_cost_usd, input_tokens, output_tokens, model, run_mode,
          retry_of_run_id, repair_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.runId,
        run.agentId,
        run.agentName,
        run.status,
        run.startedAt.getTime(),
        run.completedAt ? run.completedAt.getTime() : null,
        run.summary ?? null,
        run.error ?? null,
        run.code ?? null,
        run.turnCount,
        JSON.stringify(run.toolsUsed),
        JSON.stringify(run.filesRead),
        JSON.stringify(run.filesWritten),
        JSON.stringify(run.commandsRun),
        JSON.stringify(run.progressMessages),
        run.conversationId ?? null,
        run.conversationChannel ?? null,
        run.durationMs ?? null,
        run.estimatedCostUsd ?? null,
        run.inputTokens ?? null,
        run.outputTokens ?? null,
        run.model ?? null,
        run.mode ?? 'normal',
        run.retryOfRunId ?? null,
        run.repairId ?? null,
      );
  }

  private evictOldest(): void {
    // Keep the newest `maxRuns`; delete everything older. LIMIT -1 means "no
    // limit", so OFFSET maxRuns selects exactly the runs past the retention
    // window for deletion.
    this.db
      .prepare(
        `DELETE FROM runs WHERE run_id IN (
          SELECT run_id FROM runs ORDER BY started_at DESC, run_id DESC LIMIT -1 OFFSET ?
        )`,
      )
      .run(this.maxRuns);
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function rowToRun(row: RunRow): StoredRun {
  return normalizeStoredRun({
    runId: row.run_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    status: row.status as StoredRun['status'],
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at != null ? new Date(row.completed_at) : undefined,
    summary: row.summary ?? undefined,
    error: row.error ?? undefined,
    code: row.code ?? undefined,
    turnCount: row.turn_count,
    toolsUsed: parseStringArray(row.tools_used),
    filesRead: parseStringArray(row.files_read),
    filesWritten: parseStringArray(row.files_written),
    commandsRun: parseStringArray(row.commands_run),
    progressMessages: parseStringArray(row.progress_messages),
    conversationId: row.conversation_id ?? undefined,
    conversationChannel: row.conversation_channel === 'slack' || row.conversation_channel === 'telegram'
      ? row.conversation_channel
      : undefined,
    durationMs: row.duration_ms ?? undefined,
    estimatedCostUsd: row.estimated_cost_usd ?? undefined,
    inputTokens: row.input_tokens ?? undefined,
    outputTokens: row.output_tokens ?? undefined,
    model: row.model ?? undefined,
    retryOfRunId: row.retry_of_run_id ?? undefined,
    repairId: row.repair_id ?? undefined,
    ...(row.run_mode === 'safe_test' ? { mode: 'safe_test' as const } : {}),
  });
}
