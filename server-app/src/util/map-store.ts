/**
 * Small helpers shared by the in-memory keyed stores (interactions,
 * conversations, runs). Each store is a `Map<string, Entry>` with FIFO
 * capacity eviction and, for the status-bearing ones, a stale sweep.
 */

/** Non-active entries are kept this long after they go inactive, then dropped. */
export const STALE_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Evicts the oldest entries from `map` until its size is at most `max`,
 * ordering by the timestamp `timeOf` returns (ascending = oldest first).
 */
export function evictOldest<T>(map: Map<string, T>, max: number, timeOf: (value: T) => number): void {
  if (map.size <= max) return;
  const sorted = [...map.entries()].sort(([, a], [, b]) => timeOf(a) - timeOf(b));
  for (const [id] of sorted.slice(0, map.size - max)) {
    map.delete(id);
  }
}

/**
 * Sweeps a map of status-bearing entries in one pass: an active entry whose
 * deadline has passed is flipped to its expired form (its id collected and
 * returned so callers can notify); an already-inactive entry older than
 * `STALE_RETENTION_MS` is deleted. The two cases are mutually exclusive on an
 * entry's status at sweep time, matching the original per-store loops.
 */
export function sweepExpired<T extends { createdAt: Date }>(
  map: Map<string, T>,
  now: Date,
  opts: {
    isActive: (entry: T) => boolean;
    hasExpired: (entry: T, now: Date) => boolean;
    toExpired: (entry: T) => T;
  },
): string[] {
  const expiredIds: string[] = [];
  for (const [id, entry] of map) {
    if (opts.isActive(entry)) {
      if (opts.hasExpired(entry, now)) {
        map.set(id, opts.toExpired(entry));
        expiredIds.push(id);
      }
    } else if (now.getTime() - entry.createdAt.getTime() > STALE_RETENTION_MS) {
      map.delete(id);
    }
  }
  return expiredIds;
}
