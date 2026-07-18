import { z } from 'zod';
import { homedir } from 'node:os';
import { AgentProposalSchema } from '../analysis/models.js';
import { analyzeAgentSecurity } from '../analysis/security-rules.js';
import { renderReviewedAgentFile } from '../agents/reviewed-agent-writer.js';
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
  | { status: 'proposal'; proposal: CreationProposal; usedFallback: false }
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
  const parsed = CreationProposalSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function applyAuthoritativeConnections(
  proposal: CreationProposal,
  request: ProposalRequest,
): CreationProposal | undefined {
  const available = new Map(servicesRelevantToRequest(request).map((service) => [service.id, service]));
  const connections = proposal.connections.map((connection) => {
    const service = available.get(connection.id);
    if (!service) return undefined;
    return {
      ...connection,
      name: service.name,
      status: 'connected' as const,
    };
  });
  if (connections.some((connection) => connection === undefined)) return undefined;
  return { ...proposal, connections: connections.filter((connection) => connection !== undefined) };
}

const RISK_ORDER = { low: 0, needs_review: 1, high: 2, critical: 3 } as const;

function applyDeterministicRisk(proposal: CreationProposal): CreationProposal {
  const agent = proposalToAgentConfig(proposal, deriveProposalAgentId(proposal.name));
  const rawContent = renderReviewedAgentFile(agent);
  const deterministic = analyzeAgentSecurity({ agent, rawContent, homeDir: homedir() }).risk;
  return RISK_ORDER[deterministic.level] > RISK_ORDER[proposal.risk.level]
    ? { ...proposal, risk: deterministic }
    : proposal;
}

function needsFileAccess(intent: string): boolean {
  return /\b(files?|folders?|documents?|directory|manuscripts?)\b/.test(intent);
}

function fallbackQuestions(request: ProposalRequest): ProposalFallbackQuestion[] {
  const intent = request.request.toLowerCase();
  if (needsFileAccess(intent)) {
    return [{
      id: 'file-access',
      question: 'Which files or folders may this agent use?',
      control: 'file_access',
      required: true,
    }];
  }
  if (/\b(send|message|notify|share)\b/.test(intent)) {
    return [{
      id: 'destination',
      question: 'Where should the result be sent?',
      control: 'service',
      required: true,
    }];
  }
  return [{
    id: 'expected-result',
    question: 'What should a successful result look like?',
    control: 'text',
    required: true,
  }];
}

function fallback(request: ProposalRequest, modelStatus: 'unavailable' | 'invalid'): ProposalServiceResult {
  return {
    status: 'needs_information',
    questions: fallbackQuestions(request),
    explanation: modelStatus === 'unavailable'
      ? 'Agent suggestions are unavailable right now. Your description has not been saved.'
      : 'The suggestion could not be verified, so no agent or permissions were created.',
    usedFallback: true,
    modelStatus,
  };
}

function unansweredConnectionQuestion(request: ProposalRequest): ProposalFallbackQuestion | undefined {
  if (!/\bnotion\b/i.test(request.request)) return undefined;
  const connections = request.connectedServices.filter((service) => (
    /\bnotion\b/i.test(service.id) || /\bnotion\b/i.test(service.name)
  ));
  const connectionAnswer = request.answers.find((answer) => (
    answer.question_id === 'connection-notion' && typeof answer.value === 'string'
  ));
  if (connections.some((connection) => connection.id === connectionAnswer?.value)) return undefined;
  const requestedScope = /\bpersonal\s+notion\b/i.test(request.request)
    ? 'personal'
    : /\bwork\s+notion\b/i.test(request.request) ? 'work' : undefined;
  const onlyConnectionMatchesRequest = requestedScope === undefined
    || connections.some((connection) => (
      connection.id.toLowerCase().split(/[^a-z0-9]+/).includes(requestedScope)
      || connection.name.toLowerCase().split(/[^a-z0-9]+/).includes(requestedScope)
    ));
  if (connections.length === 1 && connectionAnswer === undefined && onlyConnectionMatchesRequest) return undefined;
  if (connections.length === 0) {
    return {
      id: 'connection-notion',
      question: 'Set up Notion before choosing what this agent can access.',
      control: 'service',
      service_name: 'Notion',
      required: true,
      choices: [],
    };
  }
  return {
    id: 'connection-notion',
    question: 'Which Notion connection should this agent use?',
    control: 'service',
    service_name: 'Notion',
    required: true,
    choices: connections.map((connection) => ({ label: connection.name, value: connection.id })),
  };
}

export function servicesRelevantToRequest(request: ProposalRequest): ProposalRequest['connectedServices'] {
  const intent = request.request.toLowerCase();
  const selectedIds = new Set(request.answers.flatMap((answer) => (
    answer.question_id.startsWith('connection-') && typeof answer.value === 'string'
      ? [answer.value]
      : []
  )));
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

function unansweredScopeQuestion(request: ProposalRequest): ProposalFallbackQuestion | undefined {
  const intent = request.request.toLowerCase();
  const answers = new Set(request.answers.map((answer) => answer.question_id));
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
  if (/\b(calendar|calendars|events|appointments)\b/.test(intent)) {
    if (!answers.has('calendar-id')) {
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
    if (!answers.has('calendar-access')) {
      const selectedId = request.answers.find((answer) => answer.question_id === 'calendar-id')?.value;
      const selected = request.availableCalendars.find((calendar) => calendar.id === selectedId);
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
    answers: input.answers,
  });
  const scopeQuestion = unansweredConnectionQuestion(request) ?? unansweredScopeQuestion(request);
  if (scopeQuestion) {
    return {
      status: 'needs_information',
      questions: [scopeQuestion],
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
      if (withFiles && (withFiles.missing_information.length > 0
        || withFiles.questions.some((question) => question.required))) {
        return {
          status: 'needs_information',
          questions: withFiles.questions,
          explanation: withFiles.explanation,
          usedFallback: false,
          modelStatus: 'completed',
        };
      }
      const withConnections = withFiles ? applyAuthoritativeConnections(withFiles, request) : undefined;
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
