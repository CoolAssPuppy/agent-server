import { z } from 'zod';
import { sanitizeText } from '../server/security-utils.js';
import { FileAccessSchema } from '../agents/config.js';
import { NativeServicesSchema } from '../agents/native-services.js';

export const RiskSeveritySchema = z.enum(['low', 'needs_review', 'high', 'critical']);
export type RiskSeverity = z.infer<typeof RiskSeveritySchema>;

export const EvidenceSchema = z.object({
  code: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(160),
  detail: z.string().trim().min(1).max(1_000).transform((value) => sanitizeText(value, 1_000)),
  source: z.enum(['configuration', 'run', 'runtime', 'connection', 'filesystem', 'model']),
}).strict();
export type Evidence = z.infer<typeof EvidenceSchema>;

export const RecommendedActionSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(1_000),
  kind: z.enum(['configuration_patch', 'connect', 'choose_path', 'retry', 'manual']),
  risk: RiskSeveritySchema,
  requires_confirmation: z.boolean(),
  affects_functionality: z.boolean(),
}).strict();
export type RecommendedAction = z.infer<typeof RecommendedActionSchema>;

export const FindingSchema = z.object({
  id: z.string().trim().min(1).max(160),
  rule_id: z.string().trim().min(1).max(160),
  severity: RiskSeveritySchema,
  title: z.string().trim().min(1).max(180),
  explanation: z.string().trim().min(1).max(1_500),
  potential_impact: z.string().trim().min(1).max(1_500),
  trigger: z.string().trim().min(1).max(1_500),
  evidence: z.array(EvidenceSchema).min(1).max(10),
  recommendation: RecommendedActionSchema,
  can_ignore: z.boolean(),
  model_generated: z.boolean(),
  confidence: z.number().min(0).max(1),
}).strict();
export type Finding = z.infer<typeof FindingSchema>;

export const RiskSummarySchema = z.object({
  level: RiskSeveritySchema,
  reasons: z.array(z.string().trim().min(1).max(500)).max(12),
  finding_count: z.number().int().nonnegative(),
}).strict();
export type RiskSummary = z.infer<typeof RiskSummarySchema>;

const TriggerProposalSchema = z.object({
  type: z.enum(['manual', 'schedule', 'watch', 'message', 'chained']),
  schedule: z.string().trim().min(1).max(120).optional(),
  watched_path: z.string().trim().min(1).max(1_024).optional(),
  human_description: z.string().trim().min(1).max(500),
}).strict();

const RequirementSchema = z.object({
  id: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(160),
  required: z.boolean(),
  status: z.enum(['connected', 'needs_setup', 'optional', 'unavailable']),
  reason: z.string().trim().min(1).max(500),
}).strict();

const FileAccessProposalSchema = FileAccessSchema.extend({
  kind: z.enum(['file', 'folder']).default('folder'),
  is_suggestion: z.boolean(),
  reason: z.string().trim().min(1).max(500),
}).strict();

const CalendarAccessProposalSchema = z.object({
  id: z.string().trim().min(1).max(512),
  name: z.string().trim().min(1).max(160),
  access: z.enum(['read_only', 'read_write']),
  reason: z.string().trim().min(1).max(500),
}).strict();

const ProposalQuestionSchema = z.object({
  id: z.string().trim().min(1).max(120),
  question: z.string().trim().min(1).max(500),
  control: z.enum(['text', 'single_choice', 'schedule', 'path', 'permission', 'service']),
  required: z.boolean(),
  choices: z.array(z.object({
    label: z.string().trim().min(1).max(160),
    value: z.string().trim().min(1).max(300),
  }).strict()).max(12).optional(),
}).strict();

export const AgentProposalSchema = z.object({
  schema_version: z.literal(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  instructions: z.string().trim().min(1).max(40_000),
  explanation: z.string().trim().min(1).max(2_000),
  trigger: TriggerProposalSchema,
  timezone: z.string().trim().min(1).max(120),
  capabilities: z.array(RequirementSchema).max(64),
  connections: z.array(RequirementSchema).max(64),
  file_access: z.array(FileAccessProposalSchema).max(32),
  calendar_access: z.array(CalendarAccessProposalSchema).max(128).default([]),
  native_services: NativeServicesSchema.default({}),
  permissions: z.object({
    can_modify_files: z.boolean(),
    can_run_commands: z.boolean(),
    requires_network: z.boolean(),
    can_use_connected_apps: z.boolean(),
    can_send_messages: z.boolean(),
  }).strict(),
  notification_destination: z.object({
    kind: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1).max(160),
    configured: z.boolean(),
  }).strict().nullable(),
  runtime: z.object({
    executor: z.enum(['claude-code', 'codex']),
    model: z.string().trim().min(1).max(120).nullable(),
    reason: z.string().trim().min(1).max(500),
  }).strict().nullable(),
  risk: RiskSummarySchema,
  missing_information: z.array(z.string().trim().min(1).max(500)).max(20),
  questions: z.array(ProposalQuestionSchema).max(12),
  markdown_instructions: z.string().trim().min(1).max(40_000),
}).strict();
export type AgentProposal = z.infer<typeof AgentProposalSchema>;

export const DiagnosticResultSchema = z.object({
  schema_version: z.literal(1),
  run_id: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(1_000),
  most_likely_cause: z.string().trim().min(1).max(1_500),
  confidence: z.number().min(0).max(1),
  evidence: z.array(EvidenceSchema).min(1).max(12),
  suggested_fix: RecommendedActionSchema,
  affected_settings: z.array(z.string().trim().min(1).max(200)).max(20),
  risk: RiskSeveritySchema,
  can_automate: z.boolean(),
  rerun_safety: z.enum(['safe', 'confirm', 'unsafe']),
  alternatives: z.array(z.string().trim().min(1).max(700)).max(8),
  next_step: z.string().trim().min(1).max(1_000),
  source: z.enum(['deterministic', 'heuristic', 'model', 'combined']),
}).strict();
export type DiagnosticResult = z.infer<typeof DiagnosticResultSchema>;

const ContentHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const severityOrder: Record<RiskSeverity, number> = {
  low: 0,
  needs_review: 1,
  high: 2,
  critical: 3,
};

function validateRiskConsistency(
  value: { risk: RiskSummary; findings: Finding[] },
  ctx: z.RefinementCtx,
): void {
  const maximum = value.findings.reduce<RiskSeverity>((current, finding) => (
    severityOrder[finding.severity] > severityOrder[current] ? finding.severity : current
  ), 'low');
  if (value.risk.finding_count !== value.findings.length) {
    ctx.addIssue({ code: 'custom', path: ['risk', 'finding_count'], message: 'Finding count is inconsistent' });
  }
  if (value.risk.level !== maximum) {
    ctx.addIssue({ code: 'custom', path: ['risk', 'level'], message: 'Risk level understates the findings' });
  }
}

export const SecurityAnalysisSchema = z.object({
  schema_version: z.literal(1),
  agent_id: z.string().trim().min(1).max(160),
  content_hash: ContentHashSchema,
  analyzer_version: z.string().trim().min(1).max(40),
  analyzed_at: z.string().datetime(),
  risk: RiskSummarySchema,
  findings: z.array(FindingSchema).max(200),
  is_stale: z.boolean(),
  model_status: z.enum(['not_needed', 'completed', 'unavailable', 'invalid', 'timed_out']),
}).strict().superRefine(validateRiskConsistency);
export type SecurityAnalysis = z.infer<typeof SecurityAnalysisSchema>;

export const SecurityReviewStateSchema = z.object({
  reviewed_at: z.string().datetime().nullable(),
  is_reviewed: z.boolean(),
  is_stale: z.boolean(),
  acknowledged_finding_ids: z.array(z.string().trim().min(1).max(200)).max(500),
  analyzer_version: z.string().trim().min(1).max(40),
  content_hash: ContentHashSchema,
}).strict().superRefine((value, ctx) => {
  if (value.is_reviewed && (value.is_stale || value.reviewed_at === null)) {
    ctx.addIssue({ code: 'custom', path: ['is_reviewed'], message: 'A current review needs a review date' });
  }
});
export type SecurityReviewState = z.infer<typeof SecurityReviewStateSchema>;

export const PreflightResultSchema = z.object({
  schema_version: z.literal(1),
  agent_id: z.string().trim().min(1).max(160),
  content_hash: ContentHashSchema,
  analyzer_version: z.string().trim().min(1).max(40),
  decision: z.enum(['allow', 'confirm', 'block']),
  risk: RiskSummarySchema,
  findings: z.array(FindingSchema).max(200),
  acknowledgement_required: z.boolean(),
}).strict().superRefine((value, ctx) => {
  validateRiskConsistency(value, ctx);
  if (value.risk.level === 'critical' && value.decision !== 'block') {
    ctx.addIssue({ code: 'custom', path: ['decision'], message: 'Critical risk must block execution' });
  }
  if (value.decision !== 'allow' && !value.acknowledgement_required) {
    ctx.addIssue({ code: 'custom', path: ['acknowledgement_required'], message: 'Risk acknowledgement is required' });
  }
});
export type PreflightResult = z.infer<typeof PreflightResultSchema>;
