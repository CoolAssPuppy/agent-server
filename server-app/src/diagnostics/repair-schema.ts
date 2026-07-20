import { z } from 'zod';
import { RiskSeveritySchema } from '../analysis/models.js';
import { CalendarAccessSchema, FileAccessSchema, NativeServicesSchema } from '../agents/config.js';
import { isUnsafeAutomatedFilePath } from '../analysis/patch.js';
import { EXECUTOR_NAMES } from '../agents/executor.js';

const RepairOperationSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('schedule'), value: z.string().trim().min(1).max(120) }).strict(),
  z.object({ field: z.literal('working_directory'), value: z.string().trim().min(1).max(1_024) }).strict(),
  z.object({ field: z.literal('file_access'), value: z.array(FileAccessSchema).max(32) }).strict(),
  z.object({ field: z.literal('calendar_access'), value: z.array(CalendarAccessSchema).max(128) }).strict(),
  z.object({ field: z.literal('native_services'), value: NativeServicesSchema }).strict(),
  z.object({ field: z.literal('executor'), value: z.enum(EXECUTOR_NAMES) }).strict(),
  z.object({ field: z.literal('model'), value: z.string().trim().min(1).max(120) }).strict(),
  z.object({ field: z.literal('codex_sandbox'), value: z.enum(['read-only', 'workspace-write', 'danger-full-access']) }).strict(),
  z.object({ field: z.literal('permission_mode'), value: z.enum(['default', 'acceptEdits', 'dontAsk', 'plan', 'bypassPermissions']) }).strict(),
  z.object({ field: z.literal('network'), value: z.boolean() }).strict(),
  z.object({ field: z.literal('tools'), value: z.array(z.string().trim().min(1).max(120)).max(128) }).strict(),
  z.object({
    field: z.literal('permissions'),
    value: z.object({
      allow: z.array(z.string().trim().min(1).max(120)).max(128),
      deny: z.array(z.string().trim().min(1).max(120)).max(128),
    }).strict(),
  }).strict(),
  z.object({ field: z.literal('notification'), value: z.string().trim().min(1).max(120).nullable() }).strict(),
]);

export const RepairProposalSchema = z.object({
  summary: z.string().trim().min(1).max(1_000),
  operations: z.array(RepairOperationSchema).min(1).max(20),
  risk: RiskSeveritySchema,
  rerun_after_apply: z.boolean(),
}).strict();
export type RepairProposal = z.infer<typeof RepairProposalSchema>;

export type GuardedRepairProposal = RepairProposal & {
  can_automate: boolean;
  requires_confirmation: boolean;
  rejected_reasons: string[];
};

const REVIEW_ONLY_TOOLS = new Set([
  'Bash',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  'FetchURL',
  'web_search',
]);

function grantsReviewOnlyTool(patterns: string[]): boolean {
  return patterns.some((pattern) => (
    pattern.includes('*') || pattern.startsWith('mcp__') || REVIEW_ONLY_TOOLS.has(pattern)
  ));
}

function rejectedReason(operation: RepairProposal['operations'][number]): string | undefined {
  if (operation.field === 'codex_sandbox' && operation.value === 'danger-full-access') {
    return 'Unrestricted file access cannot be applied automatically.';
  }
  if (operation.field === 'permission_mode' && operation.value === 'bypassPermissions') {
    return 'Bypassing permission checks cannot be applied automatically.';
  }
  if (operation.field === 'working_directory' && isUnsafeAutomatedFilePath(operation.value)) {
    return 'Access to the entire home folder cannot be applied automatically.';
  }
  if (operation.field === 'file_access') {
    if (operation.value.some((grant) => isUnsafeAutomatedFilePath(grant.path))) {
      return 'Broad file access cannot be applied automatically.';
    }
    if (operation.value.some((grant) => grant.access === 'read_write')) {
      return 'File editing requires explicit review.';
    }
  }
  if (operation.field === 'calendar_access'
    && operation.value.some((grant) => grant.access === 'read_write')) {
    return 'Calendar changes require explicit review.';
  }
  if (operation.field === 'native_services') {
    const resources = [
      ...(operation.value.calendar?.resources ?? []),
      ...(operation.value.reminders?.resources ?? []),
    ];
    if (resources.some((resource) => resource.actions.some((action) => action !== 'read'))) {
      return 'Changes in Mac apps require explicit review.';
    }
  }
  if (operation.field === 'tools' && grantsReviewOnlyTool(operation.value)) {
    return 'Command execution or file editing cannot be added automatically.';
  }
  if (operation.field === 'network' && operation.value) {
    return 'Internet access requires explicit review.';
  }
  if (operation.field === 'permissions' && grantsReviewOnlyTool(operation.value.allow)) {
    return 'Broad tool access cannot be applied automatically.';
  }
  return undefined;
}

export function guardRepairProposal(value: unknown): GuardedRepairProposal {
  const proposal = RepairProposalSchema.parse(value);
  const rejectedReasons = [...new Set(proposal.operations
    .map(rejectedReason)
    .filter((reason): reason is string => reason !== undefined))];
  const isHighRisk = proposal.risk === 'high' || proposal.risk === 'critical';
  return {
    ...proposal,
    can_automate: rejectedReasons.length === 0 && !isHighRisk,
    requires_confirmation: rejectedReasons.length > 0 || proposal.risk !== 'low',
    rejected_reasons: rejectedReasons,
  };
}
