import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApi } from './api.js';
import { RunStore } from '../reporting/store.js';
import { makeAgent, makeStoredRun } from '../test-factories.js';

describe('API routes', () => {
  let store: RunStore;
  let triggerRun: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = new RunStore();
    triggerRun = vi.fn().mockResolvedValue('run-123');
  });

  function createApp(host?: string) {
    const agents = [makeAgent(), makeAgent({ id: 'other-agent', name: 'Other' })];
    return createApi({
      getAgents: async () => agents,
      store,
      triggerRun,
      cancelRun: vi.fn().mockReturnValue(false),
      host,
    });
  }

  function createSecuredApp(apiKey = 'secret-key') {
    const agents = [makeAgent(), makeAgent({ id: 'other-agent', name: 'Other' })];
    return createApi({
      getAgents: async () => agents,
      store,
      triggerRun,
      cancelRun: vi.fn().mockReturnValue(false),
      apiKey,
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

    it('returns scheduled, watch-only, on-demand, and disabled definitions without inventing schedules', async () => {
      const agents = [
        makeAgent({ id: 'scheduled', schedule: '0 9 * * *' }),
        makeAgent({ id: 'watch-only', schedule: undefined, watch: [{ path: '/tmp/manuscript.docx' }] }),
        makeAgent({ id: 'on-demand', schedule: undefined, watch: undefined }),
        makeAgent({ id: 'disabled', enabled: false, schedule: undefined }),
      ];
      const app = createApi({
        getAgents: async () => agents,
        store,
        triggerRun,
      });

      const res = await app.request('/agents');
      const body = await res.json() as Array<Record<string, unknown>>;

      expect(body.map((agent) => agent.id)).toEqual([
        'scheduled',
        'watch-only',
        'on-demand',
        'disabled',
      ]);
      expect(body.find((agent) => agent.id === 'watch-only')?.schedule).toBeUndefined();
      expect(body.find((agent) => agent.id === 'on-demand')?.schedule).toBeUndefined();
      expect(body.find((agent) => agent.id === 'disabled')?.enabled).toBe(false);
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


    it('blocks cross-origin mutation requests', async () => {
      const app = createApp('127.0.0.1');
      const res = await app.request('/agents/test-agent/run', {
        method: 'POST',
        headers: { Origin: 'https://evil.example' },
      });

      expect(res.status).toBe(403);
    });

    it('allows loopback origin mutation requests when server host is loopback', async () => {
      const app = createApp('127.0.0.1');
      const res = await app.request('/agents/test-agent/run', {
        method: 'POST',
        headers: { Origin: 'http://localhost:3000' },
      });

      expect(res.status).toBe(202);
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
      expect(triggerRun).toHaveBeenCalledWith('test-agent', undefined);
    });

    it('passes prompt suffix from request body', async () => {
      const app = createApp();
      const res = await app.request('/agents/test-agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ with: 'Bougainville tonight for 4' }),
      });
      expect(res.status).toBe(202);
      expect(triggerRun).toHaveBeenCalledWith('test-agent', 'Bougainville tonight for 4');
    });

    it('rejects invalid request body', async () => {
      const app = createApp();
      const res = await app.request('/agents/test-agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ with: 123 }),
      });

      expect(res.status).toBe(400);
    });

    it('rejects invalid JSON request body', async () => {
      const app = createApp();
      const res = await app.request('/agents/test-agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{bad',
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown agent', async () => {
      const app = createApp();
      const res = await app.request('/agents/nonexistent/run', { method: 'POST' });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /runs', () => {
    it('returns all runs', async () => {
      store.add(makeStoredRun({ runId: 'r1' }));
      store.add(makeStoredRun({ runId: 'r2' }));

      const app = createApp();
      const res = await app.request('/runs');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveLength(2);
    });

    it('filters runs by agent_id query param', async () => {
      store.add(makeStoredRun({ runId: 'r1', agentId: 'agent-a' }));
      store.add(makeStoredRun({ runId: 'r2', agentId: 'agent-b' }));

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
      store.add(makeStoredRun({ progressMessages: ['Step 1'] }));
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

  describe('POST /runs/:id/cancel', () => {
    it('cancels a running run', async () => {
      store.add(makeStoredRun({ runId: 'r1', status: 'running' }));
      const cancelRun = vi.fn().mockReturnValue(true);
      const app = createApi({
        getAgents: async () => [makeAgent()],
        store,
        triggerRun,
        cancelRun,
      });

      const res = await app.request('/runs/r1/cancel', { method: 'POST' });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe('cancelled');
      expect(cancelRun).toHaveBeenCalledWith('r1');
    });

    it('returns 404 for unknown run', async () => {
      const cancelRun = vi.fn().mockReturnValue(false);
      const app = createApi({
        getAgents: async () => [makeAgent()],
        store,
        triggerRun,
        cancelRun,
      });

      const res = await app.request('/runs/nonexistent/cancel', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('returns 409 when run is not running', async () => {
      store.add(makeStoredRun({ runId: 'r1', status: 'completed' }));
      const cancelRun = vi.fn().mockReturnValue(false);
      const app = createApi({
        getAgents: async () => [makeAgent()],
        store,
        triggerRun,
        cancelRun,
      });

      const res = await app.request('/runs/r1/cancel', { method: 'POST' });
      expect(res.status).toBe(409);
    });
  });

  describe('DELETE /runs/:id', () => {
    it('deletes an existing run', async () => {
      store.add(makeStoredRun({ runId: 'r-del-1', status: 'completed' }));
      const app = createApp('127.0.0.1');

      const res = await app.request('/runs/r-del-1', { method: 'DELETE' });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(store.get('r-del-1')).toBeUndefined();
    });

    it('returns 404 when the run does not exist', async () => {
      const app = createApp('127.0.0.1');
      const res = await app.request('/runs/missing', { method: 'DELETE' });
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

    it('returns started_at timestamp when provided', async () => {
      const startedAt = '2026-03-12T10:00:00.000Z';
      const agents = [makeAgent()];
      const app = createApi({
        getAgents: async () => agents,
        store,
        triggerRun,
        startedAt,
      });

      const res = await app.request('/health');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.started_at).toBe(startedAt);
    });
  });


  describe('POST /cleanup', () => {
    it('calls cleanupFn and returns result', async () => {
      const cleanupFn = vi.fn().mockResolvedValue(3);
      const agents = [makeAgent()];
      const app = createApi({
        getAgents: async () => agents,
        store,
        triggerRun,
        cleanupFn,
      });

      const res = await app.request('/cleanup', { method: 'POST' });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.cleaned).toBe(3);
      expect(cleanupFn).toHaveBeenCalledOnce();
    });

    it('returns 501 when no cleanup function is configured', async () => {
      const app = createApp();
      const res = await app.request('/cleanup', { method: 'POST' });
      expect(res.status).toBe(501);
    });
  });

  describe('security middleware', () => {
    it('sets security headers', async () => {
      const app = createApp();
      const res = await app.request('/health');

      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('cache-control')).toBe('no-store');
    });

    it('requires json content type for non-empty trigger body', async () => {
      const app = createApp();
      const res = await app.request('/agents/test-agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: '{"with":"hello"}',
      });

      expect(res.status).toBe(415);
    });
  });
  describe('API key authentication', () => {
    it('rejects unauthorized requests when api key is configured', async () => {
      const app = createSecuredApp();
      const res = await app.request('/agents');

      expect(res.status).toBe(401);
    });

    it('accepts x-agent-server-key header', async () => {
      const app = createSecuredApp();
      const res = await app.request('/agents', {
        headers: { 'x-agent-server-key': 'secret-key' },
      });

      expect(res.status).toBe(200);
    });

    it('accepts bearer auth header', async () => {
      const app = createSecuredApp();
      const res = await app.request('/agents', {
        headers: { Authorization: 'Bearer secret-key' },
      });

      expect(res.status).toBe(200);
    });

    it('keeps health endpoint public', async () => {
      const app = createSecuredApp();
      const res = await app.request('/health');

      expect(res.status).toBe(200);
    });
  });
});
