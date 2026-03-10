import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { acquireLock, releaseLock, isLocked } from './lockfile.js';

function createTempDir(): string {
  const dir = join(tmpdir(), `lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('lockfile', () => {
  let lockDir: string;

  afterEach(() => {
    if (lockDir) rmSync(lockDir, { recursive: true, force: true });
  });

  describe('acquireLock', () => {
    it('acquires a lock and writes PID file', () => {
      lockDir = createTempDir();
      const acquired = acquireLock(lockDir, 'test-agent');
      expect(acquired).toBe(true);

      const lockPath = join(lockDir, 'test-agent.lock');
      const pid = readFileSync(lockPath, 'utf-8').trim();
      expect(Number(pid)).toBe(process.pid);
    });

    it('prevents double acquisition by same process', () => {
      lockDir = createTempDir();
      expect(acquireLock(lockDir, 'test-agent')).toBe(true);
      expect(acquireLock(lockDir, 'test-agent')).toBe(false);
    });

    it('allows different agents to lock independently', () => {
      lockDir = createTempDir();
      expect(acquireLock(lockDir, 'agent-a')).toBe(true);
      expect(acquireLock(lockDir, 'agent-b')).toBe(true);
    });

    it('cleans stale locks from dead processes', () => {
      lockDir = createTempDir();
      const lockPath = join(lockDir, 'test-agent.lock');
      writeFileSync(lockPath, '999999999', 'utf-8');

      const acquired = acquireLock(lockDir, 'test-agent');
      expect(acquired).toBe(true);
    });
  });

  describe('releaseLock', () => {
    it('removes the lock file', () => {
      lockDir = createTempDir();
      acquireLock(lockDir, 'test-agent');
      releaseLock(lockDir, 'test-agent');
      expect(isLocked(lockDir, 'test-agent')).toBe(false);
    });

    it('does not throw when lock does not exist', () => {
      lockDir = createTempDir();
      expect(() => releaseLock(lockDir, 'nonexistent')).not.toThrow();
    });
  });

  describe('isLocked', () => {
    it('returns false when no lock file exists', () => {
      lockDir = createTempDir();
      expect(isLocked(lockDir, 'test-agent')).toBe(false);
    });

    it('returns true when locked by live process', () => {
      lockDir = createTempDir();
      acquireLock(lockDir, 'test-agent');
      expect(isLocked(lockDir, 'test-agent')).toBe(true);
    });

    it('returns false and cleans stale lock', () => {
      lockDir = createTempDir();
      const lockPath = join(lockDir, 'test-agent.lock');
      writeFileSync(lockPath, '999999999', 'utf-8');
      expect(isLocked(lockDir, 'test-agent')).toBe(false);
    });
  });
});
