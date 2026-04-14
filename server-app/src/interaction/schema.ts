import { z } from 'zod';

const InteractionOptionSchema = z.object({
  label: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(500),
  description: z.string().max(300).optional(),
});

export const InteractionRequestSchema = z.object({
  message: z.string().trim().min(1).max(2_000),
  options: z.array(InteractionOptionSchema).max(20).optional(),
  freeText: z.boolean().default(false),
});

export type InteractionRequest = z.infer<typeof InteractionRequestSchema>;
export type InteractionOption = z.infer<typeof InteractionOptionSchema>;

export const InteractionConfigSchema = z.object({
  channel: z.string().trim().min(1).max(64),
  on_reply: z.string().trim().min(1).max(64),
  timeout: z.string().trim().max(16).default('30m'),
});

export type InteractionConfig = z.infer<typeof InteractionConfigSchema>;

export const NotificationConfigSchema = z.object({
  channel: z.string().trim().min(1).max(64),
  on_complete: z.boolean().default(true),
  on_failure: z.boolean().default(true),
});

export type NotificationConfig = z.infer<typeof NotificationConfigSchema>;

const SourceSchema = z.object({
  title: z.string().max(200),
  url: z.string(),
  kind: z.string().max(40),
});

const BaseDecisionFields = {
  title: z.string().min(1).max(120),
  body: z.string().max(2000).optional(),
  reasoning: z.string().max(1000).optional(),
  confidence: z.number().min(0).max(1).optional(),
  sources: z.array(SourceSchema).max(20).default([]),
  due_at: z.string().datetime().optional(),
};

export const ApproveDecisionSchema = z.object({
  type: z.literal('approve'),
  ...BaseDecisionFields,
  approve_label: z.string().max(30).optional(),
  decline_label: z.string().max(30).optional(),
  recommendation: z.enum(['approve', 'decline']).optional(),
});

export const PickDecisionSchema = z
  .object({
    type: z.literal('pick'),
    ...BaseDecisionFields,
    options: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
          label: z.string().min(1).max(30),
          description: z.string().max(200).optional(),
        }),
      )
      .min(2)
      .max(8)
      .refine(
        (opts) => new Set(opts.map((o) => o.id)).size === opts.length,
        'option ids must be unique',
      ),
    allow_none: z.boolean().optional(),
    recommended_option_id: z.string().optional(),
  })
  .refine(
    (d) => !d.recommended_option_id || d.options.some((o) => o.id === d.recommended_option_id),
    'recommended_option_id must match an option',
  );

export const AnswerDecisionSchema = z.object({
  type: z.literal('answer'),
  ...BaseDecisionFields,
  prompt: z.string().min(1).max(200),
  placeholder: z.string().max(60).optional(),
  suggested_answer: z.string().max(500).optional(),
  max_length: z.number().int().positive().max(4000).optional(),
});

export const DecisionSchema = z.discriminatedUnion('type', [
  ApproveDecisionSchema,
  PickDecisionSchema,
  AnswerDecisionSchema,
]);

export type DecisionInput = z.infer<typeof DecisionSchema>;
export type ApproveDecision = z.infer<typeof ApproveDecisionSchema>;
export type PickDecision = z.infer<typeof PickDecisionSchema>;
export type AnswerDecision = z.infer<typeof AnswerDecisionSchema>;
