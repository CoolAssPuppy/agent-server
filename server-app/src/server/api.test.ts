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

  describe('agent capabilities enrichment', () => {
    it('includes derived capabilities on GET /agents', async () => {
      const app = createApp();
      const res = await app.request('/agents');
      const body = await res.json() as Array<{ capabilities: Array<{ id: string; enabled: boolean }> }>;

      const readFiles = body[0].capabilities.find((cap) => cap.id === 'read-files');
      expect(readFiles?.enabled).toBe(true);
    });

    it('redacts hard-coded mcp secrets on GET /agents/:id', async () => {
      const agents = [makeAgent({
        mcp_servers: {
          notion: { command: 'npx', env: { NOTION_TOKEN: 'ntn_literal_secret', REF: '${NOTION_API_KEY}' } },
        },
      })];
      const app = createApi({ getAgents: async () => agents, store, triggerRun });

      const res = await app.request('/agents/test-agent');
      const body = await res.json() as {
        mcp_servers: Record<string, { env?: Record<string, string> }>;
      };
      expect(body.mcp_servers.notion.env?.NOTION_TOKEN).toBe('__redacted__');
      expect(body.mcp_servers.notion.env?.REF).toBe('${NOTION_API_KEY}');
    });

    it('serves the capability catalog', async () => {
      const app = createApi({
        getAgents: async () => [],
        store,
        triggerRun,
        getEnv: () => ({ NOTION_API_KEY: 'x' }),
      });
      const res = await app.request('/capabilities');
      expect(res.status).toBe(200);

      const body = await res.json() as { capabilities: Array<{ id: string; env_ready: boolean }> };
      expect(body.capabilities.find((cap) => cap.id === 'notion')?.env_ready).toBe(true);
      expect(body.capabilities.find((cap) => cap.id === 'slack')?.env_ready).toBe(false);
    });
  });

  describe('agent write routes', () => {
    function createWriterApp(writer: Partial<import('../agents/writer.js').AgentWriter>) {
      return createApi({
        getAgents: async () => [makeAgent()],
        store,
        triggerRun,
        agentWriter: {
          update: vi.fn().mockRejectedValue(new Error('not stubbed')),
          create: vi.fn().mockRejectedValue(new Error('not stubbed')),
          remove: vi.fn().mockRejectedValue(new Error('not stubbed')),
          ...writer,
        },
      });
    }

    it('returns 501 when no writer is configured', async () => {
      const app = createApp();
      const res = await app.request('/agents/test-agent', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: '{"name":"Renamed"}',
      });
      expect(res.status).toBe(501);
    });

    it('updates an agent and returns the enriched result', async () => {
      const update = vi.fn().mockResolvedValue(makeAgent({ name: 'Renamed' }));
      const app = createWriterApp({ update });

      const res = await app.request('/agents/test-agent', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed', capabilities: [{ id: 'run-commands', enabled: false }] }),
      });

      expect(res.status).toBe(200);
      expect(update).toHaveBeenCalledWith('test-agent', {
        name: 'Renamed',
        capabilities: [{ id: 'run-commands', enabled: false }],
      });
      const body = await res.json() as { name: string; capabilities: unknown[] };
      expect(body.name).toBe('Renamed');
      expect(Array.isArray(body.capabilities)).toBe(true);
    });

    it('rejects patches with unknown fields', async () => {
      const app = createWriterApp({});
      const res = await app.request('/agents/test-agent', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: '{"id":"sneaky-rename"}',
      });
      expect(res.status).toBe(400);
    });

    it('maps missing_env write errors to 409 with the variable list', async () => {
      const { AgentWriteError } = await import('../agents/writer.js');
      const update = vi.fn().mockRejectedValue(
        new AgentWriteError('needs env', 'missing_env', ['NOTION_API_KEY']),
      );
      const app = createWriterApp({ update });

      const res = await app.request('/agents/test-agent', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: '{"name":"X"}',
      });
      expect(res.status).toBe(409);
      const body = await res.json() as { missing_env: string[] };
      expect(body.missing_env).toEqual(['NOTION_API_KEY']);
    });

    it('maps not_found write errors to 404', async () => {
      const { AgentWriteError } = await import('../agents/writer.js');
      const update = vi.fn().mockRejectedValue(new AgentWriteError('nope', 'not_found'));
      const app = createWriterApp({ update });

      const res = await app.request('/agents/ghost', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: '{"name":"X"}',
      });
      expect(res.status).toBe(404);
    });

    it('creates an agent and returns 201', async () => {
      const create = vi.fn().mockResolvedValue(makeAgent({ id: 'new-agent', name: 'New Agent' }));
      const app = createWriterApp({ create });

      const res = await app.request('/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'New Agent', prompt: 'Do things.' }),
      });

      expect(res.status).toBe(201);
      expect(create).toHaveBeenCalledWith({ name: 'New Agent', prompt: 'Do things.' });
    });

    it('accepts write bodies larger than the default limit', async () => {
      const update = vi.fn().mockResolvedValue(makeAgent());
      const app = createWriterApp({ update });

      const bigPrompt = 'x'.repeat(30_000);
      const body = JSON.stringify({ prompt: bigPrompt });
      const res = await app.request('/agents/test-agent', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
        },
        body,
      });
      expect(res.status).toBe(200);
    });

    it('still rejects oversized bodies on other routes', async () => {
      const app = createApp();
      const res = await app.request('/agents/test-agent/run', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(30_000),
        },
        body: '{}',
      });
      expect(res.status).toBe(413);
    });

    it('deletes an agent', async () => {
      const remove = vi.fn().mockResolvedValue(undefined);
      const app = createWriterApp({ remove });

      const res = await app.request('/agents/test-agent', { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(remove).toHaveBeenCalledWith('test-agent');
    });

    it('requires the api key on write routes when configured', async () => {
      const app = createApi({
        getAgents: async () => [makeAgent()],
        store,
        triggerRun,
        agentWriter: {
          update: vi.fn().mockResolvedValue(makeAgent()),
          create: vi.fn(),
          remove: vi.fn(),
        },
        apiKey: 'secret-key',
      });

      const res = await app.request('/agents/test-agent', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: '{"name":"X"}',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('connections', () => {
    it('GET /connections serves an empty snapshot when no cache is wired', async () => {
      const app = createApp();
      const res = await app.request('/connections');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ servers: [], discovered_at: null });
    });

    it('GET /connections returns the cached snapshot', async () => {
      const snapshot = {
        servers: [{ name: 'claude.ai Slack', status: 'connected' }],
        discovered_at: '2026-07-18T00:00:00.000Z',
      };
      const app = createApi({
        getAgents: async () => [makeAgent()],
        store,
        triggerRun,
        connections: { get: () => snapshot, refresh: async () => snapshot },
      });
      const res = await app.request('/connections');
      expect(await res.json()).toEqual(snapshot);
    });

    it('POST /connections/refresh re-probes and returns the new snapshot', async () => {
      const refreshed = {
        servers: [{ name: 'eventkit', status: 'connected' }],
        discovered_at: '2026-07-18T01:00:00.000Z',
      };
      const refresh = vi.fn().mockResolvedValue(refreshed);
      const app = createApi({
        getAgents: async () => [makeAgent()],
        store,
        triggerRun,
        connections: { get: () => ({ servers: [], discovered_at: null }), refresh },
      });
      const res = await app.request('/connections/refresh', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(refreshed);
      expect(refresh).toHaveBeenCalledOnce();
    });

    it('enriches agents with capabilities derived from discovered connectors', async () => {
      const snapshot = {
        servers: [{ name: 'claude.ai Slack', status: 'connected' }],
        discovered_at: '2026-07-18T00:00:00.000Z',
      };
      const app = createApi({
        getAgents: async () => [makeAgent()],
        store,
        triggerRun,
        connections: { get: () => snapshot, refresh: async () => snapshot },
      });
      const res = await app.request('/agents/test-agent');
      const body = await res.json();
      const slack = body.capabilities.find((cap: { id: string }) => cap.id === 'slack');
      expect(slack).toBeDefined();
      expect(slack.server_name).toBe('claude_ai_Slack');
      expect(slack.status).toBe('connected');
    });
  });
});
