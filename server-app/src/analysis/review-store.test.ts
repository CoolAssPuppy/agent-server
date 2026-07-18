import { mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteSecurityReviewStore } from './review-store.js';

const HASH_ONE = `sha256:${'a'.repeat(64)}`;
const HASH_TWO = `sha256:${'b'.repeat(64)}`;

describe('SqliteSecurityReviewStore', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories) rmSync(directory, { recursive: true, force: true });
    directories.length = 0;
  });

  function createStore(): { store: SqliteSecurityReviewStore; path: string } {
    const directory = mkdtempSync(join(tmpdir(), 'agent-security-review-'));
    directories.push(directory);
    const path = join(directory, 'security.db');
    return { store: new SqliteSecurityReviewStore({ path }), path };
  }

  it('records analysis metadata without marking it reviewed', () => {
    const { store } = createStore();
    store.recordAnalysis({
      agentId: 'weekly-summary',
      contentHash: HASH_ONE,
      analyzerVersion: '1.0.0',
      findingIds: ['secret.literal:0'],
      analyzedAt: new Date('2026-07-18T12:00:00Z'),
    });

    expect(store.get('weekly-summary')).toEqual(expect.objectContaining({
      contentHash: HASH_ONE,
      findingIds: ['secret.literal:0'],
      reviewedAt: undefined,
    }));
    expect(store.isStale('weekly-summary', HASH_ONE, '1.0.0')).toBe(false);
    store.close();
  });

  it('marks findings reviewed and persists acknowledgements across restart', () => {
    const { store, path } = createStore();
    store.recordAnalysis({
      agentId: 'weekly-summary',
      contentHash: HASH_ONE,
      analyzerVersion: '1.0.0',
      findingIds: ['permissions.commands:0'],
      analyzedAt: new Date('2026-07-18T12:00:00Z'),
    });
    store.markReviewed({
      agentId: 'weekly-summary',
      contentHash: HASH_ONE,
      analyzerVersion: '1.0.0',
      acknowledgedFindingIds: ['permissions.commands:0'],
      reviewedAt: new Date('2026-07-18T12:05:00Z'),
    });
    store.close();

    const reopened = new SqliteSecurityReviewStore({ path });
    expect(reopened.get('weekly-summary')).toEqual(expect.objectContaining({
      acknowledgedFindingIds: ['permissions.commands:0'],
      reviewedAt: new Date('2026-07-18T12:05:00Z'),
    }));
    reopened.close();
  });

  it('marks reviews stale after content or analyzer changes', () => {
    const { store } = createStore();
    store.recordAnalysis({
      agentId: 'weekly-summary',
      contentHash: HASH_ONE,
      analyzerVersion: '1.0.0',
      findingIds: [],
      analyzedAt: new Date(),
    });

    expect(store.isStale('weekly-summary', HASH_TWO, '1.0.0')).toBe(true);
    expect(store.isStale('weekly-summary', HASH_ONE, '2.0.0')).toBe(true);
    expect(store.isStale('missing', HASH_ONE, '1.0.0')).toBe(true);
    store.close();
  });

  it('clears review acknowledgements when a new analysis replaces the content hash', () => {
    const { store } = createStore();
    store.recordAnalysis({
      agentId: 'weekly-summary', contentHash: HASH_ONE, analyzerVersion: '1.0.0',
      findingIds: ['old'], analyzedAt: new Date('2026-07-18T12:00:00Z'),
    });
    store.markReviewed({
      agentId: 'weekly-summary', contentHash: HASH_ONE, analyzerVersion: '1.0.0',
      acknowledgedFindingIds: ['old'], reviewedAt: new Date('2026-07-18T12:01:00Z'),
    });
    store.recordAnalysis({
      agentId: 'weekly-summary', contentHash: HASH_TWO, analyzerVersion: '1.0.0',
      findingIds: ['new'], analyzedAt: new Date('2026-07-18T12:02:00Z'),
    });

    expect(store.get('weekly-summary')).toEqual(expect.objectContaining({
      contentHash: HASH_TWO,
      findingIds: ['new'],
      acknowledgedFindingIds: [],
      reviewedAt: undefined,
    }));
    store.close();
  });

  it('creates the database with owner-only permissions', () => {
    const { store, path } = createStore();
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
    store.close();
  });
});
