import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, openSync, closeSync } from 'fs';
import { join } from 'path';

function lockPath(lockDir: string, agentId: string): string {
  return join(lockDir, `${agentId}.lock`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLockPid(path: string): number | null {
  try {
    const content = readFileSync(path, 'utf-8').trim();
    const pid = Number(content);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function acquireLock(lockDir: string, agentId: string): boolean {
  mkdirSync(lockDir, { recursive: true });
  const path = lockPath(lockDir, agentId);

  if (existsSync(path)) {
    const pid = readLockPid(path);
    if (pid !== null && isProcessAlive(pid)) {
      return false;
    }
    // Stale lock — remove before attempting exclusive create below.
    try { unlinkSync(path); } catch { /* already gone */ }
  }

  // Exclusive create ('wx'): fails if another process beats us to the file.
  // This also refuses to follow a pre-existing symlink, closing the
  // symlink-attack vector where the lockDir is writeable by an attacker.
  try {
    const fd = openSync(path, 'wx');
    try {
      writeFileSync(fd, String(process.pid), 'utf-8');
    } finally {
      closeSync(fd);
    }
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      // Lost the race against another acquirer.
      return false;
    }
    throw err;
  }
}

export function releaseLock(lockDir: string, agentId: string): void {
  const path = lockPath(lockDir, agentId);
  try {
    unlinkSync(path);
  } catch (err) {
    // ENOENT is expected (lock already removed). Anything else could leave a
    // stale lock that blocks future runs, so surface it at warn level.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[lockfile] releaseLock(${agentId}) failed to unlink ${path}: ${message}`);
    }
  }
}

export function isLocked(lockDir: string, agentId: string): boolean {
  const path = lockPath(lockDir, agentId);
  if (!existsSync(path)) return false;

  const pid = readLockPid(path);
  if (pid === null || !isProcessAlive(pid)) {
    try { unlinkSync(path); } catch { /* already gone */ }
    return false;
  }

  return true;
}
