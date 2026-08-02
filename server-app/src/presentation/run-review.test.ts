import { describe, expect, it } from 'vitest';
import type { PendingInteraction } from '../interaction/store.js';
import { makeStoredRun } from '../test-factories.js';
import { createRunReview } from './run-review.js';

describe('consumer run review', () => {
  it('describes a completed run from observed evidence without exposing tool names', () => {
    const review = createRunReview({
      run: makeStoredRun({
        status: 'completed',
        summary: 'Published the weekly update.',
        startedAt: new Date('2026-08-01T09:00:00.000Z'),
        completedAt: new Date('2026-08-01T09:02:00.000Z'),
        filesRead: ['/Users/person/Documents/notes.md'],
        filesWritten: ['/Users/person/Documents/weekly-update.md'],
        toolsUsed: ['mcp__notion__create_page'],
      }),
      requiredOutput: { label: 'Weekly update' },
    });

    expect(review).toMatchObject({
      outcome: 'succeeded',
      headline: {
        text: 'Test Agent finished',
        evidenceReferences: ['run.status'],
      },
      summary: {
        text: 'Published the weekly update.',
        evidenceReferences: ['run.summary'],
      },
      operationalCompleteness: 'complete',
      technicalDetailsReference: '/runs/run-1',
    });
    expect(review.changes).toEqual([{
      text: 'Updated weekly-update.md',
      evidenceReferences: ['run.filesWritten[0]'],
    }]);
    expect(review.outputs).toEqual([{
      text: 'Weekly update is ready',
      evidenceReferences: ['agent.output.primary', 'run.status'],
    }]);
    expect(review.timeline.map((entry) => entry.label.text)).toEqual([
      'Started',
      'Read notes.md',
      'Updated weekly-update.md',
      'Used a configured tool',
      'Finished',
    ]);
    expect(JSON.stringify(review)).not.toContain('mcp__notion__create_page');
    expect(JSON.stringify(review)).not.toContain('/Users/person');
  });

  it('explains deterministic incomplete, skipped, canceled, and running outcomes', () => {
    const incomplete = createRunReview({
      run: makeStoredRun({
        status: 'failed',
        code: 'output_contract_unmet',
        error: 'Required output missing',
      }),
      requiredOutput: { label: 'Report' },
    });
    const locked = createRunReview({
      run: makeStoredRun({ status: 'skipped', code: 'lock_contention' }),
    });
    const alreadyDone = createRunReview({
      run: makeStoredRun({ status: 'skipped', code: 'already_completed_today' }),
    });
    const canceled = createRunReview({
      run: makeStoredRun({ status: 'failed', code: 'user_canceled' }),
    });
    const running = createRunReview({
      run: makeStoredRun({ status: 'running', completedAt: undefined }),
    });

    expect(incomplete).toMatchObject({
      outcome: 'partial',
      operationalCompleteness: 'incomplete',
      problems: [{
        text: 'The required Report was not produced.',
        evidenceReferences: ['run.code', 'agent.output.primary'],
      }],
    });
    expect(locked).toMatchObject({
      outcome: 'skipped',
      summary: {
        text: 'Another run was already in progress. Nothing changed.',
        evidenceReferences: ['run.code'],
      },
    });
    expect(alreadyDone).toMatchObject({
      outcome: 'skipped',
      summary: {
        text: 'This assistant had already finished today. Nothing changed.',
        evidenceReferences: ['run.code'],
      },
    });
    expect(canceled).toMatchObject({
      outcome: 'canceled',
      summary: {
        text: 'The run was canceled. No further work was allowed.',
        evidenceReferences: ['run.code'],
      },
    });
    expect(canceled.timeline.at(-1)).toMatchObject({
      kind: 'finished',
      label: {
        text: 'Canceled',
        evidenceReferences: ['run.code'],
      },
    });
    expect(running).toMatchObject({
      outcome: 'working',
      headline: {
        text: 'Test Agent is working',
        evidenceReferences: ['run.status'],
      },
    });
  });

  it('keeps unclassified failures human and preserves technical evidence by reference', () => {
    const review = createRunReview({
      run: makeStoredRun({
        status: 'failed',
        error: 'spawn codex ENOENT at /secret/runtime/path',
        toolsUsed: ['Bash'],
      }),
    });

    expect(review.outcome).toBe('failed');
    expect(review.summary).toEqual({
      text: 'The AI engine could not start. Check that it is installed and signed in.',
      evidenceReferences: ['run.error'],
    });
    expect(review.problems).toEqual([{
      text: 'The AI engine is unavailable.',
      evidenceReferences: ['run.error'],
    }]);
    expect(review.suggestions).toEqual([{
      text: 'Open Connections to check the AI engine.',
      evidenceReferences: ['run.error'],
    }]);
    expect(JSON.stringify(review)).not.toContain('/secret/runtime/path');
    expect(review.technicalDetailsReference).toBe('/runs/run-1');
  });

  it('does not claim operational completeness without a deterministic contract', () => {
    const review = createRunReview({
      run: makeStoredRun({ status: 'completed', summary: undefined }),
    });

    expect(review.operationalCompleteness).toBe('not_assessed');
    expect(review.summary).toEqual({
      text: 'The run finished, but it did not provide a summary.',
      evidenceReferences: ['run.status', 'run.summary'],
    });
  });

  it('does not invent timestamps for intermediate evidence', () => {
    const review = createRunReview({
      run: makeStoredRun({
        status: 'completed',
        completedAt: new Date('2026-08-01T09:02:00.000Z'),
        filesRead: ['/tmp/source.md'],
        filesWritten: ['/tmp/result.md'],
        toolsUsed: ['Read'],
      }),
    });

    expect(review.timeline.slice(1, -1)).toEqual([
      expect.not.objectContaining({ occurredAt: expect.anything() }),
      expect.not.objectContaining({ occurredAt: expect.anything() }),
      expect.not.objectContaining({ occurredAt: expect.anything() }),
    ]);
  });

  it('preserves explicit evidence-backed accomplishments without deriving new claims', () => {
    const accomplishment = {
      text: 'Published the approved weekly report.',
      evidenceReferences: ['run.summary', 'agent.output.primary'],
    };

    const withEvidence = createRunReview({
      run: makeStoredRun({ status: 'completed' }),
      observedAccomplishments: [accomplishment],
    });
    const withoutEvidence = createRunReview({
      run: makeStoredRun({
        status: 'completed',
        filesWritten: ['/tmp/report.md'],
        toolsUsed: ['mcp__notion__create_page'],
      }),
    });

    expect(withEvidence.accomplishments).toEqual([accomplishment]);
    expect(withoutEvidence.accomplishments).toEqual([]);
  });

  it('shows a waiting request, reason, action, and expiry only from a current matching interaction', () => {
    const run = makeStoredRun({ status: 'running', completedAt: undefined });
    const interaction = makePendingInteraction({ runId: run.runId });

    const review = createRunReview({
      run,
      pendingInteraction: interaction,
      now: new Date('2026-08-02T09:30:00.000Z'),
    });

    expect(review).toMatchObject({
      outcome: 'waiting',
      headline: {
        text: 'Test Agent is waiting for your response',
        evidenceReferences: ['interaction.status', 'interaction.request'],
      },
      waiting: {
        waitingFor: {
          text: 'Choose which report to publish.',
          evidenceReferences: ['interaction.request.message'],
        },
        reason: {
          text: 'The assistant needs your response before it can continue.',
          evidenceReferences: ['interaction.status', 'interaction.runId'],
        },
        userAction: {
          kind: 'respond',
          label: 'Choose',
          targetReference: 'interaction:interaction-1',
        },
        expiresAt: '2026-08-02T10:30:00.000Z',
      },
    });
    expect(review.timeline.at(-1)).toMatchObject({
      kind: 'waiting',
      label: {
        text: 'Waiting for your response',
        evidenceReferences: ['interaction.status', 'interaction.request'],
      },
    });
  });

  it('does not claim a run is waiting from expired, resolved, or unrelated interaction evidence', () => {
    const run = makeStoredRun({ status: 'running', completedAt: undefined });
    const now = new Date('2026-08-02T11:00:00.000Z');

    const reviews = [
      createRunReview({ run, pendingInteraction: makePendingInteraction(), now }),
      createRunReview({
        run,
        pendingInteraction: makePendingInteraction({ status: 'acted' }),
        now: new Date('2026-08-02T09:30:00.000Z'),
      }),
      createRunReview({
        run,
        pendingInteraction: makePendingInteraction({ runId: 'another-run' }),
        now: new Date('2026-08-02T09:30:00.000Z'),
      }),
    ];

    expect(reviews.map((review) => review.outcome)).toEqual([
      'working',
      'working',
      'working',
    ]);
    expect(reviews.every((review) => review.waiting === undefined)).toBe(true);
  });
});

function makePendingInteraction(
  overrides: Partial<PendingInteraction> = {},
): PendingInteraction {
  return {
    id: 'interaction-1',
    runId: 'run-1',
    agentId: 'test-agent',
    replyAgentId: 'reply-agent',
    request: {
      message: 'Choose which report to publish.',
      options: [
        { label: 'Weekly report', value: 'weekly' },
        { label: 'Monthly report', value: 'monthly' },
      ],
      freeText: false,
    },
    channel: 'console',
    createdAt: new Date('2026-08-02T09:00:00.000Z'),
    expiresAt: new Date('2026-08-02T10:30:00.000Z'),
    status: 'pending',
    ...overrides,
  };
}
