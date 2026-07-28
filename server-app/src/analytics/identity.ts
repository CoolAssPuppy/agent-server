import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const IDENTITY_FILE = 'analytics-id';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IdentityOptions = {
  /** Passed by the macOS app so the app and the daemon it spawns are one person. */
  inherited?: string;
  /** `~/.agent-server` by default. Where the standalone identity file lives. */
  home: string;
};

/**
 * Resolves the per-install identifier used as the analytics distinct id.
 *
 * A random UUID and nothing else. No hostname, no username, no hardware id,
 * no email. The same person on two Macs is two identifiers, and that is the
 * intended trade: the identifier must not be able to name anybody.
 *
 * Precedence matters. When the macOS app spawns this daemon it passes its own
 * UUID down, so GUI events and daemon events resolve to a single person rather
 * than inflating every user count by two. Only a CLI started from a terminal
 * falls through to the file.
 */
export function resolveDistinctId(options: IdentityOptions): string {
  const inherited = options.inherited?.trim();
  if (inherited && UUID_PATTERN.test(inherited)) return inherited;

  const path = join(options.home, IDENTITY_FILE);

  try {
    const existing = readFileSync(path, 'utf8').trim();
    if (UUID_PATTERN.test(existing)) return existing;
  } catch {
    // No identity file yet, or it is unreadable. Write a fresh one below.
  }

  const fresh = randomUUID();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${fresh}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // A read-only home means this install is a new person on every start.
    // Losing continuity is acceptable; failing a command over analytics is not.
  }
  return fresh;
}
