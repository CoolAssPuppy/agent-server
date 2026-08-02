import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { DatabaseSync } from 'node:sqlite';
import { rmSync } from 'fs';
import { join } from 'path';
import { createApi as createProductionApi } from './api.js';
import { RunStore } from '../reporting/store.js';
import { SqliteRunStore } from '../reporting/sqlite-store.js';
import { createTempDir, makeAgent, makeStoredRun } from '../test-factories.js';
import { RunPreflightDeniedError } from '../analysis/run-preflight-gate.js';
import type { ConnectionProfile } from '../connections/profile.js';
import { InteractionStore, type PendingInteraction } from '../interaction/store.js';

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

  describe('connection profiles', () => {
    it('keeps legacy saved profiles out of the Markdown-backed service inventory', async () => {
      const connection: ConnectionProfile = {
        schema_version: 1,
        id: '018f47a2-9a13-7d61-bf4f-f9a5d8f67c21',
        label: 'My arbitrary label',
        adapter: { id: 'mcp.custom', version: 1 },
        runtime_name: 'connection_018f47a29a137d61bf4ff9a5d8f67c21',
        credentials: [],
        transport: { kind: 'mcp_http', url: 'https://example.com/mcp', headers: [] },
        created_at: '2026-07-19T18:00:00.000Z',
        updated_at: '2026-07-19T18:00:00.000Z',
      };
      const app = createApi({
        getAgents: async () => [],
        store,
        triggerRun,
        getEnv: () => ({}),
        connectionProfiles: {
          list: vi.fn(async () => [connection]),
          create: vi.fn(),
          rename: vi.fn(),
          duplicate: vi.fn(),
          remove: vi.fn(),
        },
      });

      const response = await authenticatedRequest(app, '/connection-profiles');

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ connections: [connection] });

      const services = await authenticatedRequest(app, '/services').then((result) => result.json());
      expect(services.connections).not.toContainEqual(expect.objectContaining({ id: connection.id }));
    });

    it('creates a profile from credential references without accepting values', async () => {
      const create = vi.fn(async (draft) => ({
        schema_version: 1,
        id: '018f47a2-9a13-7d61-bf4f-f9a5d8f67c21',
        ...draft,
        credentials: [],
        created_at: '2026-07-19T18:00:00.000Z',
        updated_at: '2026-07-19T18:00:00.000Z',
      }));
      const app = createApi({
        getAgents: async () => [],
        store,
        triggerRun,
        connectionProfiles: {
          list: vi.fn(), create, rename: vi.fn(), duplicate: vi.fn(), remove: vi.fn(),
        },
      });
      const draft = {
        label: 'No prescribed nomenclature',
        adapter: { id: 'mcp.custom', version: 1 },
        credentials: [{ label: 'Token', environment_variable: 'EXISTING_TOKEN', secret: true }],
        transport: {
          kind: 'mcp_http',
          url: 'https://example.com/mcp',
          headers: [{ name: 'Authorization', credential_index: 0, prefix: 'Bearer ' }],
        },
      };

      const response = await authenticatedRequest(app, '/connection-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });

      expect(response.status).toBe(201);
      expect(create).toHaveBeenCalledWith(draft);
    });

    it('rejects a credential value in a connection profile request', async () => {
      const create = vi.fn();
      const app = createApi({
        getAgents: async () => [],
        store,
        triggerRun,
        connectionProfiles: {
          list: vi.fn(), create, rename: vi.fn(), duplicate: vi.fn(), remove: vi.fn(),
        },
      });

      const response = await authenticatedRequest(app, '/connection-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: 'Unsafe',
          adapter: { id: 'mcp.custom', version: 1 },
          credentials: [{
            label: 'Token', environment_variable: 'EXISTING_TOKEN', secret: true, value: 'secret',
          }],
          transport: { kind: 'mcp_http', url: 'https://example.com/mcp', headers: [] },
        }),
      });

      expect(response.status).toBe(400);
      expect(create).not.toHaveBeenCalled();
      expect(JSON.stringify(await response.json())).not.toContain('secret');
    });

    it('renames a profile without accepting changes to its technical configuration', async () => {
      const rename = vi.fn(async (_id: string, label: string) => ({ id: 'profile-1', label }));
      const app = createApi({
        getAgents: async () => [],
        store,
        triggerRun,
        connectionProfiles: {
          list: vi.fn(), create: vi.fn(), rename, duplicate: vi.fn(), remove: vi.fn(),
        },
      });

      const response = await authenticatedRequest(app, '/connection-profiles/profile-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Personal research' }),
      });

      expect(response.status).toBe(200);
      expect(rename).toHaveBeenCalledWith('profile-1', 'Personal research');

      const unsafe = await authenticatedRequest(app, '/connection-profiles/profile-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Unsafe', runtime_name: 'changed' }),
      });
      expect(unsafe.status).toBe(400);
    });

    it('duplicates a profile under a new presentation label', async () => {
      const duplicate = vi.fn(async (_id: string, label: string) => ({ id: 'profile-2', label }));
      const app = createApi({
        getAgents: async () => [],
        store,
        triggerRun,
        connectionProfiles: {
          list: vi.fn(), create: vi.fn(), rename: vi.fn(), duplicate, remove: vi.fn(),
        },
      });

      const response = await authenticatedRequest(app, '/connection-profiles/profile-1/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Personal research copy' }),
      });

      expect(response.status).toBe(201);
      expect(duplicate).toHaveBeenCalledWith('profile-1', 'Personal research copy');
    });

    it('checks local readiness without returning credential values', async () => {
      const connection = {
        schema_version: 1 as const,
        id: '018f47a2-9a13-7d61-bf4f-f9a5d8f67c21',
        label: 'Reports',
        adapter: { id: 'mcp.custom', version: 1 },
        runtime_name: 'connection_018f47a29a137d61bf4ff9a5d8f67c21',
        credentials: [{
          id: '018f47a2-9a13-7d61-bf4f-f9a5d8f67c22',
          label: 'Token',
          environment_variable: 'REPORTS_TOKEN',
          secret: true,
        }],
        transport: { kind: 'mcp_http' as const, url: 'https://example.com/mcp', headers: [] },
        created_at: '2026-07-19T18:00:00.000Z',
        updated_at: '2026-07-19T18:00:00.000Z',
      };
      const app = createApi({
        getAgents: async () => [],
        store,
        triggerRun,
        getEnv: () => ({ REPORTS_TOKEN: 'must-not-leak' }),
        connectionProfiles: {
          list: vi.fn(async () => [connection]),
          create: vi.fn(), rename: vi.fn(), duplicate: vi.fn(), remove: vi.fn(),
        },
      });

      const response = await authenticatedRequest(
        app,
        '/connection-profiles/018f47a2-9a13-7d61-bf4f-f9a5d8f67c21/check',
        { method: 'POST' },
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ status: 'ready', missing_credentials: [] });
      expect(JSON.stringify(body)).not.toContain('must-not-leak');
    });

    it('fails closed when removing a profile referenced by agents', async () => {
      const remove = vi.fn();
      const app = createApi({
        getAgents: async () => [makeAgent({
          id: 'daily-brief',
          name: 'Daily brief',
          connection_bindings: { reports: '018f47a2-9a13-7d61-bf4f-f9a5d8f67c21' },
        })],
        store,
        triggerRun,
        connectionProfiles: {
          list: vi.fn(), create: vi.fn(), rename: vi.fn(), duplicate: vi.fn(), remove,
        },
      });

      const response = await authenticatedRequest(
        app,
        '/connection-profiles/018f47a2-9a13-7d61-bf4f-f9a5d8f67c21',
        { method: 'DELETE' },
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: 'This connection is still used by 1 agent.',
        code: 'connection_in_use',
        agents: [{ id: 'daily-brief', name: 'Daily brief' }],
      });
      expect(remove).not.toHaveBeenCalled();
    });

    it('removes an unreferenced profile', async () => {
      const remove = vi.fn(async () => undefined);
      const app = createApi({
        getAgents: async () => [],
        store,
        triggerRun,
        connectionProfiles: {
          list: vi.fn(), create: vi.fn(), rename: vi.fn(), duplicate: vi.fn(), remove,
        },
      });

      const response = await authenticatedRequest(app, '/connection-profiles/profile-1', {
        method: 'DELETE',
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true, connection_id: 'profile-1' });
      expect(remove).toHaveBeenCalledWith('profile-1');
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

      const response = await authenticatedRequest(app, '/services?executor=claude-code');
      const body = await response.json() as { connections: Array<Record<string, unknown>> };

      expect(response.status).toBe(200);
      expect(body.connections).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'Personal Notion',
          source: 'configured_api',
          required_env: ['NOTION_PERSONAL_API_KEY'],
        }),
        expect.objectContaining({ name: 'Notion (Claude account)', source: 'account' }),
      ]));
      expect(JSON.stringify(body)).not.toContain('personal-secret');
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

    it('returns persisted evidence without exposing its original secrets', async () => {
      store.add(makeStoredRun({
        summary: 'token="api-summary-secret"',
        error: 'password="api-error-secret"',
        commandsRun: ['Authorization: Bearer api-command-secret'],
        progressMessages: ['secret="api-progress-secret"'],
      }));

      const response = await authenticatedRequest(createApp(), '/runs');
      const responseText = await response.text();

      expect(responseText).toContain('[REDACTED]');
      expect(responseText).not.toContain('api-summary-secret');
      expect(responseText).not.toContain('api-error-secret');
      expect(responseText).not.toContain('api-command-secret');
      expect(responseText).not.toContain('api-progress-secret');
    });

    it('does not expose raw evidence from a pre-upgrade SQLite row', async () => {
      const directory = createTempDir('legacy-api-run');
      const databasePath = join(directory, 'runs.db');
      const sqliteStore = new SqliteRunStore({ path: databasePath });
      try {
        sqliteStore.add(makeStoredRun({ runId: 'legacy-run' }));
        const legacyDatabase = new DatabaseSync(databasePath);
        legacyDatabase.prepare(`
          UPDATE runs
          SET summary = ?, error = ?, commands_run = ?, progress_messages = ?
          WHERE run_id = ?
        `).run(
          'token="legacy-api-summary-secret"',
          'password="legacy-api-error-secret"',
          JSON.stringify(['Authorization: Bearer legacy-api-command-secret']),
          JSON.stringify(['api_key="legacy-api-progress-secret"']),
          'legacy-run',
        );
        legacyDatabase.close();

        const app = createApi({
          getAgents: async () => [makeAgent()],
          store: sqliteStore,
          triggerRun,
        });
        const listResponse = await authenticatedRequest(app, '/runs');
        const detailResponse = await authenticatedRequest(app, '/runs/legacy-run');
        const serialized = `${await listResponse.text()}${await detailResponse.text()}`;

        expect(serialized).toContain('[REDACTED]');
        expect(serialized).not.toContain('legacy-api-summary-secret');
        expect(serialized).not.toContain('legacy-api-error-secret');
        expect(serialized).not.toContain('legacy-api-command-secret');
        expect(serialized).not.toContain('legacy-api-progress-secret');
      } finally {
        sqliteStore.close();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  });

  describe('GET /runs/:id', () => {
    it('returns a specific run', async () => {
      store.add(makeStoredRun({
        status: 'skipped',
        code: 'lock_contention',
        summary: 'This run was skipped because Test Agent is already running.',
        error: 'This run was skipped because Test Agent is already running.',
        progressMessages: ['Step 1'],
      }));
      const app = createApp();
      const res = await authenticatedRequest(app, '/runs/run-1');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.runId).toBe('run-1');
      expect(body.progressMessages).toEqual(['Step 1']);
      expect(body).toMatchObject({
        status: 'skipped',
        code: 'lock_contention',
        summary: 'This run was skipped because Test Agent is already running.',
        error: 'This run was skipped because Test Agent is already running.',
      });
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

  describe('GET /runs/:id/review', () => {
    it('returns an outcome-first review using the required output contract', async () => {
      store.add(makeStoredRun({
        runId: 'review-run',
        status: 'completed',
        summary: 'Published the weekly update.',
      }));
      const app = createApi({
        getAgents: async () => [makeAgent({
          output: {
            primary: {
              description: 'Weekly update',
              tool: 'mcp__notion__create_page',
              required: true,
            },
          },
        })],
        store,
        triggerRun,
      });

      const response = await authenticatedRequest(app, '/runs/review-run/review');
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        outcome: 'succeeded',
        operationalCompleteness: 'complete',
        outputs: [{
          text: 'Weekly update is ready',
          evidenceReferences: ['agent.output.primary', 'run.status'],
        }],
        technicalDetailsReference: '/runs/review-run',
      });
      expect(body).not.toHaveProperty('toolsUsed');
      expect(body).not.toHaveProperty('commandsRun');
    });

    it('returns a review for retained history when its agent definition is gone', async () => {
      store.add(makeStoredRun({ runId: 'retained-run', status: 'completed' }));
      const app = createApi({
        getAgents: async () => [],
        store,
        triggerRun,
      });

      const response = await authenticatedRequest(app, '/runs/retained-run/review');
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.operationalCompleteness).toBe('not_assessed');
    });

    it('returns 404 for an unknown run', async () => {
      const response = await authenticatedRequest(createApp(), '/runs/missing/review');

      expect(response.status).toBe(404);
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

    it('records a stable cancellation reason when an orphaned run cannot be aborted', async () => {
      store.add(makeStoredRun({ runId: 'r1', status: 'running' }));
      const app = createApi({
        getAgents: async () => [makeAgent()],
        store,
        triggerRun,
        cancelRun: vi.fn().mockReturnValue(false),
      });

      const res = await authenticatedRequest(app, '/runs/r1/cancel', { method: 'POST' });

      expect(res.status).toBe(200);
      expect(store.get('r1')).toMatchObject({
        status: 'failed',
        code: 'user_canceled',
      });
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
      expect(body.api_version).toBe(12);
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

  describe('GET /machine', () => {
    it('returns authenticated local identity without exposing it through health', async () => {
      const machineId = '1d2f8f5e-9ea8-4fce-89b1-1c7c2f5ecf99';
      const app = createApi({
        getAgents: async () => [],
        store,
        triggerRun,
        machineId,
      });

      const unauthorized = await app.request('/machine');
      const response = await authenticatedRequest(app, '/machine');
      const health = await app.request('/health');

      expect(unauthorized.status).toBe(401);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        machine_id: machineId,
        protocol_version: 2,
        server_version: '3.3.4',
      });
      await expect(health.json()).resolves.not.toHaveProperty('machine_id');
    });
  });

  describe('GET /presentation/today-activity', () => {
    it('returns one authenticated, machine-scoped snapshot without technical or secret source data', async () => {
      const machineId = '1d2f8f5e-9ea8-4fce-89b1-1c7c2f5ecf99';
      const now = new Date('2026-08-02T10:00:00.000Z');
      const agents = [
        makeAgent({
          id: 'report-agent',
          name: 'Weekly Report',
          prompt: 'PROMPT_PRIVATE: inspect the private workspace.',
          schedule: undefined,
          tools: ['Bash', 'mcp__private__publish_report'],
          working_directory: '/Users/person/Private/Workspace',
          mcp_servers: {
            private: {
              command: 'private-service',
              env: { PRIVATE_TOKEN: 'credential-secret' },
            },
          },
        }),
        makeAgent({
          id: 'upcoming-agent',
          name: 'Daily Brief',
          schedule: '0 11 * * *',
          timezone: 'UTC',
        }),
      ];
      store.add(makeStoredRun({
        runId: 'finished-run',
        agentId: 'report-agent',
        agentName: 'Weekly Report',
        status: 'completed',
        summary: 'Prepared the weekly report.',
        startedAt: new Date('2026-08-02T08:00:00.000Z'),
        completedAt: new Date('2026-08-02T08:02:00.000Z'),
        toolsUsed: ['mcp__private__publish_report'],
        filesRead: ['/Users/person/Private/Workspace/source.md'],
        filesWritten: ['/Users/person/Private/Workspace/report.md'],
        commandsRun: ['private-service --token credential-secret'],
      }));
      const interaction: PendingInteraction = {
        id: 'interaction-1',
        runId: 'waiting-run',
        agentId: 'report-agent',
        replyAgentId: 'report-agent',
        request: {
          message: 'Choose where to save the report.',
          options: [{ label: 'Team page', value: 'team' }],
          freeText: false,
        },
        channel: 'console',
        createdAt: new Date('2026-08-02T09:30:00.000Z'),
        expiresAt: new Date('2026-08-02T10:30:00.000Z'),
        status: 'pending',
      };
      const getAgents = vi.fn().mockResolvedValue(agents);
      const getPendingInteractions = vi.fn().mockReturnValue([interaction]);
      const app = createApi({
        getAgents,
        getPendingInteractions,
        store,
        triggerRun,
        machineId,
        presentationClock: () => now,
        presentationWindow: () => ({
          recentSince: new Date('2026-08-02T00:00:00.000Z'),
          upcomingUntil: new Date('2026-08-03T00:00:00.000Z'),
        }),
      });

      const unauthorized = await app.request('/presentation/today-activity');
      const response = await authenticatedRequest(app, '/presentation/today-activity');

      expect(unauthorized.status).toBe(401);
      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, unknown>;
      expect(body).toMatchObject({
        generatedAt: '2026-08-02T10:00:00.000Z',
        today: {
          sections: [
            { kind: 'needs_you' },
            { kind: 'finished' },
            { kind: 'upcoming' },
          ],
        },
        activity: {
          items: [
            { id: 'run:waiting-run', state: 'needs_you' },
            { id: 'run:finished-run', state: 'finished' },
          ],
        },
      });
      expect(getAgents).toHaveBeenCalledOnce();
      expect(getPendingInteractions).toHaveBeenCalledOnce();

      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('PROMPT_PRIVATE');
      expect(serialized).not.toContain('private-service --token');
      expect(serialized).not.toContain('mcp__private');
      expect(serialized).not.toContain('/Users/person/Private');
      expect(serialized).not.toContain('credential-secret');
    });

    it('refuses to create ambiguous presentation identities without a machine ID', async () => {
      const app = createApp();

      const response = await authenticatedRequest(app, '/presentation/today-activity');

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: 'Machine identity unavailable',
      });
    });
  });

  describe('GET /presentation/assistants/:id', () => {
    it('returns one authenticated machine-local Assistant home without prompt or secret data', async () => {
      const machineId = '1d2f8f5e-9ea8-4fce-89b1-1c7c2f5ecf99';
      const now = new Date('2026-08-02T10:00:00.000Z');
      const agent = makeAgent({
        id: 'weekly-report',
        name: 'Weekly Report',
        description: 'Prepares the weekly report.',
        schedule: undefined,
        prompt: 'PROMPT_PRIVATE: send credential-secret.',
        working_directory: '/Users/person/Documents/Reports',
        permissions: { allow: ['Read', 'Write'], deny: ['Bash'] },
        mcp_servers: {
          reports: {
            command: 'private-mcp',
            env: { REPORTS_TOKEN: 'credential-secret' },
          },
        },
      });
      store.add(makeStoredRun({
        runId: 'run-7',
        agentId: agent.id,
        agentName: agent.name,
        status: 'completed',
        summary: 'Prepared the weekly report.',
        completedAt: new Date('2026-08-02T09:05:00.000Z'),
      }));
      const assistantHomeFacts = vi.fn().mockResolvedValue({
        engine: { runtimeAvailable: true, authentication: 'verified' },
        paths: [{
          path: '/Users/person/Documents/Reports',
          exists: true,
          readable: true,
          writable: true,
        }],
        connections: [{
          id: 'inline:reports',
          label: 'Reports',
          status: 'ready',
          sourceReference: 'agent.mcp_servers.reports',
        }],
        canEnforceSafeTest: false,
      });
      const app = createApi({
        getAgents: async () => [agent],
        store,
        triggerRun,
        machineId,
        presentationClock: () => now,
        assistantHomeFacts,
      });

      const unauthorized = await app.request('/presentation/assistants/weekly-report');
      const response = await authenticatedRequest(app, '/presentation/assistants/weekly-report');
      const body = await response.json() as Record<string, unknown>;

      expect(unauthorized.status).toBe(401);
      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        generatedAt: '2026-08-02T10:00:00.000Z',
        assistant: {
          installationId: `${machineId}:weekly-report`,
          localAgentId: 'weekly-report',
          displayName: 'Weekly Report',
        },
        health: { state: 'healthy' },
        readiness: { state: 'ready' },
        primaryAction: { kind: 'run', label: 'Run now' },
        recentOutcomes: [{ runId: 'run-7', outcome: 'succeeded' }],
      });
      expect(assistantHomeFacts).toHaveBeenCalledWith(agent, [agent]);
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('PROMPT_PRIVATE');
      expect(serialized).not.toContain('credential-secret');
      expect(serialized).not.toContain('private-mcp');
      expect(serialized).not.toContain('mcp__');
    });

    it('returns explicit errors for missing identity, unknown assistants, and unavailable facts', async () => {
      const agent = makeAgent({ id: 'known' });
      const withoutIdentity = createApi({ getAgents: async () => [agent], store, triggerRun });
      const withoutFacts = createApi({
        getAgents: async () => [agent],
        store,
        triggerRun,
        machineId: '1d2f8f5e-9ea8-4fce-89b1-1c7c2f5ecf99',
      });
      const app = createApi({
        getAgents: async () => [agent],
        store,
        triggerRun,
        machineId: '1d2f8f5e-9ea8-4fce-89b1-1c7c2f5ecf99',
        assistantHomeFacts: vi.fn().mockResolvedValue({
          engine: { runtimeAvailable: true, authentication: 'unknown' },
          paths: [],
          connections: [],
          canEnforceSafeTest: false,
        }),
      });

      expect((await authenticatedRequest(withoutIdentity, '/presentation/assistants/known')).status).toBe(503);
      expect((await authenticatedRequest(withoutFacts, '/presentation/assistants/known')).status).toBe(503);
      expect((await authenticatedRequest(app, '/presentation/assistants/missing')).status).toBe(404);
    });
  });

  describe('local interaction responses', () => {
    function createInteractionStore(
      overrides: Partial<Omit<PendingInteraction, 'status'>> = {},
    ): InteractionStore {
      const interactions = new InteractionStore(() => 'private-claim-token');
      interactions.add({
        id: 'interaction-1',
        runId: 'run-1',
        agentId: 'request-agent',
        replyAgentId: 'reply-agent',
        request: {
          message: 'Where should I save the report?',
          options: [
            {
              label: 'Team page',
              value: 'private-team-page-value',
              description: 'Share it with the team.',
            },
          ],
          freeText: true,
        },
        channel: 'telegram',
        createdAt: new Date('2026-08-02T09:00:00.000Z'),
        expiresAt: new Date('2099-08-02T11:00:00.000Z'),
        ...overrides,
      });
      return interactions;
    }

    function createInteractionApp(interactions: InteractionStore) {
      return createApi({
        getAgents: async () => [makeAgent({ id: 'reply-agent' })],
        store,
        triggerRun,
        interactions,
      });
    }

    it('projects a pending request without exposing option values, reply routing, or channel details', async () => {
      const app = createInteractionApp(createInteractionStore());

      const unauthorized = await app.request('/interactions/interaction-1');
      const response = await authenticatedRequest(app, '/interactions/interaction-1');

      expect(unauthorized.status).toBe(401);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        interaction_id: 'interaction-1',
        run_id: 'run-1',
        assistant_id: 'request-agent',
        message: 'Where should I save the report?',
        options: [{
          index: 0,
          label: 'Team page',
          description: 'Share it with the team.',
        }],
        allows_free_text: true,
        expires_at: '2099-08-02T11:00:00.000Z',
        status: 'pending',
      });

      const serialized = JSON.stringify(await (
        await authenticatedRequest(app, '/interactions/interaction-1')
      ).json());
      expect(serialized).not.toContain('private-team-page-value');
      expect(serialized).not.toContain('reply-agent');
      expect(serialized).not.toContain('telegram');
    });

    it('derives the selected option value locally and completes only after accepting the run', async () => {
      const interactions = createInteractionStore();
      const app = createInteractionApp(interactions);

      const response = await authenticatedRequest(app, '/interactions/interaction-1/reply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response: { type: 'option', optionIndex: 0 } }),
      });

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toEqual({
        interaction_id: 'interaction-1',
        run_id: 'run-123',
        status: 'accepted',
      });
      expect(triggerRun).toHaveBeenCalledWith('reply-agent', 'private-team-page-value');
      expect(interactions.get('interaction-1')?.status).toBe('acted');
    });

    it('restores a claimed interaction when local run acceptance fails', async () => {
      const interactions = createInteractionStore();
      const app = createInteractionApp(interactions);
      triggerRun.mockRejectedValueOnce(new Error('Security review is required'));

      const response = await authenticatedRequest(app, '/interactions/interaction-1/reply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response: { type: 'text', text: ' Save it privately. ' } }),
      });

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: 'The response was not accepted. Try again.',
        code: 'run_not_accepted',
      });
      expect(triggerRun).toHaveBeenCalledWith('reply-agent', 'Save it privately.');
      expect(interactions.get('interaction-1')?.status).toBe('pending');
    });

    it.each([
      {
        name: 'missing request',
        id: 'missing',
        interactions: createInteractionStore(),
        body: { response: { type: 'option', optionIndex: 0 } },
        status: 404,
        code: 'not_found',
      },
      {
        name: 'expired request',
        id: 'interaction-1',
        interactions: createInteractionStore({ expiresAt: new Date('2000-01-01T00:00:00.000Z') }),
        body: { response: { type: 'option', optionIndex: 0 } },
        status: 410,
        code: 'expired',
      },
      {
        name: 'invalid response',
        id: 'interaction-1',
        interactions: createInteractionStore(),
        body: { response: { type: 'option', optionIndex: 4 } },
        status: 422,
        code: 'invalid_response',
      },
    ])('maps a $name to an explicit response', async ({ id, interactions, body, status, code }) => {
      const app = createInteractionApp(interactions);

      const response = await authenticatedRequest(app, `/interactions/${id}/reply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ code });
      expect(triggerRun).not.toHaveBeenCalled();
    });

    it('maps a response already being processed to conflict', async () => {
      const interactions = createInteractionStore();
      expect(interactions.claim(
        'interaction-1',
        { type: 'option', optionIndex: 0 },
      ).ok).toBe(true);
      const app = createInteractionApp(interactions);

      const response = await authenticatedRequest(app, '/interactions/interaction-1/reply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response: { type: 'option', optionIndex: 0 } }),
      });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ code: 'not_pending' });
      expect(triggerRun).not.toHaveBeenCalled();
    });

    it('rejects request-envelope additions before claiming the interaction', async () => {
      const interactions = createInteractionStore();
      const app = createInteractionApp(interactions);

      const response = await authenticatedRequest(app, '/interactions/interaction-1/reply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          response: { type: 'option', optionIndex: 0 },
          replyAgentId: 'attacker-agent',
        }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: 'Invalid interaction response body',
        code: 'invalid_body',
      });
      expect(interactions.get('interaction-1')?.status).toBe('pending');
      expect(triggerRun).not.toHaveBeenCalled();
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

    it('returns a non-success response when panel cleanup fails', async () => {
      const cleanupFn = vi.fn().mockRejectedValue(new Error('Panel unavailable'));
      const app = createApi({
        getAgents: async () => [makeAgent()],
        store,
        triggerRun,
        cleanupFn,
      });

      const res = await authenticatedRequest(app, '/cleanup', { method: 'POST' });

      expect(res.status).toBe(502);
      await expect(res.json()).resolves.toEqual({ error: 'Cleanup failed: Panel unavailable' });
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

    it('rejects unauthorized requests before reading their body stream', async () => {
      const app = createSecuredApp();
      const readSpy = vi.spyOn(ReadableStreamDefaultReader.prototype, 'read');

      const res = await app.request('/agents/test-agent/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ with: 'x'.repeat(9_000) }),
      });

      expect(res.status).toBe(401);
      expect(readSpy).not.toHaveBeenCalled();
      readSpy.mockRestore();
    });

    it('rejects cross-origin mutations before reading their body stream', async () => {
      const app = createApp('127.0.0.1');
      const readSpy = vi.spyOn(ReadableStreamDefaultReader.prototype, 'read');

      const res = await authenticatedRequest(app, '/agents/test-agent/run', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://attacker.example',
        },
        body: JSON.stringify({ with: 'x'.repeat(9_000) }),
      });

      expect(res.status).toBe(403);
      expect(readSpy).not.toHaveBeenCalled();
      readSpy.mockRestore();
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
      let thresholdResponse: Response | undefined;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        thresholdResponse = await app.request('/agents');
      }

      const blockedResponse = await app.request('/agents');
      const res = await app.request('/health');

      expect(thresholdResponse?.status).toBe(429);
      expect(blockedResponse.status).toBe(429);
      expect(res.status).toBe(200);
    });

    it('accepts a valid credential after failures and clears the source ban', async () => {
      const app = createSecuredApp();
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await app.request('/agents');
      }

      const recovered = await authenticatedRequest(app, '/agents');
      const nextFailure = await app.request('/agents');

      expect(recovered.status).toBe(200);
      expect(nextFailure.status).toBe(401);
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
      const body = JSON.stringify({ with: 'x'.repeat(30_000) });
      const res = await authenticatedRequest(app, '/agents/test-agent/run', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
        },
        body,
      });
      expect(res.status).toBe(413);
    });

    it('rejects actual body bytes that exceed a falsified content length', async () => {
      const app = createApp();
      const body = JSON.stringify({ with: 'x'.repeat(9_000) });

      const res = await authenticatedRequest(app, '/agents/test-agent/run', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': '2',
        },
        body,
      });

      expect(res.status).toBe(413);
      expect(triggerRun).not.toHaveBeenCalled();
    });

    it('rejects oversized agent writes based on actual bytes', async () => {
      const update = vi.fn().mockResolvedValue(makeAgent());
      const app = createWriterApp({ update });
      const body = JSON.stringify({ prompt: 'valid', padding: 'x'.repeat(256 * 1024) });

      const res = await authenticatedRequest(app, '/agents/test-agent', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'content-length': '2',
        },
        body,
      });

      expect(res.status).toBe(413);
      expect(update).not.toHaveBeenCalled();
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
      const slack = body.capabilities.find(
        (cap: { id: string }) => cap.id === 'connection:runtime:claude.ai%20Slack',
      );
      expect(slack).toBeDefined();
      expect(slack.source).toBe('account');
      expect(slack.server_name).toBe('claude_ai_Slack');
      expect(slack.status).toBe('connected');
    });

    it('does not expose Claude account connectors to a Codex agent', async () => {
      const snapshot = {
        servers: [{ name: 'claude.ai Slack', status: 'connected' }],
        discovered_at: '2026-07-18T00:00:00.000Z',
      };
      const app = createApi({
        getAgents: async () => [makeAgent({ executor: 'codex' })],
        store,
        triggerRun,
        connections: { get: () => snapshot, refresh: async () => snapshot },
      });

      const response = await authenticatedRequest(app, '/agents/test-agent');
      const body = await response.json();

      expect(body.capabilities.some(
        (capability: { source: string }) => capability.source === 'account',
      )).toBe(false);
    });

    it('waits for the runtime status probe before returning Claude account connections', async () => {
      const populated = {
        servers: [{ name: 'claude.ai Slack', status: 'connected' }],
        discovered_at: '2026-07-18T00:00:00.000Z',
      };
      let snapshot = { servers: [], discovered_at: null } as typeof populated | {
        servers: never[];
        discovered_at: null;
      };
      const ensure = vi.fn(async () => {
        snapshot = populated;
        return populated;
      });
      const app = createApi({
        getAgents: async () => [makeAgent({ executor: 'claude-code' })],
        store,
        triggerRun,
        connections: { get: () => snapshot, ensure, refresh: async () => populated },
      });

      const response = await authenticatedRequest(app, '/agents/test-agent');
      const body = await response.json();

      expect(ensure).toHaveBeenCalledOnce();
      expect(body.capabilities).toContainEqual(expect.objectContaining({
        label: 'Slack (Claude account)',
        source: 'account',
      }));
    });

    it('offers reusable Markdown API connections while scoping account MCP to the selected LLM', async () => {
      const personal = makeAgent({
        id: 'personal-source',
        mcp_servers: {
          'notion-personal': {
            command: 'npx',
            args: ['-y', '@notionhq/notion-mcp-server'],
            env: { NOTION_TOKEN: '${NOTION_PERSONAL_API_KEY}' },
          },
        },
      });
      const target = makeAgent({ id: 'target' });
      const codexTarget = makeAgent({ id: 'codex-target', executor: 'codex' });
      const snapshot = {
        servers: [{ name: 'claude.ai Notion', status: 'connected' }],
        discovered_at: '2026-07-18T00:00:00.000Z',
      };
      const app = createApi({
        getAgents: async () => [personal, target, codexTarget],
        store,
        triggerRun,
        getEnv: () => ({ NOTION_PERSONAL_API_KEY: 'configured' }),
        connections: { get: () => snapshot, refresh: async () => snapshot },
      });

      const response = await authenticatedRequest(app, '/agents/target');
      const body = await response.json();
      const notion = body.capabilities.filter(
        (capability: { label: string }) => capability.label.includes('Notion'),
      );

      expect(notion).toEqual(expect.arrayContaining([
        expect.objectContaining({ label: 'Personal Notion', source: 'configured_api' }),
        expect.objectContaining({ label: 'Notion (Claude account)', source: 'account' }),
      ]));

      const codexResponse = await authenticatedRequest(app, '/agents/codex-target');
      const codexBody = await codexResponse.json();
      const codexNotion = codexBody.capabilities.filter(
        (capability: { label: string }) => capability.label.includes('Notion'),
      );
      expect(codexNotion).toContainEqual(
        expect.objectContaining({ label: 'Personal Notion', source: 'configured_api' }),
      );
      expect(codexNotion.some(
        (capability: { source: string }) => capability.source === 'account',
      )).toBe(false);
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
