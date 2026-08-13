import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, utimesSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentLogStore, LogEntryTooLargeError } from './log-store.js';

function createStore(overrides: Partial<{ maxBytes: number; retentionDays: number; now: () => Date }> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'agent-logs-'));
  return {
    root,
    store: new AgentLogStore({
      root,
      machineId: 'machine-uuid',
      hostname: 'test-mac',
      now: () => new Date('2026-08-13T06:45:00.000Z'),
      ...overrides,
    }),
  };
}

function readRecords(root: string, agentId: string, date = '2026-08-13'): Record<string, unknown>[] {
  const text = readFileSync(join(root, agentId, `${date}.jsonl`), 'utf8');
  return text.trimEnd().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('agent log store', () => {
  it('writes one JSON object per line with the standard fields first', () => {
    const { root, store } = createStore();

    store.append({ agentId: 'daily-focus', runId: 'run-1', message: 'Notion write failed' });

    const raw = readFileSync(join(root, 'daily-focus', '2026-08-13.jsonl'), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw.split('\n')).toHaveLength(2);
    expect(Object.keys(JSON.parse(raw.split('\n')[0]) as object).slice(0, 3))
      .toEqual(['timestamp', 'level', 'message']);
  });

  it('records who produced the entry so one panel can tell machines apart', () => {
    const { root, store } = createStore();

    store.append({ agentId: 'daily-focus', runId: 'run-1', message: 'Started' });

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
    const { root, store } = createStore();
    const body = '# Report\nline two\n';

    store.append({ agentId: 'daily-focus', runId: 'run-1', message: 'Unsent page', body });

    const records = readRecords(root, 'daily-focus');
    expect(records).toHaveLength(1);
    expect(records[0].body).toBe(body);
  });

  it('appends to the same day file rather than replacing it', () => {
    const { root, store } = createStore();

    store.append({ agentId: 'daily-focus', runId: 'run-1', message: 'first' });
    store.append({ agentId: 'daily-focus', runId: 'run-1', message: 'second' });

    expect(readRecords(root, 'daily-focus').map((record) => record.message)).toEqual(['first', 'second']);
  });

  it('starts a new file each day', () => {
    const { root } = createStore();
    let clock = new Date('2026-08-13T23:59:00.000Z');
    const store = new AgentLogStore({
      root, machineId: 'machine-uuid', hostname: 'test-mac', now: () => clock,
    });

    store.append({ agentId: 'daily-focus', runId: 'run-1', message: 'late' });
    clock = new Date('2026-08-14T00:01:00.000Z');
    store.append({ agentId: 'daily-focus', runId: 'run-2', message: 'early' });

    expect(readdirSync(join(root, 'daily-focus')).sort()).toEqual(['2026-08-13.jsonl', '2026-08-14.jsonl']);
  });

  it('rejects an oversized entry without writing a partial line', () => {
    const { root, store } = createStore({ maxBytes: 64 });

    expect(() => store.append({
      agentId: 'daily-focus', runId: 'run-1', message: 'big', body: 'x'.repeat(200),
    })).toThrow(LogEntryTooLargeError);
    expect(readdirSync(root)).toEqual([]);
  });

  it('keeps an agent with a traversing id inside the log root', () => {
    const { root, store } = createStore();

    store.append({ agentId: '../../escape', runId: '../run', message: 'nope' });

    expect(readdirSync(root)).toEqual(['escape']);
  });

  it('writes logs only the owner can read', () => {
    const { root, store } = createStore();

    store.append({ agentId: 'daily-focus', runId: 'run-1', message: 'private' });

    expect(statSync(join(root, 'daily-focus', '2026-08-13.jsonl')).mode & 0o777).toBe(0o600);
  });

  it('defaults the level to info and accepts the levels a viewer expects', () => {
    const { root, store } = createStore();

    store.append({ agentId: 'daily-focus', runId: 'run-1', message: 'plain' });
    store.append({ agentId: 'daily-focus', runId: 'run-1', message: 'bad', level: 'error' });

    expect(readRecords(root, 'daily-focus').map((record) => record.level)).toEqual(['info', 'error']);
  });

  it('carries caller supplied fields without letting them overwrite the standard ones', () => {
    const { root, store } = createStore();

    store.append({
      agentId: 'daily-focus',
      runId: 'run-1',
      message: 'Spend check',
      data: { spend: 42, agent_id: 'spoofed', level: 'debug' },
    });

    const record = readRecords(root, 'daily-focus')[0];
    expect(record).toMatchObject({ spend: 42, agent_id: 'daily-focus', level: 'info' });
  });

  it('deletes day files past the retention window', () => {
    const { root, store } = createStore({ retentionDays: 7 });
    const folder = join(root, 'daily-focus');
    mkdirSync(folder, { recursive: true });
    const stale = join(folder, '2026-07-01.jsonl');
    writeFileSync(stale, '{}\n');
    const staleDate = new Date('2026-07-01T00:00:00.000Z');
    utimesSync(stale, staleDate, staleDate);

    store.append({ agentId: 'daily-focus', runId: 'run-1', message: 'today' });

    expect(readdirSync(folder)).toEqual(['2026-08-13.jsonl']);
  });

  it('reads back the entries for a run, oldest first', () => {
    const { store } = createStore();

    store.append({ agentId: 'daily-focus', runId: 'run-1', message: 'first' });
    store.append({ agentId: 'daily-focus', runId: 'run-2', message: 'other run' });
    store.append({ agentId: 'daily-focus', runId: 'run-1', message: 'second' });

    expect(store.readRun({ agentId: 'daily-focus', runId: 'run-1' }).map((entry) => entry.message))
      .toEqual(['first', 'second']);
  });
});
