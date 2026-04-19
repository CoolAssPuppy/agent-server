const PATTERN = /^(\d+)\s*([smh])$/i;

/**
 * Parses a duration string like `30s`, `15m`, `2h` into milliseconds.
 * Returns `defaultMs` when the input is missing, malformed, or non-positive.
 */
export function parseDuration(input: string | undefined, defaultMs: number): number {
  if (!input) return defaultMs;
  const match = PATTERN.exec(input.trim());
  if (!match) return defaultMs;

  const value = parseInt(match[1], 10);
  if (!Number.isFinite(value) || value <= 0) return defaultMs;

  const unit = match[2].toLowerCase();
  switch (unit) {
    case 's': return value * 1_000;
    case 'm': return value * 60_000;
    case 'h': return value * 3_600_000;
    default: return defaultMs;
  }
}
