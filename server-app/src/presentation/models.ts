import { z } from 'zod';

const EvidenceReferenceSchema = z.string().trim().min(1).max(240);

export const PresentationStatementSchema = z.object({
  text: z.string().trim().min(1).max(8_000),
  evidenceReferences: z.array(EvidenceReferenceSchema).min(1),
}).strict();

export const HumanTimelineEntrySchema = z.object({
  kind: z.enum([
    'started',
    'connected',
    'read',
    'changed',
    'produced',
    'waiting',
    'resumed',
    'problem',
    'finished',
  ]),
  label: PresentationStatementSchema,
  occurredAt: z.iso.datetime().optional(),
}).strict();

export const RunReviewSchema = z.object({
  outcome: z.enum([
    'succeeded',
    'partial',
    'failed',
    'canceled',
    'skipped',
    'waiting',
    'unknown',
  ]),
  headline: PresentationStatementSchema,
  summary: PresentationStatementSchema,
  accomplishments: z.array(PresentationStatementSchema),
  changes: z.array(PresentationStatementSchema),
  outputs: z.array(PresentationStatementSchema),
  problems: z.array(PresentationStatementSchema),
  suggestions: z.array(PresentationStatementSchema),
  timeline: z.array(HumanTimelineEntrySchema),
  operationalCompleteness: z.enum(['complete', 'incomplete', 'not_assessed']),
  technicalDetailsReference: z.string().regex(/^\/runs\/[A-Za-z0-9._~-]+$/),
}).strict();

export type PresentationStatement = z.infer<typeof PresentationStatementSchema>;
export type HumanTimelineEntry = z.infer<typeof HumanTimelineEntrySchema>;
export type RunReview = z.infer<typeof RunReviewSchema>;
