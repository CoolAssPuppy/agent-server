import type { StoredRun } from './store.js';
import { sanitizeText } from '../server/security-utils.js';

/**
 * Bounds shared by every `RunStore` implementation (in-memory and SQLite) so a
 * run normalizes to the same shape regardless of where it is persisted. Keeping
 * these in one place means the durable store can never drift from the in-memory
 * one on truncation limits.
 */
export const MAX_PROGRESS_MESSAGES_PER_RUN = 500;
const MAX_LIST_ITEMS = 256;
const MAX_TEXT_LENGTH = 4_000;
const MAX_SUMMARY_LENGTH = 8_000;
const MAX_ERROR_LENGTH = 2_000;
const MAX_PROGRESS_MESSAGE_LENGTH = 1_000;
const MAX_LINK_ID_LENGTH = 128;

export function truncate(value: string, maxLength = MAX_TEXT_LENGTH): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…`;
}

function sanitizeAndTruncate(value: string, maxLength: number): string {
  const sanitized = sanitizeText(value, Math.max(1, value.length + 1));
  return truncate(sanitized, maxLength);
}

function trimArray(values: string[]): string[] {
  return values
    .slice(0, MAX_LIST_ITEMS)
    .map((value) => sanitizeAndTruncate(value, MAX_TEXT_LENGTH));
}

/** Truncate a single progress line to the shared per-message cap. */
export function truncateProgressMessage(message: string): string {
  return sanitizeAndTruncate(message, MAX_PROGRESS_MESSAGE_LENGTH);
}

/**
 * Apply every field-level bound to a run. Both stores call this before writing
 * so an oversized summary, unbounded tool list, or runaway progress log can
 * never reach disk or memory.
 */
export function normalizeStoredRun(run: StoredRun): StoredRun {
  return {
    ...run,
    summary: run.summary ? sanitizeAndTruncate(run.summary, MAX_SUMMARY_LENGTH) : undefined,
    error: run.error ? sanitizeAndTruncate(run.error, MAX_ERROR_LENGTH) : undefined,
    code: run.code ? sanitizeAndTruncate(run.code, MAX_LINK_ID_LENGTH) : undefined,
    retryOfRunId: run.retryOfRunId
      ? sanitizeAndTruncate(run.retryOfRunId, MAX_LINK_ID_LENGTH)
      : undefined,
    repairId: run.repairId ? sanitizeAndTruncate(run.repairId, MAX_LINK_ID_LENGTH) : undefined,
    toolsUsed: trimArray(run.toolsUsed),
    filesRead: trimArray(run.filesRead),
    filesWritten: trimArray(run.filesWritten),
    commandsRun: trimArray(run.commandsRun),
    progressMessages: run.progressMessages
      .slice(-MAX_PROGRESS_MESSAGES_PER_RUN)
      .map((v) => truncateProgressMessage(v)),
  };
}
