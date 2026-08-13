import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, utimesSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentLogStore } from './log-store.js';
import { AgentLogger } from './logger.js';

function createStore(overrides: { retentionDays?: number; now?: () => Date } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'agent-logs-'));
  const store = new AgentLogStore({
    root,
    ...(overrides.retentionDays !== undefined ? { retentionDays: overrides.retentionDays } : {}),
  });
  return {
    root,
    store,
    logger: new AgentLogger({
      readsFrom: store,
      machineId: 'machine-uuid',
      hostname: 'test-mac',
      now: overrides.now ?? (() => new Date('2026-08-13T06:45:00.000Z')),
    }),
  };
}

function readRecords(root: string, agentId: string, date = '2026-08-13'): Record<string, unknown>[] {
  const text = readFileSync(join(root, agentId, `${date}.jsonl`), 'utf8');
  return text.trimEnd().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('local JSONL log driver', () => {
  it('writes one JSON object per line with the standard fields first', () => {
    const { root, logger } = createStore();

    logger.append({ agentId: 'daily-focus', runId: 'run-1', message: 'Notion write failed' });

    const raw = readFileSync(join(root, 'daily-focus', '2026-08-13.jsonl'), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw.split('\n')).toHaveLength(2);
    expect(Object.keys(JSON.parse(raw.split('\n')[0]) as object).slice(0, 3))
      .toEqual(['timestamp', 'level', 'message']);
  });

  it('records who produced the entry so one panel can tell machines apart', () => {
    const { root, logger } = createStore();

    logger.append({ agentId: 'daily-focus', runId: 'run-1', message: 'Started' });

    expect(readRecords(root, 'daily-focus')[0]).toMatchObject({
      timestamp: '2026-08-13T06:45:00.000Z',
      level: 'info',
      message: 'Started',
      agent_id: 'daily-focus',
      run_id: 'run-1',
      machine_id: 'machine-uuid',
      hostname: 'test-mac',
    });
  });

  it('keeps a long body on the same line as its record', () => {
    const { root, logger } = createStore();
    const body = '# Report\nline two\n';

    logger.append({ agentId: 'daily-focus', runId: 'run-1', message: 'Unsent page', body });

    const records = readRecords(root, 'daily-focus');
    expect(records).toHaveLength(1);
    expect(records[0].body).toBe(body);
  });

  it('appends to the same day file rather than replacing it', () => {
    const { root, logger } = createStore();

    logger.append({ agentId: 'daily-focus', runId: 'run-1', message: 'first' });
    logger.append({ agentId: 'daily-focus', runId: 'run-1', message: 'second' });

    expect(readRecords(root, 'daily-focus').map((record) => record.message)).toEqual(['first', 'second']);
  });

  it('starts a new file each day', () => {
    let clock = new Date('2026-08-13T23:59:00.000Z');
    const { root, logger } = createStore({ now: () => clock });

    logger.append({ agentId: 'daily-focus', runId: 'run-1', message: 'late' });
    clock = new Date('2026-08-14T00:01:00.000Z');
    logger.append({ agentId: 'daily-focus', runId: 'run-2', message: 'early' });

    expect(readdirSync(join(root, 'daily-focus')).sort()).toEqual(['2026-08-13.jsonl', '2026-08-14.jsonl']);
  });

  it('keeps an agent with a traversing id inside the log root', () => {
    const { root, logger } = createStore();

    logger.append({ agentId: '../../escape', runId: '../run', message: 'nope' });

    expect(readdirSync(root)).toEqual(['escape']);
  });

  it('writes logs only the owner can read', () => {
    const { root, logger } = createStore();

    logger.append({ agentId: 'daily-focus', runId: 'run-1', message: 'private' });

    expect(statSync(join(root, 'daily-focus', '2026-08-13.jsonl')).mode & 0o777).toBe(0o600);
  });

  it('defaults the level to info and accepts the levels a viewer expects', () => {
    const { root, logger } = createStore();

    logger.append({ agentId: 'daily-focus', runId: 'run-1', message: 'plain' });
    logger.append({ agentId: 'daily-focus', runId: 'run-1', message: 'bad', level: 'error' });

    expect(readRecords(root, 'daily-focus').map((record) => record.level)).toEqual(['info', 'error']);
  });

  it('deletes day files past the retention window', () => {
    const { root, logger } = createStore({ retentionDays: 7 });
    const folder = join(root, 'daily-focus');
    mkdirSync(folder, { recursive: true });
    const stale = join(folder, '2026-07-01.jsonl');
    writeFileSync(stale, '{}\n');
    const staleDate = new Date('2026-07-01T00:00:00.000Z');
    utimesSync(stale, staleDate, staleDate);

    logger.append({ agentId: 'daily-focus', runId: 'run-1', message: 'today' });

    expect(readdirSync(folder)).toEqual(['2026-08-13.jsonl']);
  });

  it('reads back the entries for a run, oldest first', () => {
    const { logger } = createStore();

    logger.append({ agentId: 'daily-focus', runId: 'run-1', message: 'first' });
    logger.append({ agentId: 'daily-focus', runId: 'run-2', message: 'other run' });
    logger.append({ agentId: 'daily-focus', runId: 'run-1', message: 'second' });

    expect(logger.readRun({ agentId: 'daily-focus', runId: 'run-1' }).map((entry) => entry.message))
      .toEqual(['first', 'second']);
  });
});
