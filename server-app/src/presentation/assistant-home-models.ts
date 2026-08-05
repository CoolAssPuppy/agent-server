import { z } from 'zod';
import type { AgentConfig } from '../agents/config.js';
import type { PendingInteraction } from '../interaction/store.js';
import type { StoredRun } from '../reporting/store.js';
import {
  AssistantPresentationIdentitySchema,
  PresentationStatementSchema,
  RunReviewSchema,
} from './models.js';

const EvidenceReferenceSchema = z.string().trim().min(1).max(1_024);

export const AssistantHomeActionSchema = z.object({
  kind: z.enum([
    'resolve_attention', 'view_activity', 'run', 'safe_test', 'pause', 'edit', 'advanced',
  ]),
  label: z.string().trim().min(1).max(80),
  targetReference: z.string().trim().min(1).max(320),
}).strict();

export const AssistantHealthSchema = z.object({
  state: z.enum(['healthy', 'working', 'needs_attention', 'paused']),
  summary: PresentationStatementSchema,
  reasonReferences: z.array(EvidenceReferenceSchema),
}).strict();

export const ReadinessCheckSchema = z.object({
  kind: z.enum([
    'engine', 'connection', 'file', 'destination', 'permission',
    'schedule', 'server', 'mcp', 'safety',
  ]),
  state: z.enum(['pass', 'action_required', 'fail', 'unknown']),
  explanation: PresentationStatementSchema,
  action: AssistantHomeActionSchema.optional(),
  evidenceSource: EvidenceReferenceSchema,
}).strict();

export const ReadinessPresentationSchema = z.object({
  state: z.enum(['ready', 'needs_setup', 'blocked', 'checking', 'unavailable']),
  summary: PresentationStatementSchema,
  checks: z.array(ReadinessCheckSchema).min(1),
}).strict();

export const PermissionStatementSchema = z.object({
  effect: z.enum(['can', 'must_ask', 'cannot']),
  action: z.enum(['read', 'edit', 'execute', 'send', 'publish', 'delete', 'connect']),
  targetLabel: z.string().trim().min(1).max(1_024),
  exactScopeReference: z.string().trim().min(1).max(1_024),
  sourceRuleReference: EvidenceReferenceSchema,
}).strict();

export const AssistantScheduleSchema = z.object({
  kind: z.enum(['scheduled', 'watching', 'on_demand']),
  summary: PresentationStatementSchema,
  nextRunAt: z.iso.datetime().optional(),
}).strict();

export const AssistantConnectionSchema = z.object({
  id: z.string().trim().min(1).max(320),
  label: z.string().trim().min(1).max(200),
  state: z.enum(['ready', 'needs_setup', 'unavailable', 'unknown']),
  explanation: PresentationStatementSchema,
}).strict();

export const RecentOutcomeSchema = z.object({
  runId: z.string().trim().min(1).max(320),
  outcome: RunReviewSchema.shape.outcome,
  headline: PresentationStatementSchema,
  occurredAt: z.iso.datetime(),
  reviewReference: z.string().regex(/^\/runs\/[A-Za-z0-9._~-]+\/review$/),
}).strict();

export const AssistantAttentionSchema = z.object({
  summary: PresentationStatementSchema,
  action: AssistantHomeActionSchema,
  expiresAt: z.iso.datetime().optional(),
}).strict();

export const AssistantAdvancedPermissionRulesSchema = z.object({
  allow: z.array(z.string().trim().min(1).max(1_024)).max(128),
  deny: z.array(z.string().trim().min(1).max(1_024)).max(128),
}).strict();

export const AssistantHomeAdvancedSchema = z.object({
  scheduleExpression: z.string().trim().min(1).max(120).optional(),
  executor: z.enum(['claude-code', 'codex', 'kimi-code']),
  model: z.string().trim().min(1).max(120).optional(),
  permissionMode: z.enum([
    'default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk',
  ]).optional(),
  permissionRules: AssistantAdvancedPermissionRulesSchema,
  connectionIds: z.array(AssistantConnectionSchema.shape.id).max(64),
}).strict();

export const AssistantHomePresentationSchema = z.object({
  assistant: AssistantPresentationIdentitySchema,
  purpose: PresentationStatementSchema,
  health: AssistantHealthSchema,
  readiness: ReadinessPresentationSchema,
  schedule: AssistantScheduleSchema,
  permissions: z.array(PermissionStatementSchema),
  connections: z.array(AssistantConnectionSchema),
  destination: PresentationStatementSchema.optional(),
  recentOutcomes: z.array(RecentOutcomeSchema),
  attention: AssistantAttentionSchema.optional(),
  advanced: AssistantHomeAdvancedSchema,
  primaryAction: AssistantHomeActionSchema,
  secondaryActions: z.array(AssistantHomeActionSchema),
  advancedReference: z.string().regex(/^\/agents\/[a-z0-9][a-z0-9_-]{0,63}$/),
}).strict();

export type AssistantHomeAction = z.infer<typeof AssistantHomeActionSchema>;
export type AssistantHealth = z.infer<typeof AssistantHealthSchema>;
export type ReadinessCheck = z.infer<typeof ReadinessCheckSchema>;
export type ReadinessPresentation = z.infer<typeof ReadinessPresentationSchema>;
export type PermissionStatement = z.infer<typeof PermissionStatementSchema>;
export type AssistantSchedule = z.infer<typeof AssistantScheduleSchema>;
export type AssistantAttention = z.infer<typeof AssistantAttentionSchema>;
export type AssistantHomeAdvanced = z.infer<typeof AssistantHomeAdvancedSchema>;
export type RecentOutcome = z.infer<typeof RecentOutcomeSchema>;
export type AssistantHomePresentation = z.infer<typeof AssistantHomePresentationSchema>;

export type AssistantPathFact = {
  path: string;
  exists: boolean;
  readable: boolean;
  writable: boolean;
  /**
   * False when the operating system refused the check rather than answering
   * it. A refusal says nothing about the path, so it cannot be reported as
   * missing. Absent means the inspection was answered.
   */
  inspectable?: boolean;
};

export type AssistantConnectionFact = {
  id: string;
  label: string;
  status: 'ready' | 'needs_setup' | 'unavailable' | 'unknown';
  sourceReference: string;
};

export type AssistantHomeFacts = {
  engine: {
    runtimeAvailable: boolean;
    authentication: 'verified' | 'unknown' | 'unavailable';
  };
  paths: readonly AssistantPathFact[];
  connections: readonly AssistantConnectionFact[];
  destination?: { configured: boolean; verified: boolean | 'unknown' };
  canEnforceSafeTest: boolean;
};

export type AssistantHomeInput = {
  machineId: string;
  agent: AgentConfig;
  runs: readonly StoredRun[];
  pendingInteractions: readonly PendingInteraction[];
  now: Date;
  facts: AssistantHomeFacts;
};
