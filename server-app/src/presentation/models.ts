import { z } from 'zod';

const EvidenceReferenceSchema = z.string().trim().min(1).max(240);

export const PresentationStatementSchema = z.object({
  text: z.string().trim().min(1).max(8_000),
  evidenceReferences: z.array(EvidenceReferenceSchema).min(1),
}).strict();

export const AssistantPresentationIdentitySchema = z.object({
  installationId: z.string().trim().min(1).max(320),
  machineId: z.uuid(),
  localAgentId: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(200),
}).strict();

export const PresentationActionSchema = z.object({
  kind: z.enum(['respond', 'view_activity', 'review', 'view_assistant']),
  label: z.string().trim().min(1).max(80),
  targetReference: z.string().trim().min(1).max(320),
}).strict();

export const TodayItemSchema = z.object({
  id: z.string().trim().min(1).max(320),
  section: z.enum(['needs_you', 'working', 'finished', 'problems', 'upcoming']),
  assistant: AssistantPresentationIdentitySchema,
  headline: PresentationStatementSchema,
  explanation: PresentationStatementSchema,
  occurredAt: z.iso.datetime().optional(),
  scheduledAt: z.iso.datetime().optional(),
  expiresAt: z.iso.datetime().optional(),
  primaryAction: PresentationActionSchema,
  secondaryDisclosure: PresentationActionSchema.optional(),
  sourceReferences: z.array(EvidenceReferenceSchema).min(1),
}).strict();

export const TodaySectionSchema = z.object({
  kind: z.enum(['needs_you', 'working', 'finished', 'problems', 'upcoming']),
  items: z.array(TodayItemSchema).min(1),
}).strict();

export const TodayPresentationSchema = z.object({
  sections: z.array(TodaySectionSchema),
  allClear: PresentationStatementSchema.optional(),
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

export const RunReviewWaitingSchema = z.object({
  waitingFor: PresentationStatementSchema,
  reason: PresentationStatementSchema,
  userAction: PresentationActionSchema.optional(),
  expiresAt: z.iso.datetime().optional(),
}).strict();

export const RunReviewSchema = z.object({
  outcome: z.enum([
    'succeeded',
    'partial',
    'failed',
    'canceled',
    'skipped',
    'working',
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
  waiting: RunReviewWaitingSchema.optional(),
  technicalDetailsReference: z.string().regex(/^\/runs\/[A-Za-z0-9._~-]+$/),
}).strict();

export const ActivityItemSchema = z.object({
  id: z.string().trim().min(1).max(320),
  assistant: AssistantPresentationIdentitySchema,
  conversationId: z.string().trim().min(1).max(320).optional(),
  state: z.enum(['needs_you', 'working', 'finished', 'problem']),
  headline: PresentationStatementSchema,
  outcomeSummary: PresentationStatementSchema.optional(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
  primaryOutput: PresentationStatementSchema.optional(),
  reviewReference: z.string().regex(/^\/runs\/[A-Za-z0-9._~-]+\/review$/),
  sourceReferences: z.array(EvidenceReferenceSchema).min(1),
}).strict();

export const ActivityPresentationSchema = z.object({
  items: z.array(ActivityItemSchema),
}).strict();

export type PresentationStatement = z.infer<typeof PresentationStatementSchema>;
export type AssistantPresentationIdentity = z.infer<typeof AssistantPresentationIdentitySchema>;
export type PresentationAction = z.infer<typeof PresentationActionSchema>;
export type TodayItem = z.infer<typeof TodayItemSchema>;
export type TodaySection = z.infer<typeof TodaySectionSchema>;
export type TodayPresentation = z.infer<typeof TodayPresentationSchema>;
export type HumanTimelineEntry = z.infer<typeof HumanTimelineEntrySchema>;
export type RunReviewWaiting = z.infer<typeof RunReviewWaitingSchema>;
export type RunReview = z.infer<typeof RunReviewSchema>;
export type ActivityItem = z.infer<typeof ActivityItemSchema>;
export type ActivityPresentation = z.infer<typeof ActivityPresentationSchema>;
