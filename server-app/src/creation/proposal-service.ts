import { z } from 'zod';
import { buildAgentProposalPrompt } from './proposal-prompt.js';
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
  const parsed = CreationProposalSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function matchesConfirmedFileAccess(proposal: CreationProposal, request: ProposalRequest): boolean {
  const answer = request.answers.find((candidate) => candidate.question_id === 'file-access');
  if (!answer || !Array.isArray(answer.value) || answer.value.length === 0) return proposal.file_access.length === 0;
  const key = (grant: { path: string; kind: string; access: string }) => (
    `${grant.path}\0${grant.kind}\0${grant.access}`
  );
  const confirmed = answer.value.map((grant) => typeof grant === 'string' ? undefined : key(grant));
  if (confirmed.some((value) => value === undefined)) return false;
  const confirmedKeys = confirmed.filter((value): value is string => value !== undefined).sort();
  const proposed = proposal.file_access.map(key).sort();
  return confirmedKeys.length === proposed.length
    && confirmedKeys.every((value, index) => value === proposed[index]);
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

  const prompt = buildAgentProposalPrompt(request);
  const outputSchema = z.toJSONSchema(CreationProposalSchema, { unrepresentable: 'any' }) as Record<string, unknown>;
  const attempts = input.model.handlesRetries ? 1 : 2;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await input.model.generate(prompt, outputSchema, { requestKey: 'agent-proposal' });
      const proposal = parseModelValue(value);
      if (proposal && matchesConfirmedFileAccess(proposal, request)) {
        if (proposal.missing_information.length > 0 || proposal.questions.some((question) => question.required)) {
          return {
            status: 'needs_information',
            questions: proposal.questions,
            explanation: proposal.explanation,
            usedFallback: false,
            modelStatus: 'completed',
          };
        }
        return { status: 'proposal', proposal, usedFallback: false };
      }
    } catch {
      if (attempt === attempts - 1) return fallback(request, 'unavailable');
    }
  }
  return fallback(request, 'invalid');
}
