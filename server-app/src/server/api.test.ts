import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createApi as createProductionApi } from './api.js';
import { RunStore } from '../reporting/store.js';
import { makeAgent, makeStoredRun } from '../test-factories.js';
import { RunPreflightDeniedError } from '../analysis/run-preflight-gate.js';

const API_TEST_KEY = 'local-api-test-key-1234567890';

type ApiDependencies = Parameters<typeof createProductionApi>[0];

function createApi(
  dependencies: Omit<ApiDependencies, 'apiKey'> & { apiKey?: string },
): ReturnType<typeof createProductionApi> {
  return createProductionApi({
    ...dependencies,
    apiKey: dependencies.apiKey ?? API_TEST_KEY,
  });
}

function authenticatedRequest(
  app: ReturnType<typeof createApi>,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('x-agent-server-key', API_TEST_KEY);
  return app.request(path, { ...init, headers });
}

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

  function createSecuredApp(apiKey = API_TEST_KEY) {
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
      const res = await authenticatedRequest(app, '/agents');
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

      const res = await authenticatedRequest(app, '/agents');
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
      const res = await authenticatedRequest(app, '/agents/test-agent');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.id).toBe('test-agent');
      expect(body.name).toBe('Test Agent');
    });


    it('blocks cross-origin mutation requests', async () => {
      const app = createApp('127.0.0.1');
      const res = await authenticatedRequest(app, '/agents/test-agent/run', {
        method: 'POST',
        headers: { Origin: 'https://evil.example' },
      });

      expect(res.status).toBe(403);
    });

    it('allows loopback origin mutation requests when server host is loopback', async () => {
      const app = createApp('127.0.0.1');
      const res = await authenticatedRequest(app, '/agents/test-agent/run', {
        method: 'POST',
        headers: { Origin: 'http://localhost:3000' },
      });

      expect(res.status).toBe(202);
    });
    it('returns 404 for unknown agent', async () => {
      const app = createApp();
      const res = await authenticatedRequest(app, '/agents/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /services', () => {
    it('returns distinct configured and account-backed service connections without secrets', async () => {
      const agent = makeAgent({
        mcp_servers: {
          'notion-personal': {
            command: 'npx',
            args: ['-y', '@notionhq/notion-mcp-server'],
            env: { NOTION_TOKEN: '${NOTION_PERSONAL_API_KEY}' },
          },
        },
      });
      const app = createApi({
        getAgents: async () => [agent],
        store,
        triggerRun,
        getEnv: () => ({ NOTION_PERSONAL_API_KEY: 'personal-secret' }),
        connections: {
          get: () => ({
            servers: [{ name: 'claude.ai Notion', status: 'connected' }],
            discovered_at: '2026-07-18T12:00:00.000Z',
          }),
          refresh: async () => ({ servers: [], discovered_at: null }),
        },
      });

      const response = await authenticatedRequest(app, '/services');
      const body = await response.json() as { connections: Array<Record<string, unknown>> };

      expect(response.status).toBe(200);
      expect(body.connections).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Personal Notion', source: 'configured_api' }),
        expect.objectContaining({ name: 'Notion (Claude account)', source: 'account' }),
      ]));
      expect(JSON.stringify(body)).not.toContain('personal-secret');
      expect(JSON.stringify(body)).not.toContain('NOTION_PERSONAL_API_KEY');
    });
  });

  describe('POST /agents/:id/run', () => {
    it('triggers a run and returns run ID', async () => {
      const app = createApp();
      const res = await authenticatedRequest(app, '/agents/test-agent/run', { method: 'POST' });
      expect(res.status).toBe(202);

      const body = await res.json();
      expect(body.runId).toBe('run-123');
      expect(triggerRun).toHaveBeenCalledWith('test-agent', undefined);
    });

    it('passes prompt suffix from request body', async () => {
      const app = createApp();
      const res = await authenticatedRequest(app, '/agents/test-agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ with: 'Bougainville tonight for 4' }),
      });
      expect(res.status).toBe(202);
      expect(triggerRun).toHaveBeenCalledWith('test-agent', 'Bougainville tonight for 4');
    });

    it('rejects invalid request body', async () => {
      const app = createApp();
      const res = await authenticatedRequest(app, '/agents/test-agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ with: 123 }),
      });

      expect(res.status).toBe(400);
    });

    it('rejects invalid JSON request body', async () => {
      const app = createApp();
      const res = await authenticatedRequest(app, '/agents/test-agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{bad',
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown agent', async () => {
      const app = createApp();
      const res = await authenticatedRequest(app, '/agents/nonexistent/run', { method: 'POST' });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /agents/:id/safe-test', () => {
    it('uses the dedicated restricted trigger path', async () => {
      const triggerSafeTest = vi.fn().mockResolvedValue('safe-run');
      const app = createApi({
        getAgents: async () => [makeAgent()],
        store,
        triggerRun,
        triggerSafeTest,
      });

      const response = await authenticatedRequest(app, '/agents/test-agent/safe-test', { method: 'POST' });

      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ runId: 'safe-run', agentId: 'test-agent', mode: 'safe_test' });
      expect(triggerSafeTest).toHaveBeenCalledWith('test-agent');
      expect(triggerRun).not.toHaveBeenCalled();
    });
  });

  describe('GET /runs', () => {
    it('returns all runs', async () => {
      store.add(makeStoredRun({ runId: 'r1' }));
      store.add(makeStoredRun({ runId: 'r2' }));

      const app = createApp();
      const res = await authenticatedRequest(app, '/runs');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveLength(2);
    });

    it('filters runs by agent_id query param', async () => {
      store.add(makeStoredRun({ runId: 'r1', agentId: 'agent-a' }));
      store.add(makeStoredRun({ runId: 'r2', agentId: 'agent-b' }));

      const app = createApp();
      const res = await authenticatedRequest(app, '/runs?agent_id=agent-a');
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
      const res = await authenticatedRequest(app, '/runs/run-1');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.runId).toBe('run-1');
      expect(body.progressMessages).toEqual(['Step 1']);
    });

    it('returns retry linkage while redacting unsafe identifier content', async () => {
      store.add(makeStoredRun({
        retryOfRunId: 'failed-token="secret-retry-value"',
        repairId: 'repair-token="secret-repair-value"',
      }));
      const app = createApp();

      const res = await authenticatedRequest(app, '/runs/run-1');
      const body = await res.json();

      expect(body.retryOfRunId).toContain('[REDACTED]');
      expect(body.repairId).toContain('[REDACTED]');
      expect(JSON.stringify(body)).not.toContain('secret-retry-value');
      expect(JSON.stringify(body)).not.toContain('secret-repair-value');
    });

    it('returns 404 for unknown run', async () => {
      const app = createApp();
      const res = await authenticatedRequest(app, '/runs/nonexistent');
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

      const res = await authenticatedRequest(app, '/runs/r1/cancel', { method: 'POST' });
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

      const res = await authenticatedRequest(app, '/runs/nonexistent/cancel', { method: 'POST' });
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

      const res = await authenticatedRequest(app, '/runs/r1/cancel', { method: 'POST' });
      expect(res.status).toBe(409);
    });
  });

  describe('DELETE /runs/:id', () => {
    it('deletes an existing run', async () => {
      store.add(makeStoredRun({ runId: 'r-del-1', status: 'completed' }));
      const app = createApp('127.0.0.1');

      const res = await authenticatedRequest(app, '/runs/r-del-1', { method: 'DELETE' });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(store.get('r-del-1')).toBeUndefined();
    });

    it('returns 404 when the run does not exist', async () => {
      const app = createApp('127.0.0.1');
      const res = await authenticatedRequest(app, '/runs/missing', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /health', () => {
    it('returns ok', async () => {
      const app = createApp();
      const res = await authenticatedRequest(app, '/health');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.api_version).toBe(4);
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

      const res = await authenticatedRequest(app, '/health');
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

      const res = await authenticatedRequest(app, '/cleanup', { method: 'POST' });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.cleaned).toBe(3);
      expect(cleanupFn).toHaveBeenCalledOnce();
    });

    it('returns 501 when no cleanup function is configured', async () => {
      const app = createApp();
      const res = await authenticatedRequest(app, '/cleanup', { method: 'POST' });
      expect(res.status).toBe(501);
    });
  });

  describe('security middleware', () => {
    it('sets security headers', async () => {
      const app = createApp();
      const res = await authenticatedRequest(app, '/health');

      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('cache-control')).toBe('no-store');
    });

    it('requires json content type for non-empty trigger body', async () => {
      const app = createApp();
      const res = await authenticatedRequest(app, '/agents/test-agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: '{"with":"hello"}',
      });

      expect(res.status).toBe(415);
    });
  });
  describe('API key authentication', () => {
    it('refuses to create an API without a strong local key', () => {
      expect(() => createProductionApi({
        getAgents: async () => [],
        store,
        triggerRun,
        apiKey: '',
      })).toThrow('A strong AGENT_SERVER_API_KEY is required');
    });

    it('rejects unauthorized requests when api key is configured', async () => {
      const app = createSecuredApp();
      const res = await app.request('/agents');

      expect(res.status).toBe(401);
    });

    it('accepts x-agent-server-key header', async () => {
      const app = createSecuredApp();
      const res = await app.request('/agents', {
        headers: { 'x-agent-server-key': API_TEST_KEY },
      });

      expect(res.status).toBe(200);
    });

    it('accepts bearer auth header', async () => {
      const app = createSecuredApp();
      const res = await app.request('/agents', {
        headers: { Authorization: `Bearer ${API_TEST_KEY}` },
      });

      expect(res.status).toBe(200);
    });

    it('keeps health endpoint public', async () => {
      const app = createSecuredApp();
      const res = await app.request('/health');

      expect(res.status).toBe(200);
    });

    it('keeps health available after repeated authentication failures', async () => {
      const app = createSecuredApp();
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await app.request('/agents');
      }

      const blockedResponse = await app.request('/agents');
      const res = await app.request('/health');

      expect(blockedResponse.status).toBe(429);
      expect(res.status).toBe(200);
    });
  });

  describe('agent capabilities enrichment', () => {
    it('includes derived capabilities on GET /agents', async () => {
      const app = createApp();
      const res = await authenticatedRequest(app, '/agents');
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

      const res = await authenticatedRequest(app, '/agents/test-agent');
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
      const res = await authenticatedRequest(app, '/capabilities');
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
      const res = await authenticatedRequest(app, '/agents/test-agent', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: '{"name":"Renamed"}',
      });
      expect(res.status).toBe(501);
    });

    it('updates an agent and returns the enriched result', async () => {
      const update = vi.fn().mockResolvedValue(makeAgent({ name: 'Renamed' }));
      const app = createWriterApp({ update });

      const res = await authenticatedRequest(app, '/agents/test-agent', {
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
      const res = await authenticatedRequest(app, '/agents/test-agent', {
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

      const res = await authenticatedRequest(app, '/agents/test-agent', {
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

      const res = await authenticatedRequest(app, '/agents/ghost', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: '{"name":"X"}',
      });
      expect(res.status).toBe(404);
    });

    it('creates an agent and returns 201', async () => {
      const create = vi.fn().mockResolvedValue(makeAgent({ id: 'new-agent', name: 'New Agent' }));
      const app = createWriterApp({ create });

      const res = await authenticatedRequest(app, '/agents', {
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
      const res = await authenticatedRequest(app, '/agents/test-agent', {
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
      const res = await authenticatedRequest(app, '/agents/test-agent/run', {
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

      const res = await authenticatedRequest(app, '/agents/test-agent', { method: 'DELETE' });
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
        apiKey: API_TEST_KEY,
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
      const res = await authenticatedRequest(app, '/connections');
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
      const res = await authenticatedRequest(app, '/connections');
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
      const res = await authenticatedRequest(app, '/connections/refresh', { method: 'POST' });
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
      const res = await authenticatedRequest(app, '/agents/test-agent');
      const body = await res.json();
      const slack = body.capabilities.find((cap: { id: string }) => cap.id === 'slack');
      expect(slack).toBeDefined();
      expect(slack.server_name).toBe('claude_ai_Slack');
      expect(slack.status).toBe('connected');
    });
  });

  describe('analysis routes', () => {
    function createAnalysisApp() {
      const analysisApi = new Hono().post('/security/scan', (context) => context.json({ total: 1 }));
      return createApi({
        getAgents: async () => [makeAgent()],
        store,
        triggerRun,
        host: '127.0.0.1',
        analysisApi,
      });
    }

    it('mounts configured analysis routes behind local API authentication', async () => {
      const app = createAnalysisApp();
      expect((await app.request('/security/scan', { method: 'POST' })).status).toBe(401);

      const response = await authenticatedRequest(app, '/security/scan', { method: 'POST' });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ total: 1 });
    });

    it('applies existing origin protection to analysis mutations', async () => {
      const response = await authenticatedRequest(createAnalysisApp(), '/security/scan', {
        method: 'POST',
        headers: { origin: 'https://outside.example' },
      });
      expect(response.status).toBe(403);
    });
  });

  describe('manual run security preflight', () => {
    const hash = `sha256:${'a'.repeat(64)}`;

    function createPreflightApp(decision: 'allow' | 'confirm' | 'block') {
      const preflightRun = vi.fn().mockResolvedValue({
        schema_version: 1,
        agent_id: 'test-agent',
        content_hash: hash,
        analyzer_version: '1.1.0',
        decision,
        risk: {
          level: decision === 'allow' ? 'low' : decision === 'confirm' ? 'high' : 'critical',
          reasons: decision === 'allow' ? [] : ['Review required'],
          finding_count: 0,
        },
        findings: [],
        acknowledgement_required: decision !== 'allow',
      });
      const app = createApi({
        getAgents: async () => [makeAgent()], store, triggerRun, preflightRun,
        triggerSafeTest: vi.fn().mockResolvedValue('safe-run'),
      });
      return { app, preflightRun };
    }

    it('requires exact content-hash confirmation for an unreviewed high-risk manual run', async () => {
      const { app } = createPreflightApp('confirm');
      const missing = await authenticatedRequest(app, '/agents/test-agent/run', { method: 'POST' });
      expect(missing.status).toBe(428);
      expect(await missing.json()).toMatchObject({
        error: 'Security review confirmation required', content_hash: hash,
      });
      expect(triggerRun).not.toHaveBeenCalled();

      const changed = await authenticatedRequest(app, '/agents/test-agent/run', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmed_content_hash: `sha256:${'b'.repeat(64)}` }),
      });
      expect(changed.status).toBe(409);

      const confirmed = await authenticatedRequest(app, '/agents/test-agent/run', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmed_content_hash: hash }),
      });
      expect(confirmed.status).toBe(202);
      expect(triggerRun).toHaveBeenCalledOnce();
      expect(triggerRun).toHaveBeenCalledWith('test-agent', undefined, {
        confirmedContentHash: hash,
      });
    });

    it('blocks critical manual runs but does not gate safe tests', async () => {
      const { app, preflightRun } = createPreflightApp('block');
      const blocked = await authenticatedRequest(app, '/agents/test-agent/run', { method: 'POST' });
      expect(blocked.status).toBe(403);
      expect(triggerRun).not.toHaveBeenCalled();

      const safe = await authenticatedRequest(app, '/agents/test-agent/safe-test', { method: 'POST' });
      expect(safe.status).toBe(202);
      expect(preflightRun).toHaveBeenCalledOnce();
    });

    it('rejects a run when the agent changes between the API check and execution', async () => {
      const { app } = createPreflightApp('confirm');
      triggerRun.mockRejectedValueOnce(new RunPreflightDeniedError({
        allowed: false,
        code: 'content_changed',
        message: 'The agent changed after review. Review the current security check before running.',
        contentHash: `sha256:${'b'.repeat(64)}`,
      }));

      const response = await authenticatedRequest(app, '/agents/test-agent/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmed_content_hash: hash }),
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: 'content_changed',
        content_hash: `sha256:${'b'.repeat(64)}`,
      });
    });
  });
});
