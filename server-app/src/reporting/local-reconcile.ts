import type { RunStoreLike } from './store.js';

export const ORPHANED_RUN_ERROR = 'Server restarted while this run was in progress';

/**
 * Fail any run still marked `running` in the durable store. A freshly started
 * server process owns no in-flight runs, so anything left `running` belongs to
 * a previous process that was killed mid-run (crash, macOS sleep, app quit,
 * launchd restart). With in-memory history these vanished on restart; now that
 * history persists they must be reconciled locally, otherwise the macOS app
 * would show a run "working" forever.
 *
 * This is the local-first replacement for panel-side ghost-run cleanup: the
 * server owns its own runs and needs no panel to lay them to rest.
 *
 * @returns the ids of the runs that were reconciled.
 */
export function failOrphanedLocalRuns(
  store: RunStoreLike,
  reason: string = ORPHANED_RUN_ERROR,
): string[] {
  const orphaned = store.list().filter((run) => run.status === 'running');
  const now = new Date();

  for (const run of orphaned) {
    store.update(run.runId, {
      status: 'failed',
      error: reason,
      completedAt: now,
    });
  }

  return orphaned.map((run) => run.runId);
}
