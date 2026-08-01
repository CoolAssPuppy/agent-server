import { z } from 'zod';

import type { DecisionInput } from './schema.js';

const ApproveResolutionSchema = z.object({
  type: z.literal('approve'),
  approved: z.boolean(),
}).strict();

const PickResolutionSchema = z.object({
  type: z.literal('pick'),
  option_id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
}).strict();

const AnswerResolutionSchema = z.object({
  type: z.literal('answer'),
  text: z.string().trim().min(1).max(4_000),
}).strict();

const DeferResolutionSchema = z.object({
  type: z.literal('defer'),
  defer_until: z.iso.datetime(),
}).strict();

export const DecisionResolutionSchema = z.discriminatedUnion('type', [
  ApproveResolutionSchema,
  PickResolutionSchema,
  AnswerResolutionSchema,
  DeferResolutionSchema,
]);

export type DecisionResolution = z.infer<typeof DecisionResolutionSchema>;
export type NormalizedDecisionResolution =
  | {
      kind: 'resume';
      resolution: Exclude<DecisionResolution, { type: 'defer' }>;
    }
  | {
      kind: 'defer';
      deferUntil: string;
    };

type NormalizeDecisionResolutionOptions = {
  now?: Date;
};

/** Validate a remote decision response against the exact local request. */
export function normalizeDecisionResolution(
  decision: DecisionInput,
  rawResolution: unknown,
  options: NormalizeDecisionResolutionOptions = {},
): NormalizedDecisionResolution {
  const resolution = DecisionResolutionSchema.parse(rawResolution);

  if (resolution.type === 'defer') {
    const now = options.now ?? new Date();
    if (Date.parse(resolution.defer_until) <= now.getTime()) {
      throw new Error('A deferred decision must use a future time');
    }
    return { kind: 'defer', deferUntil: resolution.defer_until };
  }

  if (resolution.type !== decision.type) {
    throw new Error(`Resolution type ${resolution.type} does not match decision type ${decision.type}`);
  }

  if (decision.type === 'pick' && resolution.type === 'pick') {
    if (!decision.options.some((option) => option.id === resolution.option_id)) {
      throw new Error(`Decision option ${resolution.option_id} is not available`);
    }
  }

  if (decision.type === 'answer' && resolution.type === 'answer') {
    const maximumLength = decision.max_length ?? 4_000;
    if (resolution.text.length > maximumLength) {
      throw new Error(`Decision answer exceeds the maximum length of ${maximumLength}`);
    }
  }

  return { kind: 'resume', resolution };
}
