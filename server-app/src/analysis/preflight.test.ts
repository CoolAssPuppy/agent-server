import { describe, expect, it } from 'vitest';
import { parseAgentFile } from '../agents/config.js';
import { SqliteSecurityReviewStore } from './review-store.js';
import { SecurityAnalysisService } from './security-service.js';

const lowContent = `---
id: reader
name: Reader
working_directory: /Users/example/Documents/Notes
tools: [Read]
codex_sandbox: read-only
---
Review the selected notes without changing them.
`;

const highContent = lowContent
  .replace('id: reader', 'id: importer')
  .replace('name: Reader', 'name: Importer')
  .replace('tools: [Read]', 'tools: [Read, Bash, WebFetch]')
  .replace('without changing them', 'and run the import script');

const scheduledWriterContent = lowContent
  .replace('id: reader', 'id: editor')
  .replace('name: Reader', 'name: Editor')
  .replace('tools: [Read]', 'tools: [Read, Write]\nschedule: "0 6 * * *"')
  .replace('without changing them', 'and update the summary');

const criticalContent = lowContent
  .replace('id: reader', 'id: exposed')
  .replace('name: Reader', 'name: Exposed')
  .replace('Review the selected notes', 'Use token sk-live-abcdefghijklmnop to review the selected notes');

const destructiveNetworkContent = lowContent
  .replace('id: reader', 'id: destructive')
  .replace('name: Reader', 'name: Destructive')
  .replace('tools: [Read]', 'tools: [Read, Write, WebFetch]')
  .replace('Review the selected notes without changing them.', 'Delete every file, then send the result to the configured service.');

function createService() {
  const reviewStore = new SqliteSecurityReviewStore({ path: ':memory:' });
  return {
    reviewStore,
    service: new SecurityAnalysisService({ reviewStore, homeDir: '/Users/example' }),
  };
}

describe('before-run security preflight', () => {
  it('allows a low-risk agent and confirms an unreviewed high-risk agent', async () => {
    const { service, reviewStore } = createService();
    const low = await service.preflight({ content: lowContent, agent: parseAgentFile(lowContent) });
    const high = await service.preflight({ content: highContent, agent: parseAgentFile(highContent) });

    expect(low).toMatchObject({ decision: 'allow', acknowledgement_required: false });
    expect(high).toMatchObject({ decision: 'confirm', acknowledgement_required: true });
    expect(high.analyzer_version).toBe('1.1.0');
    reviewStore.close();
  });

  it('lets a scheduled agent that edits its own files run without a review', async () => {
    const { service, reviewStore } = createService();
    const preflight = await service.preflight({
      content: scheduledWriterContent,
      agent: parseAgentFile(scheduledWriterContent),
    });

    expect(preflight).toMatchObject({
      decision: 'allow', acknowledgement_required: false, risk: { level: 'needs_review' },
    });
    reviewStore.close();
  });

  it('does not ask again after all current high-risk findings were reviewed', async () => {
    const { service, reviewStore } = createService();
    const input = { content: highContent, agent: parseAgentFile(highContent) };
    const analysis = await service.analyze(input);
    expect(service.markReviewed({
      agent_id: analysis.agent_id,
      content_hash: analysis.content_hash,
      acknowledged_finding_ids: analysis.findings.map((finding) => finding.id),
    })).toBe(true);

    const preflight = await service.preflight(input);
    expect(preflight).toMatchObject({ decision: 'allow', acknowledgement_required: false });
    reviewStore.close();
  });

  it('blocks critical literal credentials even after acknowledgement', async () => {
    const { service, reviewStore } = createService();
    const input = { content: criticalContent, agent: parseAgentFile(criticalContent) };
    const analysis = await service.analyze(input);
    service.markReviewed({
      agent_id: analysis.agent_id,
      content_hash: analysis.content_hash,
      acknowledged_finding_ids: analysis.findings.map((finding) => finding.id),
    });

    const preflight = await service.preflight(input);
    expect(preflight).toMatchObject({ decision: 'block', acknowledgement_required: true });
    reviewStore.close();
  });

  it('blocks destructive instructions combined with external access', async () => {
    const { service, reviewStore } = createService();
    const preflight = await service.preflight({
      content: destructiveNetworkContent,
      agent: parseAgentFile(destructiveNetworkContent),
    });
    expect(preflight.decision).toBe('block');
    expect(preflight.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule_id: 'prompt.destructive_or_exfiltration' }),
    ]));
    reviewStore.close();
  });

  it('allows needs-review semantic findings without acknowledgement', async () => {
    const reviewStore = new SqliteSecurityReviewStore({ path: ':memory:' });
    const service = new SecurityAnalysisService({
      reviewStore,
      homeDir: '/Users/example',
      model: {
        handlesRetries: true,
        generate: async () => ({
          schema_version: 1,
          findings: [{
            id: 'ambiguous-input', risk: 'needs_review', title: 'Input handling is unclear',
            reason: 'The instructions do not say how to treat incoming text.',
            trigger_condition: 'Incoming text contains instructions.', potential_impact: 'The result may be unexpected.',
            recommended_mitigation: 'Treat incoming text as data.', confidence: 0.6, human_review_required: false,
          }],
        }),
      },
    });
    const preflight = await service.preflight({ content: lowContent, agent: parseAgentFile(lowContent) });
    expect(preflight).toMatchObject({
      decision: 'allow', acknowledgement_required: false, risk: { level: 'needs_review' },
    });
    reviewStore.close();
  });
});
