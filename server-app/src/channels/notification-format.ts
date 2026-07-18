import type { NotificationData } from '../interaction/notification.js';

/** Human-readable run duration: `45s`, `3m 12s`, `1h 4m`. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return `${hours}h ${remaining}m`;
}

/**
 * A compact stats line for a completed run (`5 turns · 12s · 3 tools · 1 file
 * written`), or null when there is nothing worth showing. Rendered the same way
 * for every channel.
 */
export function buildStatsFooter(data: NotificationData): string | null {
  const parts: string[] = [];
  if (data.turnCount && data.turnCount > 0) parts.push(`${data.turnCount} turns`);
  if (data.durationMs && data.durationMs > 0) parts.push(formatDuration(data.durationMs));
  if (data.toolsUsed && data.toolsUsed.length > 0) parts.push(`${data.toolsUsed.length} tools`);
  if (data.filesWritten && data.filesWritten.length > 0) {
    parts.push(`${data.filesWritten.length} file${data.filesWritten.length === 1 ? '' : 's'} written`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
