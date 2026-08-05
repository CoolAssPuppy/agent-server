import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { acquireLock, releaseLock, isLocked, reconcileStaleLocks } from './lockfile.js';

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
      const payload = JSON.parse(readFileSync(lockPath, 'utf-8')) as {
        pid: number;
        instanceId: string;
        createdAt: string;
      };
      expect(payload.pid).toBe(process.pid);
      expect(typeof payload.instanceId).toBe('string');
      expect(payload.instanceId.length).toBeGreaterThan(10);
      expect(typeof payload.createdAt).toBe('string');
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

  describe('startup reconciliation', () => {
    it('removes dead and malformed locks while preserving live locks and unrelated files', () => {
      lockDir = createTempDir();
      writeFileSync(join(lockDir, 'dead.lock'), '999999999', 'utf-8');
      writeFileSync(join(lockDir, 'malformed.lock'), 'not-json', 'utf-8');
      writeFileSync(join(lockDir, 'live.lock'), JSON.stringify({ pid: process.pid }), 'utf-8');
      writeFileSync(join(lockDir, 'notes.txt'), 'keep', 'utf-8');

      expect(reconcileStaleLocks(lockDir).sort()).toEqual(['dead.lock', 'malformed.lock']);
      expect(readFileSync(join(lockDir, 'live.lock'), 'utf-8')).toContain(String(process.pid));
      expect(readFileSync(join(lockDir, 'notes.txt'), 'utf-8')).toBe('keep');
    });
  });
});
