import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApi } from './api.js';
import { RunStore, type StoredRun } from './store.js';
import type { AgentConfig } from './agent-config.js';

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    description: 'A test agent',
    schedule: '*/5 * * * *',
    prompt: 'Do something.',
    tools: ['Read', 'Bash'],
    max_turns: 10,
    enabled: true,
    ...overrides,
  };
}

function makeRun(overrides: Partial<StoredRun> = {}): StoredRun {
  return {
    runId: 'run-1',
    agentId: 'test-agent',
    agentName: 'Test Agent',
    status: 'completed',
    startedAt: new Date('2026-03-09T10:00:00Z'),
    turnCount: 3,
    toolsUsed: ['Read'],
    filesRead: ['/tmp/a.ts'],
    filesWritten: [],
    commandsRun: [],
    progressMessages: ['Step 1'],
    ...overrides,
  };
}

describe('API routes', () => {
  let store: RunStore;
  let agents: AgentConfig[];
  let triggerRun: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = new RunStore();
    agents = [makeAgent(), makeAgent({ id: 'other-agent', name: 'Other' })];
    triggerRun = vi.fn().mockResolvedValue('run-123');
  });

  function createApp() {
    return createApi({
      getAgents: async () => agents,
      store,
      triggerRun,
    });
  }

  describe('GET /agents', () => {
    it('returns all agents', async () => {
      const app = createApp();
      const res = await app.request('/agents');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveLength(2);
      expect(body[0].id).toBe('test-agent');
    });
  });

  describe('GET /agents/:id', () => {
    it('returns a specific agent', async () => {
      const app = createApp();
      const res = await app.request('/agents/test-agent');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.id).toBe('test-agent');
      expect(body.name).toBe('Test Agent');
    });

    it('returns 404 for unknown agent', async () => {
      const app = createApp();
      const res = await app.request('/agents/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /agents/:id/run', () => {
    it('triggers a run and returns run ID', async () => {
      const app = createApp();
      const res = await app.request('/agents/test-agent/run', { method: 'POST' });
      expect(res.status).toBe(202);

      const body = await res.json();
      expect(body.runId).toBe('run-123');
      expect(triggerRun).toHaveBeenCalledWith('test-agent');
    });

    it('returns 404 for unknown agent', async () => {
      const app = createApp();
      const res = await app.request('/agents/nonexistent/run', { method: 'POST' });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /runs', () => {
    it('returns all runs', async () => {
      store.add(makeRun({ runId: 'r1' }));
      store.add(makeRun({ runId: 'r2' }));

      const app = createApp();
      const res = await app.request('/runs');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveLength(2);
    });

    it('filters runs by agent_id query param', async () => {
      store.add(makeRun({ runId: 'r1', agentId: 'agent-a' }));
      store.add(makeRun({ runId: 'r2', agentId: 'agent-b' }));

      const app = createApp();
      const res = await app.request('/runs?agent_id=agent-a');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].agentId).toBe('agent-a');
    });
  });

  describe('GET /runs/:id', () => {
    it('returns a specific run', async () => {
      store.add(makeRun());
      const app = createApp();
      const res = await app.request('/runs/run-1');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.runId).toBe('run-1');
      expect(body.progressMessages).toEqual(['Step 1']);
    });

    it('returns 404 for unknown run', async () => {
      const app = createApp();
      const res = await app.request('/runs/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /health', () => {
    it('returns ok', async () => {
      const app = createApp();
      const res = await app.request('/health');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe('ok');
    });
  });
});
