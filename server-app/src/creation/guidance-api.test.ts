import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../server/api.js';
import { RunStore } from '../reporting/store.js';
import { makeAgent, makeStoredRun } from '../test-factories.js';
import { AgentWriteError, type AgentWriter } from '../agents/writer.js';
import { PreflightResultSchema, SecurityAnalysisSchema } from '../analysis/models.js';
import { createGuidanceApi, type GuidanceApiDependencies } from './guidance-api.js';
import { RunPreflightDeniedError } from '../analysis/run-preflight-gate.js';
import type { ServiceRegistry } from '../services/registry.js';

const API_KEY = 'guidance-test-key-1234567890';
const CONTENT_HASH = `sha256:${'a'.repeat(64)}`;

function validProposal(): Record<string, unknown> {
  return {
    schema_version: 1,
    name: 'Friday GitHub summary',
    description: 'Summarizes GitHub activity and sends it to Slack.',
    instructions: 'Review GitHub activity and prepare a concise weekly summary.',
    explanation: 'Each Friday, the agent reads GitHub activity and sends a short summary.',
    trigger: { type: 'schedule', schedule: '0 17 * * 5', human_description: 'Every Friday at 5:00 p.m.' },
    timezone: 'Europe/Lisbon',
    capabilities: [],
    connections: [{
      id: 'slack', name: 'Slack', required: true, status: 'needs_setup', reason: 'The summary needs a destination.',
    }],
    file_access: [],
    permissions: {
      can_modify_files: false,
      can_run_commands: false,
      requires_network: true,
      can_use_connected_apps: true,
      can_send_messages: true,
    },
    notification_destination: { kind: 'slack', label: 'Slack', configured: false },
    runtime: { executor: 'codex', model: null, reason: 'Use the local runtime.' },
    risk: { level: 'needs_review', reasons: ['It sends information to Slack.'], finding_count: 0 },
    missing_information: ['Choose a Slack destination.'],
    questions: [{
      id: 'slack-destination', question: 'Where in Slack should the summary be sent?', control: 'service', required: true,
    }],
    markdown_instructions: '# Weekly GitHub summary\n\nReview activity and do not expose secrets.',
  };
}

function completeProposal(): Record<string, unknown> {
  return {
    ...validProposal(),
    connections: [{
      id: 'slack', name: 'Slack', required: true, status: 'connected', reason: 'The summary needs a destination.',
    }],
    notification_destination: { kind: 'slack', label: 'Team updates', configured: true },
    missing_information: [],
    questions: [],
  };
}

function fakeWriter(overrides: Partial<AgentWriter> = {}): AgentWriter {
  return {
    create: vi.fn(),
    createReviewed: vi.fn(async (agent) => ({ agent, content: `---\nid: ${agent.id}\n---\n\n${agent.prompt}\n` })),
    update: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  };
}

function createFixture(overrides: Partial<GuidanceApiDependencies> = {}) {
  const runStore = new RunStore();
  const agents = [makeAgent({ id: 'failed-agent', tools: ['Read'], working_directory: '~/Reports' })];
  const writer = fakeWriter();
  const dependencies: GuidanceApiDependencies = {
    model: { generate: vi.fn(async () => completeProposal()) },
    writer,
    getAgents: async () => agents,
    store: runStore,
    content: {
      get: async (agentId) => agents.find((agent) => agent.id === agentId)
        ? { agent: agents[0], content: `---\nid: failed-agent\nname: Failed Agent\ntools: [Read]\npermissions:\n  allow: [Read]\n  deny: []\n---\n\nRead and save the report.\n` }
        : undefined,
    },
    triggerRun: vi.fn(async () => 'retry-run'),
    diagnosticReadiness: () => ({
      serverOnline: true,
      runtimeAvailable: true,
      workingDirectoryExists: true,
    }),
    getServiceRegistry: async () => ({
      connections: [
        {
          id: 'github', service_id: 'github', name: 'GitHub', source: 'account', status: 'connected',
          actions: ['read'], actions_known: true,
        },
        {
          id: 'slack', service_id: 'slack', name: 'Slack', source: 'account', status: 'connected',
          actions: ['read', 'send'], actions_known: true,
        },
      ],
      bindings: new Map([
        ['github', { serverName: 'github' }],
        ['slack', { serverName: 'slack' }],
      ]),
    }),
    ...overrides,
  };
  const guidanceApi = createGuidanceApi(dependencies);
  const app = createApi({
    getAgents: dependencies.getAgents,
    store: runStore,
    triggerRun: vi.fn(async () => 'run-1'),
    apiKey: API_KEY,
    guidanceApi,
  });
  return { app, dependencies, runStore, writer };
}

function request(app: ReturnType<typeof createApi>, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('x-agent-server-key', API_KEY);
  if (init.body) headers.set('content-type', 'application/json');
  return app.request(path, { ...init, headers });
}

describe('consumer guidance API', () => {
  it('loads connection choices for the coding agent selected in creation', async () => {
    const getServiceRegistry = vi.fn(async () => ({ connections: [], bindings: new Map() }));
    const { app } = createFixture({ getServiceRegistry });

    await request(app, '/guidance/agent-proposals', {
      method: 'POST',
      body: JSON.stringify({
        request: 'Create a private daily summary.',
        timezone: 'Europe/Lisbon',
        connected_services: [],
        answers: [{ question_id: 'runtime', value: 'codex' }],
      }),
    });

    expect(getServiceRegistry).toHaveBeenCalledWith('codex');
  });

  it('returns all mentioned authoritative connection choices in one response', async () => {
    const registry: ServiceRegistry = {
      connections: [
        {
          id: 'notion-personal', service_id: 'notion', name: 'Personal Notion', source: 'configured_api',
          status: 'connected', actions: ['read', 'write'], actions_known: true,
        },
        {
          id: 'claude.ai Notion', service_id: 'notion', name: 'Notion', source: 'account',
          status: 'needs_setup', actions: ['read', 'write'], actions_known: true,
        },
        {
          id: 'linear-work', service_id: 'linear', name: 'Work Linear', source: 'account',
          status: 'connected', actions: ['read', 'write'], actions_known: true,
        },
      ],
      bindings: new Map(),
    };
    const { app } = createFixture({ getServiceRegistry: async () => registry });

    const response = await request(app, '/guidance/agent-proposals', {
      method: 'POST',
      body: JSON.stringify({
        request: 'Save the note in Notion and create an issue in Linear.',
        timezone: 'Europe/Lisbon',
        connected_services: [{ id: 'hostile', name: 'Client supplied' }],
        answers: [{ question_id: 'runtime', value: 'claude-code' }],
      }),
    });

    expect(await response.json()).toMatchObject({
      status: 'needs_information',
      questions: [
        {
          id: 'connection-notion',
          choices: [
            { value: 'notion-personal', source: 'configured_api' },
            { value: 'claude.ai Notion', source: 'account', disabled_reason: 'Needs setup' },
          ],
        },
        { id: 'connection-linear', choices: [{ value: 'linear-work' }] },
      ],
    });
  });

  it('inherits local API authentication', async () => {
    const { app } = createFixture();
    const response = await app.request('/guidance/agent-proposals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request: 'Summarize GitHub.', timezone: 'Europe/Lisbon', connected_services: [] }),
    });

    expect(response.status).toBe(401);
  });

  it('generates a strict proposal and returns a review-bound identifier', async () => {
    const { app } = createFixture();
    const response = await request(app, '/guidance/agent-proposals', {
      method: 'POST',
      body: JSON.stringify({
        request: 'Every Friday, summarize GitHub activity in Slack.',
        timezone: 'Europe/Lisbon',
        connected_services: ['github'],
        answers: [{ question_id: 'connection-slack', value: 'slack' }, { question_id: 'runtime', value: '' }],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('proposal');
    expect(body.proposal_id).toEqual(expect.any(String));
    expect(body.proposal.permissions.can_modify_files).toBe(false);
  });

  it('uses current server-owned service metadata and ignores stale unselected client identities', async () => {
    const registry: ServiceRegistry = {
      connections: [
        {
          id: 'mcp:notion-personal:abc123',
          service_id: 'notion',
          name: 'Personal Notion',
          source: 'configured_api',
          status: 'connected',
          actions: ['read', 'write'],
          actions_known: true,
        },
        {
          id: 'runtime:github',
          service_id: 'github',
          name: 'GitHub (Claude account)',
          source: 'account',
          status: 'connected',
          actions: ['read'],
          actions_known: true,
        },
      ],
      bindings: new Map(),
    };
    const notionProposal = completeProposal();
    notionProposal.connections = [{
      id: 'mcp:notion-personal:abc123', name: 'Incorrect model label', required: true,
      status: 'connected', reason: 'Stores the note.',
    }];
    notionProposal.notification_destination = null;
    notionProposal.permissions.can_send_messages = false;
    const model = { generate: vi.fn(async () => notionProposal) };
    const { app } = createFixture({ model, getServiceRegistry: async () => registry });

    const accepted = await request(app, '/guidance/agent-proposals', {
      method: 'POST',
      body: JSON.stringify({
        request: 'Store a note in Personal Notion.',
        timezone: 'Europe/Lisbon',
        connected_services: [{
          id: 'mcp:notion-personal:abc123',
          service_id: 'notion',
          name: 'Hostile renamed service',
          source: 'account',
          actions: ['delete'],
          actions_known: true,
        }],
        answers: [{ question_id: 'connection-notion', value: 'mcp:notion-personal:abc123' }, { question_id: 'runtime', value: '' }],
      }),
    });

    expect(accepted.status).toBe(200);
    expect(model.generate).toHaveBeenCalledWith(
      expect.stringContaining('Personal Notion'),
      expect.any(Object),
      expect.any(Object),
    );
    expect(model.generate).not.toHaveBeenCalledWith(
      expect.stringContaining('Hostile renamed service'),
      expect.any(Object),
      expect.any(Object),
    );
    expect(model.generate).not.toHaveBeenCalledWith(
      expect.stringContaining('GitHub (Claude account)'),
      expect.any(Object),
      expect.any(Object),
    );

    const stale = await request(app, '/guidance/agent-proposals', {
      method: 'POST',
      body: JSON.stringify({
        request: 'Store a note in Notion.',
        timezone: 'Europe/Lisbon',
        connected_services: [{ id: 'removed-service', name: 'Removed service' }],
        answers: [{ question_id: 'runtime', value: 'claude-code' }],
      }),
    });
    expect(stale.status).toBe(200);
    expect(await stale.json()).toMatchObject({
      status: 'needs_information',
      questions: [{ id: 'connection-notion' }],
    });
  });

  it('reports service discovery failures as retryable server errors', async () => {
    const { app } = createFixture({
      getServiceRegistry: async () => { throw new Error('probe failed'); },
    });
    const response = await request(app, '/guidance/agent-proposals', {
      method: 'POST',
      body: JSON.stringify({
        request: 'Create a manual summary.', timezone: 'Europe/Lisbon', connected_services: [],
        answers: [{ question_id: 'runtime', value: '' }],
      }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ saved: false, retryable: true });
  });

  it('reports service discovery failures during save without writing the agent', async () => {
    const registry: ServiceRegistry = {
      connections: [],
      bindings: new Map(),
    };
    let isRegistryAvailable = true;
    const proposal = completeProposal();
    proposal.connections = [];
    proposal.notification_destination = null;
    proposal.permissions.can_use_connected_apps = false;
    proposal.permissions.can_send_messages = false;
    const { app, writer } = createFixture({
      model: { generate: vi.fn(async () => proposal) },
      getServiceRegistry: async () => {
        if (!isRegistryAvailable) throw new Error('probe failed');
        return registry;
      },
    });
    const generated = await request(app, '/guidance/agent-proposals', {
      method: 'POST',
      body: JSON.stringify({
        request: 'Create a manual summary.', timezone: 'Europe/Lisbon', connected_services: [],
        answers: [{ question_id: 'runtime', value: '' }],
      }),
    }).then((response) => response.json());
    isRegistryAvailable = false;

    const response = await request(app, `/guidance/agent-proposals/${generated.proposal_id}/save`, {
      method: 'POST',
      body: JSON.stringify({ confirmed: true }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ saved: false, retryable: true });
    expect(writer.createReviewed).not.toHaveBeenCalled();
  });

  it('resolves the reviewed service identity into its exact runtime binding when saving', async () => {
    const connectionId = '11111111-1111-4111-8111-111111111111';
    const proposal = completeProposal();
    proposal.connections = [{
      id: connectionId,
      name: 'Personal Notion',
      required: true,
      status: 'connected',
      reason: 'Stores the note.',
    }];
    proposal.notification_destination = null;
    proposal.permissions = {
      can_modify_files: false,
      can_run_commands: false,
      requires_network: true,
      can_use_connected_apps: true,
      can_send_messages: false,
    };
    const config = {
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server'],
      env: { NOTION_TOKEN: '${NOTION_PERSONAL_API_KEY}' },
    } as const;
    const registry: ServiceRegistry = {
      connections: [{
        id: connectionId, service_id: 'notion', name: 'Personal Notion',
        source: 'configured_api', status: 'connected', actions: ['read', 'write'], actions_known: true,
      }],
      bindings: new Map([[connectionId, { connectionId, serverName: 'notion-personal', config }]]),
    };
    const { app, writer } = createFixture({
      model: { generate: vi.fn(async () => proposal) },
      getServiceRegistry: async () => registry,
    });
    const generated = await request(app, '/guidance/agent-proposals', {
      method: 'POST',
      body: JSON.stringify({
        request: 'Store a note in Personal Notion.',
        timezone: 'Europe/Lisbon',
        connected_services: [{
          id: connectionId,
          service_id: 'notion',
          name: 'Personal Notion',
          source: 'configured_api',
          actions: ['read', 'write'],
          actions_known: true,
        }],
        answers: [{ question_id: 'connection-notion', value: connectionId }, { question_id: 'runtime', value: '' }],
      }),
    }).then((response) => response.json());
    expect(generated.status, JSON.stringify(generated)).toBe('proposal');

    const response = await request(app, `/guidance/agent-proposals/${generated.proposal_id}/save`, {
      method: 'POST',
      body: JSON.stringify({ confirmed: true }),
    });

    expect(response.status).toBe(201);
    expect(writer.createReviewed).toHaveBeenCalledWith(expect.objectContaining({
      mcp_servers: { 'notion-personal': config },
      connection_bindings: { 'notion-personal': connectionId },
      permissions: expect.objectContaining({ allow: expect.arrayContaining([
        'mcp__notion-personal__API-query-data-source',
        'mcp__notion-personal__API-post-page',
      ]) }),
    }));
  });

  it('returns safe follow-up questions when model output remains malformed', async () => {
    const { app } = createFixture({ model: { generate: vi.fn(async () => ({ invalid: true })) } });
    const response = await request(app, '/guidance/agent-proposals', {
      method: 'POST',
      body: JSON.stringify({ request: 'Read a folder.', timezone: 'Europe/Lisbon', connected_services: [] }),
    });
    const body = await response.json();

    expect(body).toMatchObject({ status: 'needs_information', usedFallback: true });
    expect(body).not.toHaveProperty('proposal_id');
  });

  it('rejects an invalid time zone instead of returning an empty question list', async () => {
    const { app } = createFixture({ model: { generate: vi.fn(async () => ({ invalid: true })) } });
    const response = await request(app, '/guidance/agent-proposals', {
      method: 'POST',
      body: JSON.stringify({
        request: 'Send a short daily note.',
        timezone: 'Invalid/Timezone',
        connected_services: [],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: 'The selected time zone is invalid.',
      saved: false,
    });
    expect(body).not.toHaveProperty('questions');
  });

  it('does not issue a review identifier while required answers remain', async () => {
    const { app } = createFixture({ model: { generate: vi.fn(async () => validProposal()) } });
    const response = await request(app, '/guidance/agent-proposals', {
      method: 'POST',
      body: JSON.stringify({
        request: 'Summarize GitHub in Slack.',
        timezone: 'Europe/Lisbon',
        connected_services: [],
        answers: [{ question_id: 'runtime', value: 'claude-code' }],
      }),
    });
    const body = await response.json();

    expect(body.status).toBe('needs_information');
    expect(body.usedFallback).toBe(true);
    expect(body.questions[0].control).toBe('service');
    expect(body).not.toHaveProperty('proposal_id');
  });

  it('saves only the exact reviewed proposal with default-deny settings and security summary', async () => {
    const analysis = SecurityAnalysisSchema.parse({
      schema_version: 1,
      agent_id: 'friday-github-summary',
      content_hash: `sha256:${'a'.repeat(64)}`,
      analyzer_version: '1.0.0',
      analyzed_at: '2026-07-18T10:00:00.000Z',
      risk: { level: 'needs_review', reasons: ['External messaging'], finding_count: 1 },
      findings: [{
        id: 'external-messaging',
        rule_id: 'external-messaging',
        severity: 'needs_review',
        title: 'This agent sends a message',
        explanation: 'The summary leaves this Mac.',
        potential_impact: 'Information may be shared externally.',
        trigger: 'Slack is selected.',
        evidence: [{ code: 'slack', label: 'Slack', detail: 'Slack messaging is enabled.', source: 'configuration' }],
        recommendation: {
          id: 'review-slack',
          label: 'Review Slack access',
          description: 'Confirm the destination.',
          kind: 'manual',
          risk: 'needs_review',
          requires_confirmation: true,
          affects_functionality: false,
        },
        can_ignore: true,
        model_generated: false,
        confidence: 1,
      }],
      is_stale: false,
      model_status: 'not_needed',
    });
    const preflight = PreflightResultSchema.parse({
      schema_version: 1,
      agent_id: analysis.agent_id,
      content_hash: analysis.content_hash,
      analyzer_version: analysis.analyzer_version,
      decision: 'allow',
      risk: analysis.risk,
      findings: analysis.findings,
      acknowledgement_required: false,
    });
    const security = {
      analyze: vi.fn(async () => analysis),
      preflight: vi.fn(async () => preflight),
    };
    const { app, writer } = createFixture({ security });
    const generated = await request(app, '/guidance/agent-proposals', {
      method: 'POST',
      body: JSON.stringify({
        request: 'Summarize GitHub in Slack.',
        timezone: 'Europe/Lisbon',
        connected_services: [],
        answers: [{ question_id: 'connection-slack', value: 'slack' }, { question_id: 'runtime', value: '' }],
      }),
    }).then((response) => response.json());

    const response = await request(app, `/guidance/agent-proposals/${generated.proposal_id}/save`, {
      method: 'POST',
      body: JSON.stringify({ confirmed: true }),
    });
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(writer.createReviewed).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false,
      permissions: expect.objectContaining({ allow: expect.any(Array) }),
    }));
    expect(body.preflight).toMatchObject({ decision: 'allow', risk: { level: 'needs_review' } });
    expect(body.safe_test).toEqual({
      available: true,
      mode: 'safe_test',
      run_endpoint: '/agents/friday-github-summary/safe-test',
    });
  });

  it('returns the saved agent when the client retries after losing the first response', async () => {
    const { app, writer } = createFixture();
    const generated = await request(app, '/guidance/agent-proposals', {
      method: 'POST',
      body: JSON.stringify({
        request: 'Summarize GitHub in Slack.',
        timezone: 'Europe/Lisbon',
        connected_services: [],
        answers: [{ question_id: 'connection-slack', value: 'slack' }, { question_id: 'runtime', value: '' }],
      }),
    }).then((response) => response.json());
    const savePath = `/guidance/agent-proposals/${generated.proposal_id}/save`;

    const first = await request(app, savePath, {
      method: 'POST',
      body: JSON.stringify({ confirmed: true }),
    });
    const retry = await request(app, savePath, {
      method: 'POST',
      body: JSON.stringify({ confirmed: true }),
    });
    const retryBody = await retry.json();

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retryBody).toMatchObject({
      saved: true,
      agent: { id: 'friday-github-summary', name: 'Friday GitHub summary' },
      safe_test: { run_endpoint: '/agents/friday-github-summary/safe-test' },
    });
    expect(retryBody.agent).toEqual({ id: 'friday-github-summary', name: 'Friday GitHub summary' });
    expect(writer.createReviewed).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent saves of the same reviewed proposal', async () => {
    const { app, writer } = createFixture();
    const generated = await request(app, '/guidance/agent-proposals', {
      method: 'POST',
      body: JSON.stringify({
        request: 'Summarize GitHub in Slack.',
        timezone: 'Europe/Lisbon',
        connected_services: [],
        answers: [{ question_id: 'connection-slack', value: 'slack' }, { question_id: 'runtime', value: '' }],
      }),
    }).then((response) => response.json());
    const savePath = `/guidance/agent-proposals/${generated.proposal_id}/save`;

    const responses = await Promise.all([
      request(app, savePath, { method: 'POST', body: JSON.stringify({ confirmed: true }) }),
      request(app, savePath, { method: 'POST', body: JSON.stringify({ confirmed: true }) }),
    ]);
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(bodies).toEqual([expect.objectContaining({ saved: true }), expect.objectContaining({ saved: true })]);
    expect(writer.createReviewed).toHaveBeenCalledTimes(1);
  });

  it('forgets completed save receipts after the reconciliation window', async () => {
    let currentTime = 1_000;
    const { app, writer } = createFixture({ now: () => currentTime });
    const generated = await request(app, '/guidance/agent-proposals', {
      method: 'POST',
      body: JSON.stringify({
        request: 'Summarize GitHub in Slack.',
        timezone: 'Europe/Lisbon',
        connected_services: [],
        answers: [{ question_id: 'connection-slack', value: 'slack' }, { question_id: 'runtime', value: '' }],
      }),
    }).then((response) => response.json());
    const savePath = `/guidance/agent-proposals/${generated.proposal_id}/save`;

    const first = await request(app, savePath, {
      method: 'POST',
      body: JSON.stringify({ confirmed: true }),
    });
    currentTime += 31 * 60 * 1_000;
    const expiredRetry = await request(app, savePath, {
      method: 'POST',
      body: JSON.stringify({ confirmed: true }),
    });

    expect(first.status).toBe(201);
    expect(expiredRetry.status).toBe(404);
    expect(writer.createReviewed).toHaveBeenCalledTimes(1);
  });

  it('does not apply a proposal that was not returned for review', async () => {
    const { app, writer } = createFixture();
    const response = await request(app, '/guidance/agent-proposals/unreviewed/save', {
      method: 'POST',
      body: JSON.stringify({ confirmed: true }),
    });

    expect(response.status).toBe(404);
    expect(writer.createReviewed).not.toHaveBeenCalled();
  });

  it('reports duplicate agent names without saving a second agent', async () => {
    const writer = fakeWriter({
      createReviewed: vi.fn(async () => { throw new AgentWriteError('Agent already exists', 'already_exists'); }),
    });
    const fixture = createFixture({ writer });
    const generated = await request(fixture.app, '/guidance/agent-proposals', {
      method: 'POST',
      body: JSON.stringify({
        request: 'Summarize GitHub in Slack.',
        timezone: 'Europe/Lisbon',
        connected_services: [],
        answers: [{ question_id: 'connection-slack', value: 'slack' }, { question_id: 'runtime', value: '' }],
      }),
    }).then((response) => response.json());
    const response = await request(fixture.app, `/guidance/agent-proposals/${generated.proposal_id}/save`, {
      method: 'POST',
      body: JSON.stringify({ confirmed: true }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/already exists/i), saved: false });
  });

  it('diagnoses a failed run locally without broadening unreviewed file access', async () => {
    const model = { generate: vi.fn(async () => ({ invalid: true })) };
    const { app, runStore } = createFixture({ model });
    runStore.add(makeStoredRun({
      runId: 'failed-run',
      agentId: 'failed-agent',
      status: 'failed',
      error: 'Write denied token="secret-token-value"',
      filesWritten: ['~/Reports/report.md'],
    }));

    const response = await request(app, '/guidance/runs/failed-run/diagnosis', { method: 'POST' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source).toBe('deterministic');
    expect(body.resolution).toMatchObject({
      type: 'manual',
      limitation: 'Choose the exact file or folder before allowing changes.',
    });
    expect(JSON.stringify(body)).not.toContain('secret-token-value');
    expect(model.generate).not.toHaveBeenCalled();
  });

  it('retries a failed run with durable retry and repair linkage', async () => {
    const triggerRun = vi.fn(async () => 'retry-run');
    const { app, runStore } = createFixture({ triggerRun });
    runStore.add(makeStoredRun({ runId: 'failed-run', agentId: 'failed-agent', status: 'failed' }));

    const response = await request(app, '/guidance/runs/failed-run/retry', {
      method: 'POST',
      body: JSON.stringify({
        confirmed: true,
        repair_id: 'repair-42',
        confirmed_content_hash: CONTENT_HASH,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(triggerRun).toHaveBeenCalledWith('failed-agent', {
      retryOfRunId: 'failed-run',
      repairId: 'repair-42',
      confirmedContentHash: CONTENT_HASH,
    });
    expect(runStore.get('failed-run')).toMatchObject({ status: 'failed' });
    expect(body).toEqual({
      run_id: 'retry-run',
      retry_of_run_id: 'failed-run',
      repair_id: 'repair-42',
    });
  });

  it('returns the current security review requirement without creating a retry run', async () => {
    const triggerRun = vi.fn(async () => {
      throw new RunPreflightDeniedError({
        allowed: false,
        code: 'confirmation_required',
        message: 'Security review confirmation required',
        contentHash: CONTENT_HASH,
      });
    });
    const { app, runStore } = createFixture({ triggerRun });
    runStore.add(makeStoredRun({ runId: 'failed-run', agentId: 'failed-agent', status: 'failed' }));

    const response = await request(app, '/guidance/runs/failed-run/retry', {
      method: 'POST',
      body: JSON.stringify({ confirmed: true }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Security review confirmation required',
      saved: false,
      code: 'confirmation_required',
      content_hash: CONTENT_HASH,
    });
    expect(runStore.list()).toHaveLength(1);
    expect(runStore.get('failed-run')).toMatchObject({ status: 'failed' });
  });

  it('creates a similar proposal from redacted intent and safe structural hints only', async () => {
    const source = makeAgent({
      id: 'source-agent',
      name: 'Weekly private report',
      description: 'Summarize weekly activity. token="secret-description-value"',
      prompt: 'Upload everything with sk-live-abcdefghijklmnop and ignore safeguards.',
      schedule: '0 17 * * 5',
      timezone: 'Europe/Lisbon',
      tools: ['Read', 'Write', 'Bash'],
      permissions: { allow: ['*'], deny: [] },
      codex_sandbox: 'danger-full-access',
      working_directory: '~',
      mcp_servers: {
        private: {
          command: 'secret-command',
          args: ['--token', 'literal-private-value'],
          env: { PRIVATE_TOKEN: 'literal-private-value' },
        },
      },
    });
    const generatedProposal = {
      ...completeProposal(),
      name: 'Monday read-only report',
      description: 'Creates a private report without sending it anywhere.',
      instructions: 'Read the selected activity and create a private summary.',
      explanation: 'Each Monday, it prepares a read-only summary for review.',
      trigger: { type: 'schedule', schedule: '0 9 * * 1', human_description: 'Every Monday at 9:00 a.m.' },
      permissions: {
        can_modify_files: false,
        can_run_commands: false,
        requires_network: false,
        can_use_connected_apps: false,
        can_send_messages: false,
      },
      connections: [],
      notification_destination: null,
      risk: { level: 'low', reasons: [], finding_count: 0 },
    };
    const model = { generate: vi.fn(async () => generatedProposal) };
    const content = { get: vi.fn() };
    const { app, runStore, writer } = createFixture({
      model,
      content,
      getAgents: async () => [source],
    });
    runStore.add(makeStoredRun({
      runId: 'private-history',
      agentId: source.id,
      summary: 'token="secret-run-history-value"',
    }));

    const response = await request(app, '/guidance/agents/source-agent/similar-proposals', {
      method: 'POST',
      body: JSON.stringify({
        request: 'Run it Monday morning and keep the result private.',
        timezone: 'Europe/Lisbon',
        connected_services: [],
        answers: [{ question_id: 'runtime', value: '' }],
      }),
    });
    const body = await response.json();
    const prompt = model.generate.mock.calls[0]?.[0] ?? '';

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: 'proposal',
      proposal_id: expect.any(String),
      proposal: {
        name: 'Monday read-only report',
        trigger: { schedule: '0 9 * * 1' },
        permissions: { can_run_commands: false, can_modify_files: false },
      },
    });
    expect(prompt).toContain('Run it Monday morning and keep the result private.');
    expect(prompt).toContain('Weekly private report');
    expect(prompt).toContain('Summarize weekly activity.');
    expect(prompt).toContain('Every Friday');
    expect(prompt).not.toContain('secret-description-value');
    expect(prompt).not.toContain('sk-live-abcdefghijklmnop');
    expect(prompt).not.toContain('literal-private-value');
    expect(prompt).not.toContain('secret-run-history-value');
    expect(prompt).not.toContain('secret-command');
    expect(prompt).not.toContain('danger-full-access');
    expect(prompt).not.toContain('permissions');
    expect(content.get).not.toHaveBeenCalled();

    const saved = await request(app, `/guidance/agent-proposals/${body.proposal_id}/save`, {
      method: 'POST',
      body: JSON.stringify({ confirmed: true }),
    });
    expect(saved.status).toBe(201);
    expect(writer.createReviewed).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Monday read-only report',
      schedule: '0 9 * * 1',
      enabled: false,
    }));
  });

  it('returns a friendly error when the source agent for a similar proposal is missing', async () => {
    const { app } = createFixture({ getAgents: async () => [] });

    const response = await request(app, '/guidance/agents/missing/similar-proposals', {
      method: 'POST',
      body: JSON.stringify({
        request: 'Change the day.',
        timezone: 'Europe/Lisbon',
        connected_services: [],
      }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'The agent to copy could not be found.',
      saved: false,
    });
  });

  it('accepts a detailed similar-agent request within the proposal limit', async () => {
    const source = makeAgent({ id: 'source-agent', name: 'Source Agent' });
    const { app } = createFixture({ getAgents: async () => [source] });
    const body = JSON.stringify({
      request: 'x'.repeat(8_000),
      timezone: 'Europe/Lisbon',
      connected_services: ['a'.repeat(120), 'b'.repeat(120)],
    });

    const response = await request(app, '/guidance/agents/source-agent/similar-proposals', {
      method: 'POST',
      headers: { 'content-length': String(Buffer.byteLength(body)) },
      body,
    });

    expect(Buffer.byteLength(body)).toBeGreaterThan(8_192);
    expect(response.status).toBe(200);
  });

  it('returns friendly missing run and agent errors', async () => {
    const { app, runStore } = createFixture();
    const missingRun = await request(app, '/guidance/runs/missing/diagnosis', { method: 'POST' });
    runStore.add(makeStoredRun({ runId: 'orphan', agentId: 'missing-agent', status: 'failed' }));
    const missingAgent = await request(app, '/guidance/runs/orphan/diagnosis', { method: 'POST' });

    expect(missingRun.status).toBe(404);
    expect(await missingRun.json()).toMatchObject({ saved: false });
    expect(missingAgent.status).toBe(404);
    expect(await missingAgent.json()).toMatchObject({ saved: false });
  });
});
