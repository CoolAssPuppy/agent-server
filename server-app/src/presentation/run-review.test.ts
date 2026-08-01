import { describe, expect, it } from 'vitest';
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
      outcome: 'waiting',
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
});
