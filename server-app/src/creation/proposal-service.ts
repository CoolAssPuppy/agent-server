import { z } from 'zod';
import { homedir } from 'node:os';
import { CronExpressionParser } from 'cron-parser';
import { AgentProposalSchema } from '../analysis/models.js';
import { analyzeAgentSecurity } from '../analysis/security-rules.js';
import { CAPABILITY_CATALOG } from '../agents/capabilities.js';
import { renderReviewedAgentFile } from '../agents/reviewed-agent-writer.js';
import { sanitizeText } from '../server/security-utils.js';
import { buildAgentProposalPrompt } from './proposal-prompt.js';
import { deriveProposalAgentId, proposalToAgentConfig } from './proposal-configuration.js';
import {
  CreationProposalSchema,
  ProposalRequestSchema,
  type CreationProposal,
  type ProposalFallbackQuestion,
  type ProposalRequest,
  type ProposalRequestInput,
} from './proposal-schema.js';

export { buildAgentProposalPrompt } from './proposal-prompt.js';

export type ProposalModel = {
  readonly handlesRetries?: boolean;
  generate: (
    prompt: string,
    outputSchema: Record<string, unknown>,
    options?: { requestKey?: string; signal?: AbortSignal },
  ) => Promise<unknown>;
};

export type CreateProposalInput = ProposalRequestInput & { model?: ProposalModel };

export type ProposalServiceResult =
  | { status: 'proposal'; proposal: CreationProposal; usedFallback: boolean }
  | {
    status: 'needs_information';
    questions: CreationProposal['questions'];
    explanation: string;
    usedFallback: false;
    modelStatus: 'completed';
  }
  | {
    status: 'needs_information';
    questions: ProposalFallbackQuestion[];
    explanation: string;
    usedFallback: true;
    modelStatus: 'unavailable' | 'invalid';
  };

function parseModelValue(value: unknown): CreationProposal | undefined {
  let candidate = value;
  if (typeof value === 'string') {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
  const parsed = AgentProposalSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function confirmedFileAccess(request: ProposalRequest) {
  const answer = request.answers.find((candidate) => candidate.question_id === 'file-access');
  if (!answer || !Array.isArray(answer.value)) return undefined;
  const grants = answer.value.filter((grant) => typeof grant !== 'string');
  return grants.length === answer.value.length ? grants : undefined;
}

function applyConfirmedFileAccess(
  proposal: CreationProposal,
  request: ProposalRequest,
): CreationProposal | undefined {
  const grants = confirmedFileAccess(request);
  const candidate = grants ? {
    ...proposal,
    file_access: grants.map((grant) => ({
      ...grant,
      is_suggestion: false,
      reason: grant.access === 'read_write'
        ? 'Uses the file or folder selected for changes.'
        : 'Views the file or folder selected by the user.',
    })),
    permissions: {
      ...proposal.permissions,
      can_modify_files: grants.some((grant) => grant.access === 'read_write'),
    },
    ...(grants.length > 0
      ? { runtime: { executor: 'claude-code' as const, model: null, reason: 'Enforces access to the selected files and folders.' } }
      : {}),
  } : proposal;
  const parsed = AgentProposalSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function confirmedReminderAccess(request: ProposalRequest) {
  const selectedId = request.answers.find((answer) => answer.question_id === 'reminder-list-id')?.value;
  const selectedActions = request.answers.find((answer) => answer.question_id === 'reminder-actions')?.value;
  if (typeof selectedId !== 'string' || typeof selectedActions !== 'string') return undefined;
  const resource = request.availableReminderLists.find((candidate) => candidate.id === selectedId);
  if (!resource) return undefined;
  const actions = {
    read_only: ['read'],
    read_create: ['read', 'create'],
    read_complete: ['read', 'complete'],
    read_create_complete: ['read', 'create', 'complete'],
  }[selectedActions];
  if (!actions || (!resource.canModify && actions.length > 1)) return undefined;
  return {
    reminders: {
      resources: [{ id: resource.id, name: resource.name, account: resource.account, actions }],
    },
  };
}

function confirmedCalendarAccess(request: ProposalRequest) {
  const selectedId = request.answers.find((answer) => answer.question_id === 'calendar-id')?.value;
  const selectedAccess = request.answers.find((answer) => answer.question_id === 'calendar-access')?.value;
  if (typeof selectedId !== 'string' || typeof selectedAccess !== 'string') return undefined;
  const resource = request.availableCalendars.find((candidate) => candidate.id === selectedId);
  if (!resource || !['read_only', 'read_write'].includes(selectedAccess)) return undefined;
  if (!resource.canModify && selectedAccess === 'read_write') return undefined;
  return [{
    id: resource.id,
    name: resource.name,
    account: resource.account,
    access: selectedAccess as 'read_only' | 'read_write',
    reason: selectedAccess === 'read_write'
      ? 'Adds and changes events only in the selected calendar.'
      : 'Views events only in the selected calendar.',
  }];
}

function confirmedContactAccess(request: ProposalRequest) {
  const selectedId = request.answers.find((answer) => answer.question_id === 'contact-group-id')?.value;
  const selectedFields = request.answers.find((answer) => answer.question_id === 'contact-fields')?.value;
  if (typeof selectedId !== 'string' || typeof selectedFields !== 'string') return undefined;
  const resource = request.availableContactGroups.find((candidate) => candidate.id === selectedId);
  const fields = {
    name_only: ['name'],
    name_email: ['name', 'email'],
    name_phone: ['name', 'phone'],
    name_birthday: ['name', 'birthday'],
    all_details: ['name', 'email', 'phone', 'birthday'],
  }[selectedFields];
  if (!resource || !fields) return undefined;
  return {
    contacts: {
      resources: [{ ...resource, actions: ['read'] as const, fields }],
    },
  };
}

function applyConfirmedNativeAccess(proposal: CreationProposal, request: ProposalRequest): CreationProposal | undefined {
  const candidate = {
    ...proposal,
    calendar_access: confirmedCalendarAccess(request) ?? [],
    native_services: {
      ...(confirmedReminderAccess(request) ?? {}),
      ...(confirmedContactAccess(request) ?? {}),
    },
  };
  const parsed = AgentProposalSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function applyAuthoritativeConnections(
  proposal: CreationProposal,
  request: ProposalRequest,
): CreationProposal | undefined {
  const available = new Map(servicesRelevantToRequest(request).map((service) => [service.id, service]));
  const selectedIds = explicitlySelectedServiceIds(request);
  const proposalIds = proposal.connections.map((connection) => connection.id);
  if (new Set(proposalIds).size !== proposalIds.length) return undefined;
  const proposedConnections = proposal.connections.map((connection) => {
    const service = available.get(connection.id);
    if (!service) return undefined;
    return {
      ...connection,
      name: service.name,
      status: 'connected' as const,
      required: selectedIds.has(connection.id) ? true : connection.required,
    };
  });
  if (proposedConnections.some((connection) => connection === undefined)) return undefined;
  const missingSelectedConnections = [...selectedIds]
    .filter((id) => !proposalIds.includes(id))
    .map((id) => {
      const service = available.get(id);
      if (!service) return undefined;
      return {
        id: service.id,
        name: service.name,
        required: true,
        status: 'connected' as const,
        reason: 'You selected this service for the agent.',
      };
    });
  if (missingSelectedConnections.some((connection) => connection === undefined)) return undefined;
  return {
    ...proposal,
    connections: [
      ...proposedConnections.filter((connection) => connection !== undefined),
      ...missingSelectedConnections.filter((connection) => connection !== undefined),
    ],
  };
}

const RISK_ORDER = { low: 0, needs_review: 1, high: 2, critical: 3 } as const;

function applyDeterministicRisk(proposal: CreationProposal): CreationProposal | undefined {
  const agent = proposalToAgentConfig(proposal, deriveProposalAgentId(proposal.name));
  const rawContent = renderReviewedAgentFile(agent);
  const deterministic = analyzeAgentSecurity({ agent, rawContent, homeDir: homedir() }).risk;
  const candidate = RISK_ORDER[deterministic.level] > RISK_ORDER[proposal.risk.level]
    ? { ...proposal, risk: deterministic }
    : proposal;
  const parsed = CreationProposalSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function needsFileAccess(intent: string): boolean {
  return /\b(files?|folders?|documents?|directory|manuscripts?)\b/.test(intent);
}

function needsReminderAccess(intent: string): boolean {
  return /\b(reminders?|reminder lists?|to-?dos?)\b/.test(intent);
}

function needsCalendarAccess(intent: string): boolean {
  return /\b(calendar|calendars|appointments?|meetings?)\b/.test(intent)
    || /\b(?:create|add|update|schedule|book)\s+(?:an?\s+)?events?\b/.test(intent)
    || /\b(?:schedule|book|block)\s+(?:a\s+|some\s+)?time\b/.test(intent);
}

function needsContactAccess(intent: string): boolean {
  return /\b(?:my|selected|mac(?:os)?|apple) contacts\b/.test(intent)
    || /\bcontacts app\b|\baddress book\b|\bcontact groups?\b/.test(intent)
    || /\b(?:from|in|use|using|search|read|review)\s+(?:my\s+)?contacts\b/.test(intent);
}

function unavailableCapabilityQuestion(request: ProposalRequest): ProposalFallbackQuestion | undefined {
  if (!/\b(?:apple\s+music|mac(?:os)?\s+music(?:\s+app)?)\b/i.test(request.request)) return undefined;
  return {
    id: 'apple-music-unavailable',
    question: 'Apple Music access is not available in this build.',
    control: 'unavailable',
    unavailable_message: 'Agent Server needs a verified, signed MusicKit capability before it can safely offer Apple Music access.',
    required: true,
  };
}

type ProposalTrigger = CreationProposal['trigger'];

function parseCron(value: string): string | undefined {
  try {
    CronExpressionParser.parse(value);
    return value;
  } catch {
    return undefined;
  }
}

function dailyScheduleFromText(value: string): ProposalTrigger | undefined {
  const match = value.match(
    /\b(?:every\s+(?:morning|day)|daily)(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i,
  );
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (hour < 1 || hour > 12 || minute > 59) return undefined;
  const isPM = match[3]?.toLowerCase().startsWith('p') ?? false;
  const twentyFourHour = hour % 12 + (isPM ? 12 : 0);
  const suffix = isPM ? 'PM' : 'AM';
  return {
    type: 'schedule',
    schedule: `${minute} ${twentyFourHour} * * *`,
    human_description: `Every day at ${hour}:${String(minute).padStart(2, '0')} ${suffix}`,
  };
}

function confirmedTrigger(request: ProposalRequest): ProposalTrigger {
  const scheduleAnswer = request.answers.find((answer) => (
    /schedule|when.*run/.test(answer.question_id) && typeof answer.value === 'string'
  ));
  if (scheduleAnswer && typeof scheduleAnswer.value === 'string') {
    if (scheduleAnswer.value === 'manual') {
      return { type: 'manual', human_description: 'Only when you run it manually' };
    }
    const cron = parseCron(scheduleAnswer.value);
    if (cron) return { type: 'schedule', schedule: cron, human_description: 'On the schedule you selected' };
    const described = dailyScheduleFromText(scheduleAnswer.value);
    if (described) return described;
  }
  return dailyScheduleFromText(request.request)
    ?? { type: 'manual', human_description: 'Only when you run it manually' };
}

function safeIntent(request: ProposalRequest): string {
  const paths = confirmedFileAccess(request)?.map((grant) => grant.path) ?? [];
  return paths
    .sort((left, right) => right.length - left.length)
    .reduce((intent, path) => intent.split(path).join('the selected file or folder'), sanitizeText(request.request, 8_000));
}

function fallbackName(intent: string, trigger: ProposalTrigger): string {
  const prefix = trigger.type === 'schedule' ? 'Daily ' : '';
  if (/\bmanuscript\b/i.test(intent)) return `${prefix}manuscript review`;
  if (/\bresearch\b/i.test(intent) && /\bsummar/i.test(intent)) return `${prefix}research summary`;
  const words = intent.replace(/[^a-z0-9\s]/gi, ' ').trim().split(/\s+/).slice(0, 7);
  const title = words.join(' ') || 'New agent';
  return sanitizeText(title.charAt(0).toUpperCase() + title.slice(1), 120);
}

function localProposal(request: ProposalRequest): CreationProposal | undefined {
  const intent = safeIntent(request);
  const trigger = confirmedTrigger(request);
  const relevantServices = servicesRelevantToRequest(request);
  const connections = relevantServices.map((service) => ({
    id: service.id,
    name: service.name,
    required: true,
    status: 'connected' as const,
    reason: 'You selected this service for the agent.',
  }));
  const fileAccess = (confirmedFileAccess(request) ?? []).map((grant) => ({
    ...grant,
    is_suggestion: false,
    reason: grant.access === 'read_write'
      ? 'Uses the selected file or folder and may make changes there.'
      : 'Views only the selected file or folder.',
  }));
  const canModifyFiles = fileAccess.some((grant) => grant.access === 'read_write');
  const usesServices = connections.length > 0;
  const proposal = AgentProposalSchema.safeParse({
    schema_version: 1,
    name: fallbackName(intent, trigger),
    description: sanitizeText(intent, 500),
    instructions: intent,
    explanation: trigger.type === 'schedule'
      ? `${trigger.human_description}, this agent will carry out the request using only the access you reviewed.`
      : 'This agent will carry out the request only when you run it, using only the access you reviewed.',
    trigger,
    timezone: request.timezone,
    capabilities: fileAccess.length > 0 ? [{
      id: 'local-files', name: 'Local files', required: true, status: 'connected',
      reason: 'The request uses the files or folders you selected.',
    }] : [],
    connections,
    file_access: fileAccess,
    calendar_access: [],
    native_services: {},
    permissions: {
      can_modify_files: canModifyFiles,
      can_run_commands: false,
      requires_network: usesServices,
      can_use_connected_apps: usesServices,
      can_send_messages: false,
    },
    notification_destination: null,
    runtime: fileAccess.length > 0
      ? { executor: 'claude-code', model: null, reason: 'Enforces access to the selected files and folders.' }
      : null,
    risk: {
      level: canModifyFiles ? 'high' : usesServices ? 'needs_review' : 'low',
      reasons: [
        ...(canModifyFiles ? ['It can change a selected file or folder.'] : []),
        ...(usesServices ? ['It uses a connected service.'] : []),
      ],
      finding_count: 0,
    },
    missing_information: [],
    questions: [],
    markdown_instructions: `# ${fallbackName(intent, trigger)}\n\n## What to do\n\n${intent}\n\n`
      + '## Success criteria\n\nComplete the requested review and produce the requested result.\n\n'
      + '## Safety\n\nUse only the files, folders, and services listed in this agent. '
      + 'If required information is missing, explain what is needed and stop. '
      + 'Never expose secrets or perform destructive actions.',
  });
  if (!proposal.success) return undefined;
  const withNative = applyConfirmedNativeAccess(proposal.data, request);
  return withNative ? applyDeterministicRisk(withNative) : undefined;
}

function fallback(request: ProposalRequest, modelStatus: 'unavailable' | 'invalid'): ProposalServiceResult {
  const proposal = localProposal(request);
  if (proposal) return { status: 'proposal', proposal, usedFallback: true };
  return {
    status: 'needs_information',
    questions: [],
    explanation: modelStatus === 'unavailable'
      ? 'Agent suggestions are unavailable right now. Nothing was saved.'
      : 'The suggestion could not be verified. Nothing was saved.',
    usedFallback: true,
    modelStatus,
  };
}

const CONNECTION_SERVICES = CAPABILITY_CATALOG
  .filter((capability) => capability.kind === 'mcp' && !capability.builtin)
  .map((capability) => ({
    id: capability.id,
    name: capability.label,
    aliases: [capability.label, capability.id, ...(capability.intentAliases ?? [])],
  }));

function mentionIndex(intent: string, aliases: readonly string[]): number | undefined {
  const indexes = aliases.flatMap((alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`\\b${escaped}\\b`, 'i').exec(intent);
    return match ? [match.index] : [];
  });
  return indexes.length > 0 ? Math.min(...indexes) : undefined;
}

function unansweredConnectionQuestions(request: ProposalRequest): ProposalFallbackQuestion[] {
  const mentioned = CONNECTION_SERVICES
    .flatMap((service) => {
      const index = mentionIndex(request.request, service.aliases);
      return index === undefined ? [] : [{ service, index }];
    })
    .sort((left, right) => left.index - right.index);

  return mentioned.flatMap(({ service }) => {
    const questionId = `connection-${service.id}`;
    const connections = request.connectedServices.filter((connection) => {
      const serviceId = 'service_id' in connection ? connection.service_id : undefined;
      if (serviceId === service.id) return true;
      const legacy = `${connection.id} ${connection.name}`.toLowerCase();
      return service.aliases.some((alias) => new RegExp(`\\b${alias}\\b`, 'i').test(legacy));
    });
    const answer = request.answers.find((candidate) => (
      candidate.question_id === questionId && typeof candidate.value === 'string'
    ));
    if (connections.some((connection) => connection.id === answer?.value)) return [];
    return [{
      id: questionId,
      question: connections.length === 0
        ? `Set up ${service.name} before choosing what this agent can access.`
        : `Which ${service.name} connection should this agent use?`,
      control: 'service' as const,
      service_name: service.name,
      required: true,
      choices: connections.map((connection) => ({ label: connection.name, value: connection.id })),
    }];
  });
}

export function servicesRelevantToRequest(request: ProposalRequest): ProposalRequest['connectedServices'] {
  const intent = request.request.toLowerCase();
  const selectedIds = explicitlySelectedServiceIds(request);

  const groups = new Map<string, number>();
  for (const service of request.connectedServices) {
    const group = ('service_id' in service ? service.service_id : undefined) ?? service.id;
    groups.set(group, (groups.get(group) ?? 0) + 1);
  }
  return request.connectedServices.filter((service) => {
    if (selectedIds.has(service.id)) return true;
    const serviceId = 'service_id' in service ? service.service_id : undefined;
    const group = serviceId ?? service.id;
    if ((groups.get(group) ?? 0) > 1) return false;
    const terms = [serviceId, service.name.split(/\s|\(/)[0]]
      .filter((term): term is string => Boolean(term && term.length >= 3));
    return terms.some((term) => {
      const escaped = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`).test(intent);
    });
  });
}

function explicitlySelectedServiceIds(request: ProposalRequest): Set<string> {
  return new Set(request.answers.flatMap((answer) => (
    answer.question_id.startsWith('connection-') && typeof answer.value === 'string'
      ? [answer.value]
      : []
  )));
}

function unansweredScopeQuestion(request: ProposalRequest): ProposalFallbackQuestion | undefined {
  const intent = request.request.toLowerCase();
  const answers = new Set(request.answers.map((answer) => answer.question_id));
  if (needsReminderAccess(intent)) {
    const selectedId = request.answers.find((answer) => answer.question_id === 'reminder-list-id')?.value;
    const selected = request.availableReminderLists.find((list) => list.id === selectedId);
    if (!answers.has('reminder-list-id') || !selected) {
      return {
        id: 'reminder-list-id',
        question: 'Which reminder list may this agent use?',
        control: 'single_choice',
        required: true,
        choices: request.availableReminderLists.map((list) => ({
          label: `${list.name} (${list.account})`,
          value: list.id,
        })),
      };
    }
    const selectedActions = request.answers.find((answer) => answer.question_id === 'reminder-actions')?.value;
    const allowedActions = selected.canModify
      ? new Set(['read_only', 'read_create', 'read_complete', 'read_create_complete'])
      : new Set(['read_only']);
    if (!answers.has('reminder-actions')
      || typeof selectedActions !== 'string'
      || !allowedActions.has(selectedActions)) {
      return {
        id: 'reminder-actions',
        question: 'What may this agent do with reminders in this list?',
        control: 'single_choice',
        required: true,
        choices: [
          { label: 'View reminders only', value: 'read_only' },
          ...(selected?.canModify ? [
            { label: 'View and add reminders', value: 'read_create' },
            { label: 'View and mark reminders complete', value: 'read_complete' },
            { label: 'View, add, and mark complete', value: 'read_create_complete' },
          ] : []),
        ],
      };
    }
  }
  if (needsContactAccess(intent)) {
    const selectedId = request.answers.find((answer) => answer.question_id === 'contact-group-id')?.value;
    const selected = request.availableContactGroups.find((group) => group.id === selectedId);
    if (!answers.has('contact-group-id') || !selected) {
      return {
        id: 'contact-group-id',
        question: 'Which contacts may this agent use?',
        control: 'single_choice',
        required: true,
        choices: request.availableContactGroups.map((group) => ({
          label: `${group.name} (${group.account})`,
          value: group.id,
        })),
      };
    }
    const selectedFields = request.answers.find((answer) => answer.question_id === 'contact-fields')?.value;
    const allowedFields = new Set(['name_only', 'name_email', 'name_phone', 'name_birthday', 'all_details']);
    if (!answers.has('contact-fields')
      || typeof selectedFields !== 'string'
      || !allowedFields.has(selectedFields)) {
      return {
        id: 'contact-fields',
        question: 'Which contact details may this agent read?',
        control: 'single_choice',
        required: true,
        choices: [
          { label: 'Names only', value: 'name_only' },
          { label: 'Names and email addresses', value: 'name_email' },
          { label: 'Names and phone numbers', value: 'name_phone' },
          { label: 'Names and birthdays', value: 'name_birthday' },
          { label: 'Names, email addresses, phone numbers, and birthdays', value: 'all_details' },
        ],
      };
    }
  }
  if (needsFileAccess(intent)) {
    if (!answers.has('file-access')) {
      return {
        id: 'file-access',
        question: 'Which files or folders may this agent use?',
        control: 'file_access',
        required: true,
      };
    }
  }
  if (needsCalendarAccess(intent)) {
    const selectedId = request.answers.find((answer) => answer.question_id === 'calendar-id')?.value;
    const selected = request.availableCalendars.find((calendar) => calendar.id === selectedId);
    if (!answers.has('calendar-id') || !selected) {
      return {
        id: 'calendar-id',
        question: 'Which calendar may this agent use?',
        control: 'single_choice',
        required: true,
        choices: request.availableCalendars.map((calendar) => ({
          label: `${calendar.name} (${calendar.account})`,
          value: calendar.id,
        })),
      };
    }
    const selectedAccess = request.answers.find((answer) => answer.question_id === 'calendar-access')?.value;
    const allowedAccess = selected.canModify ? new Set(['read_only', 'read_write']) : new Set(['read_only']);
    if (!answers.has('calendar-access')
      || typeof selectedAccess !== 'string'
      || !allowedAccess.has(selectedAccess)) {
      return {
        id: 'calendar-access',
        question: 'May this agent only view events, or may it add and change them?',
        control: 'single_choice',
        required: true,
        choices: [
          { label: 'View only', value: 'read_only' },
          ...(selected?.canModify
            ? [{ label: 'Add and change events', value: 'read_write' }]
            : []),
        ],
      };
    }
  }
  return undefined;
}

/** Generate and validate a proposal. Invalid model output is never applied. */
export async function createAgentProposal(input: CreateProposalInput): Promise<ProposalServiceResult> {
  const request = ProposalRequestSchema.parse({
    request: input.request,
    timezone: input.timezone,
    connectedServices: input.connectedServices,
    availableCalendars: input.availableCalendars,
    availableReminderLists: input.availableReminderLists,
    availableContactGroups: input.availableContactGroups,
    answers: input.answers,
  });
  const unavailableQuestion = unavailableCapabilityQuestion(request);
  const connectionQuestions = unansweredConnectionQuestions(request);
  const questions = unavailableQuestion
    ? [unavailableQuestion]
    : connectionQuestions.length > 0
      ? connectionQuestions
      : [unansweredScopeQuestion(request)].filter((question) => question !== undefined);
  if (questions.length > 0) {
    return {
      status: 'needs_information',
      questions,
      explanation: 'Choose the exact access this agent needs before reviewing it.',
      usedFallback: true,
      modelStatus: 'unavailable',
    };
  }
  if (!input.model) return fallback(request, 'unavailable');

  const prompt = buildAgentProposalPrompt({
    ...request,
    connectedServices: servicesRelevantToRequest(request),
  });
  const outputSchema = z.toJSONSchema(CreationProposalSchema, { unrepresentable: 'any' }) as Record<string, unknown>;
  const attempts = input.model.handlesRetries ? 1 : 2;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await input.model.generate(prompt, outputSchema, { requestKey: 'agent-proposal' });
      const parsedProposal = parseModelValue(value);
      const withFiles = parsedProposal ? applyConfirmedFileAccess(parsedProposal, request) : undefined;
      const withNativeAccess = withFiles ? applyConfirmedNativeAccess(withFiles, request) : undefined;
      let resolvedProposal = withNativeAccess;
      if (resolvedProposal && (resolvedProposal.missing_information.length > 0
        || resolvedProposal.questions.some((question) => question.required))) {
        const answeredIds = new Set(request.answers.map((answer) => answer.question_id));
        const requiredQuestions = resolvedProposal.questions.filter((question) => question.required);
        const unansweredQuestions = requiredQuestions.filter((question) => !answeredIds.has(question.id));
        if (unansweredQuestions.length > 0) {
          return {
            status: 'needs_information',
            questions: unansweredQuestions,
            explanation: resolvedProposal.explanation,
            usedFallback: false,
            modelStatus: 'completed',
          };
        }
        if (requiredQuestions.length === 0) continue;
        resolvedProposal = {
          ...resolvedProposal,
          missing_information: [],
          questions: resolvedProposal.questions.filter((question) => !answeredIds.has(question.id)),
        };
      }
      const withConnections = resolvedProposal
        ? applyAuthoritativeConnections(resolvedProposal, request)
        : undefined;
      const proposal = withConnections ? applyDeterministicRisk(withConnections) : undefined;
      if (proposal) {
        return { status: 'proposal', proposal, usedFallback: false };
      }
    } catch {
      if (attempt === attempts - 1) return fallback(request, 'unavailable');
    }
  }
  return fallback(request, 'invalid');
}
