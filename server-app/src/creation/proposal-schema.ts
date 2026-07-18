import { z } from 'zod';
import { CronExpressionParser } from 'cron-parser';
import { AgentProposalSchema } from '../analysis/models.js';

function validateProposal(value: z.infer<typeof AgentProposalSchema>, ctx: z.RefinementCtx): void {
  const hasWritablePath = value.file_access.some((entry) => entry.access === 'read_write');
  if (hasWritablePath && !value.permissions.can_modify_files) {
    ctx.addIssue({
      code: 'custom',
      path: ['permissions', 'can_modify_files'],
      message: 'Writable paths require file editing permission',
    });
  }
  if (value.permissions.can_modify_files && !hasWritablePath) {
    ctx.addIssue({
      code: 'custom',
      path: ['file_access'],
      message: 'File editing permission requires a narrow writable path',
    });
  }
  const requiresCalendar = value.capabilities.some((capability) => (
    capability.required && capability.id.toLowerCase() === 'calendar'
  ));
  if (requiresCalendar && value.calendar_access.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['calendar_access'], message: 'Calendar access requires one selected calendar' });
  }
  if (new Set(value.calendar_access.map((calendar) => calendar.id)).size !== value.calendar_access.length) {
    ctx.addIssue({ code: 'custom', path: ['calendar_access'], message: 'A calendar can only be selected once' });
  }
  if (value.trigger.type === 'schedule' && !value.trigger.schedule) {
    ctx.addIssue({ code: 'custom', path: ['trigger', 'schedule'], message: 'A schedule is required' });
  }
  if (value.trigger.type === 'schedule' && value.trigger.schedule) {
    try {
      CronExpressionParser.parse(value.trigger.schedule, { tz: value.timezone });
    } catch {
      ctx.addIssue({ code: 'custom', path: ['trigger', 'schedule'], message: 'The schedule is invalid' });
    }
  }
  if (value.trigger.type !== 'schedule' && value.trigger.schedule) {
    ctx.addIssue({ code: 'custom', path: ['trigger', 'schedule'], message: 'Only scheduled triggers may include a schedule' });
  }
  if (value.trigger.type === 'watch' && !value.trigger.watched_path) {
    ctx.addIssue({ code: 'custom', path: ['trigger', 'watched_path'], message: 'A watched folder is required' });
  }
  if (value.trigger.type !== 'watch' && value.trigger.watched_path) {
    ctx.addIssue({ code: 'custom', path: ['trigger', 'watched_path'], message: 'Only folder triggers may include a watched path' });
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: value.timezone });
  } catch {
    ctx.addIssue({ code: 'custom', path: ['timezone'], message: 'The time zone is invalid' });
  }
  if (value.questions.some((question) => question.required) && value.missing_information.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['missing_information'],
      message: 'Required questions must describe the missing information',
    });
  }
  if (value.missing_information.length > 0 && !value.questions.some((question) => question.required)) {
    ctx.addIssue({
      code: 'custom',
      path: ['questions'],
      message: 'Missing information requires at least one required question',
    });
  }
  if (value.permissions.can_send_messages && !value.notification_destination) {
    ctx.addIssue({
      code: 'custom',
      path: ['notification_destination'],
      message: 'Sending messages requires a destination',
    });
  }
  const canModifyCalendar = value.calendar_access.some((calendar) => calendar.access === 'read_write');
  const powerfulLocalAccess = value.permissions.can_modify_files || value.permissions.can_run_commands || canModifyCalendar;
  if (powerfulLocalAccess && value.risk.level !== 'high' && value.risk.level !== 'critical') {
    ctx.addIssue({
      code: 'custom',
      path: ['risk', 'level'],
      message: 'File editing and command execution require a high-risk review',
    });
  }
  const externalAccess = value.permissions.requires_network
    || value.permissions.can_use_connected_apps
    || value.permissions.can_send_messages;
  if (externalAccess && value.risk.level === 'low') {
    ctx.addIssue({
      code: 'custom',
      path: ['risk', 'level'],
      message: 'External access requires review',
    });
  }
}

export const CreationProposalSchema = AgentProposalSchema.superRefine(validateProposal);
export type CreationProposal = z.infer<typeof CreationProposalSchema>;

export const ProposalAnswerSchema = z.object({
  question_id: z.string().trim().min(1).max(120),
  value: z.union([
    z.string().trim().min(1).max(2_000),
    z.boolean(),
    z.array(z.string().trim().min(1).max(500)).max(20),
  ]),
}).strict();
export type ProposalAnswer = z.infer<typeof ProposalAnswerSchema>;

const ConnectedServiceSchema = z.object({
  id: z.string().trim().min(1).max(240),
  name: z.string().trim().min(1).max(160),
}).strict();

export const ProposalRequestSchema = z.object({
  request: z.string().trim().min(1).max(8_000),
  timezone: z.string().trim().min(1).max(120),
  connectedServices: z.array(z.union([
    ConnectedServiceSchema,
    z.string().trim().min(1).max(160).transform((value) => ({ id: value, name: value })),
  ])).max(64),
  availableCalendars: z.array(z.object({
    id: z.string().trim().min(1).max(512),
    name: z.string().trim().min(1).max(160),
    account: z.string().trim().min(1).max(160),
    canModify: z.boolean(),
  }).strict()).max(128).default([]),
  answers: z.array(ProposalAnswerSchema).max(12).default([]),
}).strict();
export type ProposalRequest = z.infer<typeof ProposalRequestSchema>;
export type ProposalRequestInput = Omit<ProposalRequest, 'connectedServices'> & {
  connectedServices: Array<ProposalRequest['connectedServices'][number] | string>;
};

export const ProposalFallbackQuestionSchema = z.object({
  id: z.string().trim().min(1).max(120),
  question: z.string().trim().min(1).max(500),
  control: z.enum(['text', 'single_choice', 'schedule', 'path', 'permission', 'service']),
  service_name: z.string().trim().min(1).max(120).optional(),
  required: z.boolean(),
  choices: z.array(z.object({
    label: z.string().trim().min(1).max(160),
    value: z.string().trim().min(1).max(300),
  }).strict()).max(128).optional(),
}).strict();
export type ProposalFallbackQuestion = z.infer<typeof ProposalFallbackQuestionSchema>;
