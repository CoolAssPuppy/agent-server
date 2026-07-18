import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../server/api.js';
import { RunStore } from '../reporting/store.js';
import { makeAgent, makeStoredRun } from '../test-factories.js';
import { AgentWriteError, type AgentWriter } from '../agents/writer.js';
import { PreflightResultSchema, SecurityAnalysisSchema } from '../analysis/models.js';
import { createGuidanceApi, type GuidanceApiDependencies } from './guidance-api.js';

const API_KEY = 'guidance-test-key-1234567890';

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
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('proposal');
    expect(body.proposal_id).toEqual(expect.any(String));
    expect(body.proposal.permissions.can_modify_files).toBe(false);
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

  it('does not issue a review identifier while required answers remain', async () => {
    const { app } = createFixture({ model: { generate: vi.fn(async () => validProposal()) } });
    const response = await request(app, '/guidance/agent-proposals', {
      method: 'POST',
      body: JSON.stringify({ request: 'Summarize GitHub in Slack.', timezone: 'Europe/Lisbon', connected_services: [] }),
    });
    const body = await response.json();

    expect(body.status).toBe('needs_information');
    expect(body.usedFallback).toBe(false);
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
      body: JSON.stringify({ request: 'Summarize GitHub.', timezone: 'Europe/Lisbon', connected_services: [] }),
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
      body: JSON.stringify({ request: 'Summarize GitHub.', timezone: 'Europe/Lisbon', connected_services: [] }),
    }).then((response) => response.json());
    const response = await request(fixture.app, `/guidance/agent-proposals/${generated.proposal_id}/save`, {
      method: 'POST',
      body: JSON.stringify({ confirmed: true }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/already exists/i), saved: false });
  });

  it('diagnoses a failed run locally before asking the model and redacts evidence', async () => {
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
      type: 'configuration_patch',
      confirmation_required: true,
      patch: {
        source: 'debugger',
        changes: { codex_sandbox: 'workspace-write' },
      },
    });
    expect(JSON.stringify(body)).not.toContain('secret-token-value');
    expect(model.generate).not.toHaveBeenCalled();
  });

  it('retries a failed run with an explicit typed linkage limitation', async () => {
    const triggerRun = vi.fn(async () => 'retry-run');
    const { app, runStore } = createFixture({ triggerRun });
    runStore.add(makeStoredRun({ runId: 'failed-run', agentId: 'failed-agent', status: 'failed' }));

    const response = await request(app, '/guidance/runs/failed-run/retry', {
      method: 'POST',
      body: JSON.stringify({ confirmed: true }),
    });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(triggerRun).toHaveBeenCalledWith('failed-agent');
    expect(body).toEqual({
      run_id: 'retry-run',
      retry_of: 'failed-run',
      linkage: {
        persisted: false,
        reason: 'Run history does not support retry links yet.',
      },
    });
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
