import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, openSync, closeSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { toErrorMessage } from '../util/errors.js';

function lockPath(lockDir: string, agentId: string): string {
  return join(lockDir, `${agentId}.lock`);
}

type LockData = {
  pid: number;
  instanceId?: string;
  createdAt?: string;
};

const PROCESS_INSTANCE_ID = randomUUID();

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLockData(path: string): LockData | null {
  try {
    const content = readFileSync(path, 'utf-8').trim();
    if (content.startsWith('{')) {
      const parsed = JSON.parse(content) as Partial<LockData>;
      if (typeof parsed.pid === 'number' && Number.isFinite(parsed.pid)) {
        return {
          pid: parsed.pid,
          instanceId: typeof parsed.instanceId === 'string' ? parsed.instanceId : undefined,
          createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : undefined,
        };
      }
      return null;
    }
    // Backwards-compatible parse for legacy lock files that only contained a pid.
    const legacyPid = Number(content);
    return Number.isFinite(legacyPid) ? { pid: legacyPid } : null;
  } catch {
    return null;
  }
}

export function acquireLock(lockDir: string, agentId: string): boolean {
  mkdirSync(lockDir, { recursive: true });
  const path = lockPath(lockDir, agentId);

  // Retry a few times because another process may clean up a stale lock at
  // exactly the same time we do.
  for (let attempt = 1; attempt <= 3; attempt++) {
    // Exclusive create ('wx'): fails if another process beats us to the file.
    // This also refuses to follow a pre-existing symlink, closing the
    // symlink-attack vector where the lockDir is writeable by an attacker.
    try {
      const fd = openSync(path, 'wx');
      try {
        const payload: LockData = {
          pid: process.pid,
          instanceId: PROCESS_INSTANCE_ID,
          createdAt: new Date().toISOString(),
        };
        writeFileSync(fd, JSON.stringify(payload), 'utf-8');
      } finally {
        closeSync(fd);
      }
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw err;

      const lockData = readLockData(path);
      if (lockData !== null && isProcessAlive(lockData.pid)) {
        return false;
      }

      // Stale or unreadable lock — try removing it, then loop and retry.
      try {
        unlinkSync(path);
      } catch (unlinkErr) {
        const unlinkCode = (unlinkErr as NodeJS.ErrnoException).code;
        if (unlinkCode !== 'ENOENT') {
          return false;
        }
      }
    }
  }

  return false;
}

export function releaseLock(lockDir: string, agentId: string): void {
  const path = lockPath(lockDir, agentId);
  const lockData = readLockData(path);
  if (lockData && lockData.pid === process.pid && lockData.instanceId && lockData.instanceId !== PROCESS_INSTANCE_ID) {
    console.warn(
      `[lockfile] releaseLock(${agentId}) skipped; lock belongs to a different process instance (pid=${lockData.pid})`,
    );
    return;
  }
  try {
    unlinkSync(path);
  } catch (err) {
    // ENOENT is expected (lock already removed). Anything else could leave a
    // stale lock that blocks future runs, so surface it at warn level.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      const message = toErrorMessage(err);
      console.warn(`[lockfile] releaseLock(${agentId}) failed to unlink ${path}: ${message}`);
    }
  }
}

export function isLocked(lockDir: string, agentId: string): boolean {
  const path = lockPath(lockDir, agentId);
  if (!existsSync(path)) return false;

  const lockData = readLockData(path);
  if (lockData === null || !isProcessAlive(lockData.pid)) {
    try { unlinkSync(path); } catch { /* already gone */ }
    return false;
  }

  return true;
}
