import type { PanelClient, PanelRunRow } from '../reporting/panel-client.js';
import type { RunStore, StoredRun } from '../reporting/store.js';

const PANEL_TO_STORED_STATUS: Record<string, StoredRun['status']> = {
  submitted: 'running',
  working: 'running',
  input_required: 'running',
  completed: 'completed',
  failed: 'failed',
  canceled: 'failed',
  rejected: 'failed',
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

export function panelRowToStoredRun(row: PanelRunRow): StoredRun | null {
  if (!row.id || !row.task_id) return null;

  const status = PANEL_TO_STORED_STATUS[row.status] ?? 'running';
  // Only seed TERMINAL runs. In-flight runs on the panel may be panel-side
  // stale-swept failures or runs the daemon never owned — if we seed them as
  // "running" locally, the macOS sidebar will show phantom active runs that
  // don't belong to any local agent. Daemon's in-memory state is the
  // authoritative source of truth for anything currently executing.
  if (status === 'running') return null;

  const startedAtIso = row.started_at ?? row.queued_at ?? null;
  if (!startedAtIso) return null;

  const startedAt = new Date(startedAtIso);
  if (Number.isNaN(startedAt.getTime())) return null;

  const completedAt = row.ended_at ? new Date(row.ended_at) : undefined;
  const result = row.result ?? {};
  const summary = asString(result.summary);
  const filesWritten = asStringArray(result.files_written);
  const filesRead = asStringArray(result.files_read);
  const toolsUsed = asStringArray(result.tools_used);
  const commandsRun = asStringArray(result.commands_run);
  const turnCount = typeof result.turn_count === 'number' ? result.turn_count : 0;

  return {
    runId: row.id,
    agentId: row.task_id,
    agentName: row.task_name,
    status,
    startedAt,
    completedAt: completedAt && !Number.isNaN(completedAt.getTime()) ? completedAt : undefined,
    summary,
    error: asString(row.error_message),
    turnCount,
    toolsUsed,
    filesRead,
    filesWritten,
    commandsRun,
    progressMessages: [],
    conversationId: row.conversation_id ?? undefined,
  };
}

type SeedOptions = {
  panelClient: PanelClient;
  store: RunStore;
  limit?: number;
};

export type SeedResult = {
  fetched: number;
  inserted: number;
  skipped: number;
};

/**
 * Seeds the in-memory RunStore with recent runs from the panel. Runs already
 * present in the store (in-flight or locally newer) are NOT overwritten.
 *
 * Returns a summary of how many rows were fetched, inserted, and skipped.
 * Throws if the panel fetch fails — callers should catch and log.
 */
export async function seedRunStoreFromPanel(options: SeedOptions): Promise<SeedResult> {
  const { panelClient, store, limit = 200 } = options;
  const rows = await panelClient.fetchRecentRuns(limit);

  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const stored = panelRowToStoredRun(row);
    if (!stored) {
      skipped += 1;
      continue;
    }

    if (store.get(stored.runId)) {
      skipped += 1;
      continue;
    }

    store.add(stored);
    inserted += 1;
  }

  return { fetched: rows.length, inserted, skipped };
}
