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

  it('only records review acknowledgements for the current analysis', async () => {
    const reviewStore = new SqliteSecurityReviewStore({ path: ':memory:' });
    const service = new SecurityAnalysisService({ reviewStore, homeDir: '/Users/example' });
    const analysis = await service.analyze({ content: riskyAgent, agent: parseAgentFile(riskyAgent) });

    expect(service.markReviewed({
      agent_id: 'risky',
      content_hash: analysis.content_hash,
      acknowledged_finding_ids: analysis.findings.map((finding) => finding.id),
    })).toBe(true);
    const rescanned = await service.scan([{ content: riskyAgent, agent: parseAgentFile(riskyAgent) }]);
    expect(rescanned.summary.stale_reviews).toBe(0);
    expect(service.markReviewed({
      agent_id: 'risky',
      content_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      acknowledged_finding_ids: [],
    })).toBe(false);
    expect(service.markReviewed({
      agent_id: 'risky',
      content_hash: analysis.content_hash,
      acknowledged_finding_ids: ['finding-that-does-not-exist'],
    })).toBe(false);
    reviewStore.close();
  });
});
