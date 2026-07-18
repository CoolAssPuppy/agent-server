import { describe, expect, it } from 'vitest';
import { parseAgentFile } from '../agents/config.js';
import { SqliteSecurityReviewStore } from './review-store.js';
import { SecurityAnalysisService } from './security-service.js';

const safeAgent = `---
id: reader
name: Reader
tools: [Read]
codex_sandbox: read-only
---
Review the selected notes without changing them.
`;

const riskyAgent = `---
id: risky
name: Risky
tools: [Read, Write]
schedule: "0 9 * * *"
---
Update the report each morning.
`;

describe('security analysis service', () => {
  it('scans agents, persists analysis state, and marks changed content stale', async () => {
    const reviewStore = new SqliteSecurityReviewStore({ path: ':memory:' });
    const service = new SecurityAnalysisService({ reviewStore, homeDir: '/Users/example' });

    const scan = await service.scan([
      { content: safeAgent, agent: parseAgentFile(safeAgent) },
      { content: riskyAgent, agent: parseAgentFile(riskyAgent) },
    ]);

    expect(scan.summary.total_agents).toBe(2);
    expect(scan.summary.by_risk.critical).toBe(1);
    expect(scan.summary.stale_reviews).toBe(2);
    expect(reviewStore.isStale('reader', scan.analyses[0]!.content_hash, scan.analyses[0]!.analyzer_version)).toBe(false);
    expect(service.reviewState('reader', `${safeAgent}\n# changed`).is_stale).toBe(true);
    reviewStore.close();
  });

  it('merges semantic findings without lowering deterministic critical risk', async () => {
    const reviewStore = new SqliteSecurityReviewStore({ path: ':memory:' });
    const credentialContent = safeAgent.replace(
      'Review the selected notes',
      'Use token sk-live-abcdefghijklmnop to review the selected notes',
    );
    const service = new SecurityAnalysisService({
      reviewStore,
      homeDir: '/Users/example',
      model: {
        handlesRetries: true,
        generate: async () => ({
          schema_version: 1,
          findings: [{
            id: 'untrusted-input', risk: 'needs_review', title: 'Review incoming content',
            reason: 'Incoming content may contain instructions.', trigger_condition: 'A file contains instructions.',
            potential_impact: 'The task may behave unexpectedly.', recommended_mitigation: 'Treat content as data.',
            confidence: 0.7, human_review_required: true,
          }],
        }),
      },
    });
    const analysis = await service.analyze({
      content: credentialContent,
      agent: parseAgentFile(credentialContent),
    });

    expect(analysis.model_status).toBe('completed');
    expect(analysis.risk.level).toBe('critical');
    expect(analysis.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule_id: 'secret.literal', model_generated: false }),
      expect.objectContaining({ rule_id: 'semantic.untrusted-input', model_generated: true }),
    ]));
    reviewStore.close();
  });

  it.each([
    { error: undefined, expected: 'invalid' },
    { error: new Error('Local structured model timed out.'), expected: 'timed_out' },
    { error: new Error('Codex unavailable'), expected: 'unavailable' },
  ] as const)('preserves deterministic analysis when semantic status is $expected', async ({ error, expected }) => {
    const reviewStore = new SqliteSecurityReviewStore({ path: ':memory:' });
    const service = new SecurityAnalysisService({
      reviewStore,
      homeDir: '/Users/example',
      model: {
        handlesRetries: true,
        generate: async () => {
          if (error) throw error;
          return { malformed: true };
        },
      },
    });
    const analysis = await service.analyze({ content: riskyAgent, agent: parseAgentFile(riskyAgent) });
    expect(analysis.model_status).toBe(expected);
    expect(analysis.risk.level).toBe('critical');
    expect(analysis.findings.length).toBeGreaterThan(0);
    reviewStore.close();
  });

  it('reports an expected semantic model as unavailable when none is configured', async () => {
    const reviewStore = new SqliteSecurityReviewStore({ path: ':memory:' });
    const service = new SecurityAnalysisService({ reviewStore, homeDir: '/Users/example' });
    const analysis = await service.analyze({ content: safeAgent, agent: parseAgentFile(safeAgent) });
    expect(analysis.model_status).toBe('unavailable');
    reviewStore.close();
  });

  it('caches one merged analysis and invalidates it when content changes', async () => {
    const reviewStore = new SqliteSecurityReviewStore({ path: ':memory:' });
    let calls = 0;
    const service = new SecurityAnalysisService({
      reviewStore,
      homeDir: '/Users/example',
      model: {
        handlesRetries: true,
        generate: async () => {
          calls += 1;
          return { schema_version: 1, findings: [] };
        },
      },
    });
    const input = { content: safeAgent, agent: parseAgentFile(safeAgent) };
    await Promise.all([service.analyze(input), service.analyze(input), service.preflight(input)]);
    expect(calls).toBe(1);

    const changed = safeAgent.replace('Review the selected notes', 'Review only the selected notes');
    await service.analyze({ content: changed, agent: parseAgentFile(changed) });
    expect(calls).toBe(2);
    reviewStore.close();
  });

  it('does not cache a temporary semantic model outage', async () => {
    const reviewStore = new SqliteSecurityReviewStore({ path: ':memory:' });
    let calls = 0;
    const service = new SecurityAnalysisService({
      reviewStore,
      homeDir: '/Users/example',
      model: {
        handlesRetries: true,
        generate: async () => {
          calls += 1;
          throw new Error('Codex unavailable');
        },
      },
    });
    const input = { content: safeAgent, agent: parseAgentFile(safeAgent) };
    await service.analyze(input);
    await service.analyze(input);
    expect(calls).toBe(2);
    reviewStore.close();
  });

  it('bounds semantic analysis concurrency during a global scan', async () => {
    const reviewStore = new SqliteSecurityReviewStore({ path: ':memory:' });
    let active = 0;
    let maximumActive = 0;
    const service = new SecurityAnalysisService({
      reviewStore,
      homeDir: '/Users/example',
      model: {
        handlesRetries: true,
        generate: async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return { schema_version: 1, findings: [] };
        },
      },
    });
    const inputs = Array.from({ length: 6 }, (_, index) => {
      const content = safeAgent
        .replace('id: reader', `id: reader-${index}`)
        .replace('name: Reader', `name: Reader ${index}`);
      return { content, agent: parseAgentFile(content) };
    });
    await service.scan(inputs);
    expect(maximumActive).toBeLessThanOrEqual(2);
    reviewStore.close();
  });

  it('evicts the oldest merged analysis after one hundred cached agents', async () => {
    const reviewStore = new SqliteSecurityReviewStore({ path: ':memory:' });
    let calls = 0;
    const service = new SecurityAnalysisService({
      reviewStore,
      homeDir: '/Users/example',
      model: {
        handlesRetries: true,
        generate: async () => {
          calls += 1;
          return { schema_version: 1, findings: [] };
        },
      },
    });
    const inputs = Array.from({ length: 101 }, (_, index) => {
      const content = safeAgent
        .replace('id: reader', `id: cached-${index}`)
        .replace('name: Reader', `name: Cached ${index}`);
      return { content, agent: parseAgentFile(content) };
    });
    for (const input of inputs) await service.analyze(input);
    await service.analyze(inputs[0]!);
    expect(calls).toBe(102);
    reviewStore.close();
  });

  it('only records review acknowledgements for the current analysis', async () => {
    const reviewStore = new SqliteSecurityReviewStore({ path: ':memory:' });
    const service = new SecurityAnalysisService({ reviewStore, homeDir: '/Users/example' });
    const analysis = await service.analyze({ content: riskyAgent, agent: parseAgentFile(riskyAgent) });

    expect(service.markReviewed({
      agent_id: 'risky',
      content_hash: analysis.content_hash,
      acknowledged_finding_ids: analysis.findings.map((finding) => finding.id),
    })).toBe(true);
    expect(service.getReviewState('risky', analysis.content_hash)).toEqual({
      reviewed_at: expect.any(String),
      is_reviewed: true,
      is_stale: false,
      acknowledged_finding_ids: analysis.findings.map((finding) => finding.id),
      analyzer_version: '1.1.0',
      content_hash: analysis.content_hash,
    });
    const rescanned = await service.scan([{ content: riskyAgent, agent: parseAgentFile(riskyAgent) }]);
    expect(rescanned.summary.stale_reviews).toBe(0);
    expect(service.markReviewed({
      agent_id: 'risky',
      content_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      acknowledged_finding_ids: [],
    })).toBe(false);
    const changedHash = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    expect(service.getReviewState('risky', changedHash)).toMatchObject({
      reviewed_at: expect.any(String),
      is_reviewed: false,
      is_stale: true,
      acknowledged_finding_ids: analysis.findings.map((finding) => finding.id),
      content_hash: changedHash,
    });
    expect(service.markReviewed({
      agent_id: 'risky',
      content_hash: analysis.content_hash,
      acknowledged_finding_ids: ['finding-that-does-not-exist'],
    })).toBe(false);
    reviewStore.close();
  });
});
