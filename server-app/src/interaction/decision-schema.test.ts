import { describe, it, expect } from 'vitest';
import {
  ApproveDecisionSchema,
  PickDecisionSchema,
  AnswerDecisionSchema,
  DecisionSchema,
} from './schema.js';

describe('ApproveDecisionSchema', () => {
  it('accepts a minimal approve decision', () => {
    const result = ApproveDecisionSchema.safeParse({
      type: 'approve',
      title: 'Approve purchase?',
    });
    expect(result.success).toBe(true);
  });

  it('rejects titles longer than 120 chars', () => {
    const result = ApproveDecisionSchema.safeParse({
      type: 'approve',
      title: 'x'.repeat(121),
    });
    expect(result.success).toBe(false);
  });

  it('rejects approve_label longer than 30 chars', () => {
    const result = ApproveDecisionSchema.safeParse({
      type: 'approve',
      title: 'Okay?',
      approve_label: 'x'.repeat(31),
    });
    expect(result.success).toBe(false);
  });
});

describe('PickDecisionSchema', () => {
  it('accepts 2-8 options with unique ids', () => {
    const result = PickDecisionSchema.safeParse({
      type: 'pick',
      title: 'Pick one',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects fewer than 2 options', () => {
    const result = PickDecisionSchema.safeParse({
      type: 'pick',
      title: 'Pick',
      options: [{ id: 'a', label: 'A' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 8 options', () => {
    const result = PickDecisionSchema.safeParse({
      type: 'pick',
      title: 'Pick',
      options: Array.from({ length: 9 }, (_, i) => ({ id: `o${i}`, label: `O${i}` })),
    });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate option ids', () => {
    const result = PickDecisionSchema.safeParse({
      type: 'pick',
      title: 'Pick',
      options: [
        { id: 'a', label: 'A' },
        { id: 'a', label: 'B' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects option ids with invalid characters', () => {
    const result = PickDecisionSchema.safeParse({
      type: 'pick',
      title: 'Pick',
      options: [
        { id: 'A', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects recommended_option_id that does not match any option', () => {
    const result = PickDecisionSchema.safeParse({
      type: 'pick',
      title: 'Pick',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      recommended_option_id: 'c',
    });
    expect(result.success).toBe(false);
  });
});

describe('AnswerDecisionSchema', () => {
  it('accepts a minimal answer decision', () => {
    const result = AnswerDecisionSchema.safeParse({
      type: 'answer',
      title: 'Question',
      prompt: 'What?',
    });
    expect(result.success).toBe(true);
  });

  it('rejects prompt longer than 200 chars', () => {
    const result = AnswerDecisionSchema.safeParse({
      type: 'answer',
      title: 'Q',
      prompt: 'x'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it('rejects max_length above 4000', () => {
    const result = AnswerDecisionSchema.safeParse({
      type: 'answer',
      title: 'Q',
      prompt: 'What?',
      max_length: 4001,
    });
    expect(result.success).toBe(false);
  });
});

describe('DecisionSchema discriminated union', () => {
  it('discriminates on type=approve', () => {
    const r = DecisionSchema.safeParse({ type: 'approve', title: 'ok?' });
    expect(r.success).toBe(true);
  });

  it('discriminates on type=pick', () => {
    const r = DecisionSchema.safeParse({
      type: 'pick',
      title: 'p',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown type', () => {
    const r = DecisionSchema.safeParse({ type: 'other', title: 'x' });
    expect(r.success).toBe(false);
  });
});
