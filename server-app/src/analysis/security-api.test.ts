import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { parseAgentFile } from '../agents/config.js';
import { computeAgentContentHash } from './security-rules.js';
import { createAnalysisApi } from './security-api.js';
import { ConfigurationPatchSchema, InMemoryAgentContentRepository, StructuredPatchService } from './patch.js';
import { SqliteSecurityReviewStore } from './review-store.js';
import { SecurityAnalysisService } from './security-service.js';

const content = `---
id: reader
name: Reader
tools: [Read]
codex_sandbox: read-only
---
Review notes without changing them.
`;

function createFixture() {
  const repository = new InMemoryAgentContentRepository({ reader: content });
  const reviewStore = new SqliteSecurityReviewStore({ path: ':memory:' });
  const security = new SecurityAnalysisService({ reviewStore, homeDir: '/Users/example' });
  const app = new Hono();
  app.route('/', createAnalysisApi({
    security,
    patches: new StructuredPatchService(repository),
    content: {
      get: async (id) => ({ content: await repository.read(id), agent: parseAgentFile(await repository.read(id)) }),
      list: async () => [{ content: await repository.read('reader'), agent: parseAgentFile(await repository.read('reader')) }],
    },
  }));
  return { app, repository, reviewStore };
}

const commandContent = `---
id: reader
name: Reader
tools: [Read, Bash]
codex_sandbox: workspace-write
---
Review notes with a local command.
`;

const nativeMutationContent = `---
id: reader
name: Reader
tools: [Read, mcp__eventkit__create_event]
permissions:
  allow: [Read, mcp__eventkit__create_event]
  deny: []
native_services:
  calendar:
    resources:
      - id: work
        name: Work
        actions: [create]
---
Add an event to the Work calendar.
`;

describe('security and patch API', () => {
  it('analyzes one agent and the full local collection', async () => {
    const fixture = createFixture();
    const agentResponse = await fixture.app.request('/security/agents/reader');
    const scanResponse = await fixture.app.request('/security/scan', { method: 'POST' });

    expect(agentResponse.status).toBe(200);
    const agentBody = await agentResponse.json();
    const scanBody = await scanResponse.json();
    expect(agentBody.agent_id).toBe('reader');
    expect(agentBody.review_state).toMatchObject({
      reviewed_at: null,
      is_reviewed: false,
      is_stale: false,
      acknowledged_finding_ids: [],
      analyzer_version: '1.1.0',
      content_hash: agentBody.content_hash,
    });
    expect(scanBody.summary.total_agents).toBe(1);
    expect(scanBody.analyses[0].review_state).toMatchObject({ is_reviewed: false, is_stale: false });
    fixture.reviewStore.close();
  });

  it('returns the updated persisted review state after acknowledgement', async () => {
    const fixture = createFixture();
    const analysisResponse = await fixture.app.request('/security/agents/reader');
    const analysis = await analysisResponse.json();
    const response = await fixture.app.request('/security/agents/reader/review', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        content_hash: analysis.content_hash,
        acknowledged_finding_ids: analysis.findings.map((finding: { id: string }) => finding.id),
      }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({
      reviewed: true,
      review_state: {
        reviewed_at: expect.any(String),
        is_reviewed: true,
        is_stale: false,
        acknowledged_finding_ids: analysis.findings.map((finding: { id: string }) => finding.id),
        analyzer_version: '1.1.0',
        content_hash: analysis.content_hash,
      },
    });
    expect(JSON.stringify(body)).not.toContain('reason');
    expect(JSON.stringify(body)).not.toContain('content"');
    fixture.reviewStore.close();
  });

  it('runs before-run preflight through the same security service', async () => {
    const fixture = createFixture();
    const response = await fixture.app.request('/security/agents/reader/preflight', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      agent_id: 'reader', decision: 'allow', acknowledgement_required: false,
    });
    fixture.reviewStore.close();
  });

  it('returns a validated patch for a deterministic safe security fix', async () => {
    const repository = new InMemoryAgentContentRepository({ reader: commandContent });
    const reviewStore = new SqliteSecurityReviewStore({ path: ':memory:' });
    const security = new SecurityAnalysisService({ reviewStore, homeDir: '/Users/example' });
    const app = new Hono();
    app.route('/', createAnalysisApi({
      security,
      patches: new StructuredPatchService(repository),
      content: {
        get: async (id) => ({ content: await repository.read(id), agent: parseAgentFile(await repository.read(id)) }),
        list: async () => [],
      },
    }));

    const response = await app.request('/security/agents/reader');
    const body = await response.json();
    const finding = body.findings.find((candidate: { rule_id: string }) => candidate.rule_id === 'permissions.commands');

    expect(finding.patch).toMatchObject({
      source: 'security_analyzer',
      changes: { tools: ['Read'], disallowed_tools: ['Bash'] },
    });
    await expect(ConfigurationPatchSchema.parseAsync(finding.patch)).resolves.toBeDefined();
    reviewStore.close();
  });

  it('does not offer command removal when it would leave the runtime unrestricted', async () => {
    const unsafeContent = commandContent.replace('tools: [Read, Bash]', 'tools: [Bash]');
    const repository = new InMemoryAgentContentRepository({ reader: unsafeContent });
    const reviewStore = new SqliteSecurityReviewStore({ path: ':memory:' });
    const security = new SecurityAnalysisService({ reviewStore, homeDir: '/Users/example' });
    const app = new Hono();
    app.route('/', createAnalysisApi({
      security,
      patches: new StructuredPatchService(repository),
      content: {
        get: async (id) => ({ content: await repository.read(id), agent: parseAgentFile(await repository.read(id)) }),
        list: async () => [],
      },
    }));

    const body = await (await app.request('/security/agents/reader')).json();
    const finding = body.findings.find((candidate: { rule_id: string }) => candidate.rule_id === 'permissions.commands');

    expect(finding.patch).toBeUndefined();
    reviewStore.close();
  });

  it('removes create-only native access without silently adding read access', async () => {
    const repository = new InMemoryAgentContentRepository({ reader: nativeMutationContent });
    const reviewStore = new SqliteSecurityReviewStore({ path: ':memory:' });
    const security = new SecurityAnalysisService({ reviewStore, homeDir: '/Users/example' });
    const app = new Hono();
    app.route('/', createAnalysisApi({
      security,
      patches: new StructuredPatchService(repository),
      content: {
        get: async (id) => ({ content: await repository.read(id), agent: parseAgentFile(await repository.read(id)) }),
        list: async () => [],
      },
    }));

    const body = await (await app.request('/security/agents/reader')).json();
    const finding = body.findings.find((candidate: { rule_id: string }) => candidate.rule_id === 'native.state_change');

    expect(finding.patch.changes).toMatchObject({
      tools: ['Read'],
      permissions: { allow: ['Read'], deny: ['mcp__eventkit__create_event'] },
      native_services: { calendar: { resources: [] } },
    });
    reviewStore.close();
  });

  it('previews and applies a safe patch, then rolls it back', async () => {
    const fixture = createFixture();
    const patch = {
      schema_version: 1,
      agent_id: 'reader',
      expected_content_hash: computeAgentContentHash(content),
      source: 'security_analyzer',
      reason: 'Use a narrower folder',
      changes: { working_directory: '/Users/example/Documents/Notes' },
    };
    const previewResponse = await fixture.app.request('/configuration-patches/preview', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
    });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json();
    expect(preview).not.toHaveProperty('result_content');
    expect(preview).not.toHaveProperty('patch');
    expect(preview.changes).toEqual(expect.arrayContaining([
      { field: 'working_directory', summary: 'Change the working folder' },
    ]));

    const applyResponse = await fixture.app.request('/configuration-patches/apply', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
    });
    const applied = await applyResponse.json();
    expect(applyResponse.status).toBe(200);
    expect(await fixture.repository.read('reader')).toContain('working_directory');

    const rollbackResponse = await fixture.app.request('/configuration-patches/rollback', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rollback_token: applied.rollback_token }),
    });
    expect(rollbackResponse.status).toBe(200);
    expect(await fixture.repository.read('reader')).toBe(content);
    fixture.reviewStore.close();
  });

  it('never echoes replacement instructions or literal tokens in a public preview', async () => {
    const fixture = createFixture();
    const response = await fixture.app.request('/configuration-patches/preview', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        schema_version: 1,
        agent_id: 'reader',
        expected_content_hash: computeAgentContentHash(content),
        source: 'debugger',
        reason: 'Remove the exposed credential',
        changes: { prompt: 'Use token sk-live-abcdefghijklmnop to read notes.' },
      }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(JSON.stringify(body)).not.toContain('sk-live-abcdefghijklmnop');
    expect(body.advanced_changes.prompt).toBe('[Updated instructions]');
    expect(body.can_apply).toBe(false);
    fixture.reviewStore.close();
  });

  it('rejects unsafe changes and stale review acknowledgements', async () => {
    const fixture = createFixture();
    const unsafeResponse = await fixture.app.request('/configuration-patches/preview', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        schema_version: 1, agent_id: 'reader', expected_content_hash: computeAgentContentHash(content),
        source: 'debugger', reason: 'Run a helper', changes: { tools: ['Bash'] },
      }),
    });
    expect(unsafeResponse.status).toBe(422);

    const reviewResponse = await fixture.app.request('/security/agents/reader/review', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        content_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        acknowledged_finding_ids: [],
      }),
    });
    expect(reviewResponse.status).toBe(409);
    fixture.reviewStore.close();
  });
});
