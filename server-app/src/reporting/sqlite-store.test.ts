import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SqliteRunStore } from './sqlite-store.js';
import { makeStoredRun } from '../test-factories.js';

describe('SqliteRunStore', () => {
  let dir: string;
  let dbPath: string;
  let store: SqliteRunStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-server-runs-'));
    dbPath = join(dir, 'runs.db');
    store = new SqliteRunStore({ path: dbPath });
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores and retrieves a run', () => {
    const run = makeStoredRun();
    store.add(run);
    expect(store.get('run-1')).toEqual(run);
  });

  it('round-trips every field including usage and conversation id', () => {
    const run = makeStoredRun({
      completedAt: new Date('2026-03-09T10:05:00Z'),
      summary: 'All good',
      conversationId: 'conv-42',
      conversationChannel: 'telegram',
      durationMs: 1234,
      estimatedCostUsd: 0.0421,
      inputTokens: 900,
      outputTokens: 120,
      model: 'claude-opus-4-8',
      mode: 'safe_test',
      retryOfRunId: 'failed-run',
      repairId: 'repair-42',
      code: 'lock_contention',
      filesRead: ['a.txt'],
      filesWritten: ['b.txt'],
      commandsRun: ['ls'],
    });
    store.add(run);
    expect(store.get('run-1')).toEqual(run);
  });

  it('migrates existing run databases with retry linkage columns', () => {
    store.close();
    const legacy = new DatabaseSync(dbPath);
    legacy.exec('DROP TABLE runs');
    legacy.exec(`
      CREATE TABLE runs (
        run_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        summary TEXT,
        error TEXT,
        turn_count INTEGER NOT NULL DEFAULT 0,
        tools_used TEXT NOT NULL DEFAULT '[]',
        files_read TEXT NOT NULL DEFAULT '[]',
        files_written TEXT NOT NULL DEFAULT '[]',
        commands_run TEXT NOT NULL DEFAULT '[]',
        progress_messages TEXT NOT NULL DEFAULT '[]',
        conversation_id TEXT,
        duration_ms INTEGER,
        estimated_cost_usd REAL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        model TEXT,
        run_mode TEXT NOT NULL DEFAULT 'normal'
      )
    `);
    legacy.close();

    store = new SqliteRunStore({ path: dbPath });
    store.add(makeStoredRun({
      retryOfRunId: 'failed-run',
      repairId: 'repair-42',
      code: 'lock_contention',
    }));

    expect(store.get('run-1')).toMatchObject({
      retryOfRunId: 'failed-run',
      repairId: 'repair-42',
      code: 'lock_contention',
    });
  });

  it('returns undefined for an unknown run', () => {
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('lists all runs newest first', () => {
    store.add(makeStoredRun({ runId: 'old', startedAt: new Date('2026-03-09T09:00:00Z') }));
    store.add(makeStoredRun({ runId: 'new', startedAt: new Date('2026-03-09T11:00:00Z') }));
    store.add(makeStoredRun({ runId: 'mid', startedAt: new Date('2026-03-09T10:00:00Z') }));

    expect(store.list().map((r) => r.runId)).toEqual(['new', 'mid', 'old']);
  });

  it('lists runs filtered by agent id, newest first', () => {
    store.add(makeStoredRun({ runId: 'r1', agentId: 'agent-a', startedAt: new Date('2026-03-09T09:00:00Z') }));
    store.add(makeStoredRun({ runId: 'r2', agentId: 'agent-b', startedAt: new Date('2026-03-09T10:00:00Z') }));
    store.add(makeStoredRun({ runId: 'r3', agentId: 'agent-a', startedAt: new Date('2026-03-09T11:00:00Z') }));

    const runs = store.listByAgent('agent-a');
    expect(runs.map((r) => r.runId)).toEqual(['r3', 'r1']);
    expect(runs.every((r) => r.agentId === 'agent-a')).toBe(true);
  });

  it('updates a run in place, preserving untouched fields', () => {
    store.add(makeStoredRun({ summary: 'original' }));
    store.update('run-1', { status: 'failed', error: 'boom' });

    const run = store.get('run-1');
    expect(run?.status).toBe('failed');
    expect(run?.error).toBe('boom');
    expect(run?.summary).toBe('original');
    expect(run?.turnCount).toBe(3);
  });

  it('ignores updates to an unknown run', () => {
    store.update('ghost', { status: 'completed' });
    expect(store.get('ghost')).toBeUndefined();
  });

  it('replaces a run when added again with the same id', () => {
    store.add(makeStoredRun({ status: 'running' }));
    store.add(makeStoredRun({ status: 'completed', summary: 'redone' }));

    const run = store.get('run-1');
    expect(run?.status).toBe('completed');
    expect(run?.summary).toBe('redone');
    expect(store.list()).toHaveLength(1);
  });

  it('deletes a run and reports whether it existed', () => {
    store.add(makeStoredRun());
    expect(store.delete('run-1')).toBe(true);
    expect(store.get('run-1')).toBeUndefined();
    expect(store.delete('run-1')).toBe(false);
  });

  it('appends progress messages in order', () => {
    store.add(makeStoredRun());
    store.addProgress('run-1', 'Step 1 done');
    store.addProgress('run-1', 'Step 2 done');

    expect(store.get('run-1')?.progressMessages).toEqual(['Step 1 done', 'Step 2 done']);
  });

  it('ignores progress for an unknown run', () => {
    store.addProgress('ghost', 'noise');
    expect(store.get('ghost')).toBeUndefined();
  });

  it('caps progress messages to the most recent 500', () => {
    store.add(makeStoredRun());
    for (let i = 0; i < 520; i++) {
      store.addProgress('run-1', `msg-${i}`);
    }
    const messages = store.get('run-1')?.progressMessages ?? [];
    expect(messages).toHaveLength(500);
    expect(messages[0]).toBe('msg-20');
    expect(messages[messages.length - 1]).toBe('msg-519');
  });

  it('normalizes oversized fields on write', () => {
    store.add(makeStoredRun({
      summary: 'x'.repeat(20_000),
      toolsUsed: Array.from({ length: 400 }, (_, i) => `tool-${i}`),
    }));
    const run = store.get('run-1');
    expect(run?.summary?.length).toBe(8_001); // 8000 chars + ellipsis
    expect(run?.toolsUsed).toHaveLength(256);
  });

  it('never persists secret-bearing run evidence in readable form', () => {
    store.add(makeStoredRun({
      summary: 'token="sqlite-summary-secret"',
      error: 'password="sqlite-error-secret"',
      commandsRun: ['Authorization: Bearer sqlite-command-secret'],
      filesRead: ['/tmp/api_key="sqlite-file-secret"'],
      progressMessages: ['secret="sqlite-initial-progress"'],
    }));
    store.addProgress('run-1', 'token="sqlite-later-progress"');

    const stored = JSON.stringify(store.get('run-1'));
    expect(stored).toContain('[REDACTED]');
    for (const secret of [
      'sqlite-summary-secret',
      'sqlite-error-secret',
      'sqlite-command-secret',
      'sqlite-file-secret',
      'sqlite-initial-progress',
      'sqlite-later-progress',
    ]) {
      expect(stored).not.toContain(secret);
    }
  });

  it('redacts historical rows that were stored before persistence sanitization', () => {
    store.add(makeStoredRun({ runId: 'legacy-run' }));
    const legacyDatabase = new DatabaseSync(dbPath);
    legacyDatabase.prepare(`
      UPDATE runs
      SET summary = ?, error = ?, commands_run = ?, progress_messages = ?
      WHERE run_id = ?
    `).run(
      'token="legacy-summary-secret"',
      'password="legacy-error-secret"',
      JSON.stringify(['Authorization: Bearer legacy-command-secret']),
      JSON.stringify(['api_key="legacy-progress-secret"']),
      'legacy-run',
    );
    legacyDatabase.close();

    const representations = [store.get('legacy-run'), store.list()[0]];
    for (const representation of representations) {
      const serialized = JSON.stringify(representation);
      expect(serialized).toContain('[REDACTED]');
      expect(serialized).not.toContain('legacy-summary-secret');
      expect(serialized).not.toContain('legacy-error-secret');
      expect(serialized).not.toContain('legacy-command-secret');
      expect(serialized).not.toContain('legacy-progress-secret');
    }
  });

  it('evicts the oldest runs beyond the configured cap', () => {
    const capped = new SqliteRunStore({ path: join(dir, 'capped.db'), maxRuns: 3 });
    capped.add(makeStoredRun({ runId: 'r1', startedAt: new Date('2026-01-01') }));
    capped.add(makeStoredRun({ runId: 'r2', startedAt: new Date('2026-01-02') }));
    capped.add(makeStoredRun({ runId: 'r3', startedAt: new Date('2026-01-03') }));
    capped.add(makeStoredRun({ runId: 'r4', startedAt: new Date('2026-01-04') }));

    expect(capped.list()).toHaveLength(3);
    expect(capped.get('r1')).toBeUndefined();
    expect(capped.get('r4')).toBeDefined();
    capped.close();
  });

  it('persists runs across store restarts (durability)', () => {
    store.add(makeStoredRun({ runId: 'survivor', summary: 'kept', status: 'completed' }));
    store.addProgress('survivor', 'did a thing');
    store.close();

    const reopened = new SqliteRunStore({ path: dbPath });
    const run = reopened.get('survivor');
    expect(run?.summary).toBe('kept');
    expect(run?.status).toBe('completed');
    expect(run?.progressMessages).toEqual(['did a thing']);
    reopened.close();
  });

  it('creates the database file and parent directory if missing', () => {
    const nested = join(dir, 'deep', 'nested', 'history.db');
    const nestedStore = new SqliteRunStore({ path: nested });
    nestedStore.add(makeStoredRun());
    expect(existsSync(nested)).toBe(true);
    nestedStore.close();
  });

  it('supports an in-memory database for tests', () => {
    const mem = new SqliteRunStore({ path: ':memory:' });
    mem.add(makeStoredRun());
    expect(mem.get('run-1')).toBeDefined();
    mem.close();
  });
});
