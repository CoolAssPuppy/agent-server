import { describe, it, expect, vi } from 'vitest';
import { PanelClient } from '../reporting/panel-client.js';
import { RunStore, type StoredRun } from '../reporting/store.js';
import { seedRunStoreFromPanel, panelRowToStoredRun } from './seed-run-store.js';

type MockResponse = { ok: boolean; status: number; body?: unknown };

function createMockFetch(response: MockResponse) {
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status,
    json: async () => response.body,
  });
}

function getMockPanelRow(overrides?: Record<string, unknown>) {
  return {
    id: 'run-1',
    task_id: 'task-a',
    task_name: 'Report Builder',
    status: 'completed',
    trigger: 'scheduled',
    queued_at: '2026-04-15T09:00:00.000Z',
    started_at: '2026-04-15T09:00:01.000Z',
    ended_at: '2026-04-15T09:00:30.000Z',
    duration_ms: 29000,
    error_message: null,
    result: {
      summary: 'Generated report',
      files_written: ['/tmp/out.md'],
    },
    conversation_id: null,
    ...overrides,
  };
}

function getMockStoredRun(overrides?: Partial<StoredRun>): StoredRun {
  return {
    runId: 'run-local-1',
    agentId: 'task-a',
    agentName: 'Report Builder',
    status: 'running',
    startedAt: new Date('2026-04-15T10:00:00.000Z'),
    turnCount: 3,
    toolsUsed: ['Bash'],
    filesRead: [],
    filesWritten: [],
    commandsRun: [],
    progressMessages: ['halfway there'],
    ...overrides,
  };
}

describe('panelRowToStoredRun', () => {
  it('converts a completed panel row into a StoredRun', () => {
    const row = getMockPanelRow();
    const result = panelRowToStoredRun(row);

    expect(result).not.toBeNull();
    expect(result?.runId).toBe('run-1');
    expect(result?.agentId).toBe('task-a');
    expect(result?.agentName).toBe('Report Builder');
    expect(result?.status).toBe('completed');
    expect(result?.summary).toBe('Generated report');
    expect(result?.filesWritten).toEqual(['/tmp/out.md']);
    expect(result?.completedAt?.toISOString()).toBe('2026-04-15T09:00:30.000Z');
  });

  it('skips non-terminal panel rows (daemon owns in-flight state)', () => {
    expect(panelRowToStoredRun(getMockPanelRow({ status: 'working', ended_at: null }))).toBeNull();
    expect(panelRowToStoredRun(getMockPanelRow({ status: 'submitted', ended_at: null }))).toBeNull();
    expect(panelRowToStoredRun(getMockPanelRow({ status: 'input_required', ended_at: null }))).toBeNull();
  });

  it('maps canceled panel status to failed', () => {
    const row = getMockPanelRow({ status: 'canceled' });
    const result = panelRowToStoredRun(row);
    expect(result?.status).toBe('failed');
  });

  it('returns null when no timestamp is available', () => {
    const row = getMockPanelRow({ started_at: null, queued_at: null });
    expect(panelRowToStoredRun(row)).toBeNull();
  });
});

describe('seedRunStoreFromPanel', () => {
  it('populates the run store when the panel returns rows', async () => {
    const mockFetch = createMockFetch({
      ok: true,
      status: 200,
      body: { runs: [getMockPanelRow({ id: 'a' }), getMockPanelRow({ id: 'b' })] },
    });
    const client = new PanelClient({
      panelUrl: 'https://panel.example.com',
      panelApiKey: 'key',
      fetch: mockFetch,
    });
    const store = new RunStore();

    const result = await seedRunStoreFromPanel({ panelClient: client, store });

    expect(result.inserted).toBe(2);
    expect(result.skipped).toBe(0);
    expect(store.list().map((r) => r.runId).sort()).toEqual(['a', 'b']);
  });

  it('does not overwrite an in-flight run already in the store', async () => {
    const inFlight = getMockStoredRun({ runId: 'run-1', status: 'running', turnCount: 7 });
    const store = new RunStore();
    store.add(inFlight);

    const mockFetch = createMockFetch({
      ok: true,
      status: 200,
      body: { runs: [getMockPanelRow({ id: 'run-1', status: 'failed', error_message: 'stale' })] },
    });
    const client = new PanelClient({
      panelUrl: 'https://panel.example.com',
      panelApiKey: 'key',
      fetch: mockFetch,
    });

    const result = await seedRunStoreFromPanel({ panelClient: client, store });

    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);
    const kept = store.get('run-1');
    expect(kept?.status).toBe('running');
    expect(kept?.turnCount).toBe(7);
  });

  it('throws when the panel returns a non-ok response', async () => {
    const mockFetch = createMockFetch({ ok: false, status: 502 });
    const client = new PanelClient({
      panelUrl: 'https://panel.example.com',
      panelApiKey: 'key',
      fetch: mockFetch,
    });
    const store = new RunStore();

    await expect(seedRunStoreFromPanel({ panelClient: client, store })).rejects.toThrow(/502/);
    expect(store.list()).toHaveLength(0);
  });
});
