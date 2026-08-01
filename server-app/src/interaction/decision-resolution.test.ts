import { describe, expect, it } from 'vitest';

import type { DecisionInput } from './schema.js';
import { normalizeDecisionResolution } from './decision-resolution.js';

const now = new Date('2026-08-01T09:00:00.000Z');

describe('normalizeDecisionResolution', () => {
  it('normalizes explicit approve and decline responses', () => {
    const decision: DecisionInput = { type: 'approve', title: 'Publish?', sources: [] };

    expect(normalizeDecisionResolution(decision, { type: 'approve', approved: true }, { now }))
      .toEqual({ kind: 'resume', resolution: { type: 'approve', approved: true } });
    expect(normalizeDecisionResolution(decision, { type: 'approve', approved: false }, { now }))
      .toEqual({ kind: 'resume', resolution: { type: 'approve', approved: false } });
  });

  it('accepts only a stable option from the matching pick decision', () => {
    const decision: DecisionInput = {
      type: 'pick',
      title: 'Choose a report',
      sources: [],
      options: [
        { id: 'short', label: 'Short' },
        { id: 'detailed', label: 'Detailed' },
      ],
    };

    expect(normalizeDecisionResolution(
      decision,
      { type: 'pick', option_id: 'detailed' },
      { now },
    )).toEqual({
      kind: 'resume',
      resolution: { type: 'pick', option_id: 'detailed' },
    });
    expect(() => normalizeDecisionResolution(
      decision,
      { type: 'pick', option_id: 'unknown' },
      { now },
    )).toThrow('not available');
  });

  it('requires a nonblank answer within the decision limit', () => {
    const decision: DecisionInput = {
      type: 'answer',
      title: 'Name the report',
      prompt: 'What name should be used?',
      max_length: 8,
      sources: [],
    };

    expect(normalizeDecisionResolution(
      decision,
      { type: 'answer', text: '  August  ' },
      { now },
    )).toEqual({
      kind: 'resume',
      resolution: { type: 'answer', text: 'August' },
    });
    expect(() => normalizeDecisionResolution(decision, { type: 'answer', text: '   ' }, { now }))
      .toThrow();
    expect(() => normalizeDecisionResolution(decision, { type: 'answer', text: 'Too long!' }, { now }))
      .toThrow('maximum length');
  });

  it('returns a future defer outcome without creating a resumption resolution', () => {
    const decision: DecisionInput = { type: 'approve', title: 'Publish?', sources: [] };

    expect(normalizeDecisionResolution(
      decision,
      { type: 'defer', defer_until: '2026-08-01T10:00:00.000Z' },
      { now },
    )).toEqual({
      kind: 'defer',
      deferUntil: '2026-08-01T10:00:00.000Z',
    });
    expect(() => normalizeDecisionResolution(
      decision,
      { type: 'defer', defer_until: now.toISOString() },
      { now },
    )).toThrow('future');
  });

  it('rejects mismatched, legacy, null-option, and extra-field payloads', () => {
    const approve: DecisionInput = { type: 'approve', title: 'Publish?', sources: [] };
    const pick: DecisionInput = {
      type: 'pick',
      title: 'Choose',
      sources: [],
      options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      allow_none: true,
    };

    expect(() => normalizeDecisionResolution(approve, { type: 'answer', text: 'yes' }, { now }))
      .toThrow('does not match');
    expect(() => normalizeDecisionResolution(approve, { action_id: 'approve' }, { now }))
      .toThrow();
    expect(() => normalizeDecisionResolution(pick, { type: 'pick', option_id: null }, { now }))
      .toThrow();
    expect(() => normalizeDecisionResolution(
      approve,
      { type: 'approve', approved: true, input: 'unexpected' },
      { now },
    )).toThrow();
  });
});
