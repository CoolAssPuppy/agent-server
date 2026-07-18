import { z } from 'zod';
import { buildAgentProposalPrompt } from './proposal-prompt.js';
import {
  CreationProposalSchema,
  ProposalRequestSchema,
  type CreationProposal,
  type ProposalFallbackQuestion,
  type ProposalRequest,
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

export type CreateProposalInput = ProposalRequest & { model?: ProposalModel };

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

function fallbackQuestions(request: ProposalRequest): ProposalFallbackQuestion[] {
  const intent = request.request.toLowerCase();
  if (/\b(files?|folders?|documents?|directory)\b/.test(intent)) {
    return [{
      id: 'file-location',
      question: 'Which folder should this agent use?',
      control: 'path',
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

/** Generate and validate a proposal. Invalid model output is never applied. */
export async function createAgentProposal(input: CreateProposalInput): Promise<ProposalServiceResult> {
  const request = ProposalRequestSchema.parse({
    request: input.request,
    timezone: input.timezone,
    connectedServices: input.connectedServices,
    answers: input.answers,
  });
  if (!input.model) return fallback(request, 'unavailable');

  const prompt = buildAgentProposalPrompt(request);
  const outputSchema = z.toJSONSchema(CreationProposalSchema, { unrepresentable: 'any' }) as Record<string, unknown>;
  const attempts = input.model.handlesRetries ? 1 : 2;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await input.model.generate(prompt, outputSchema, { requestKey: 'agent-proposal' });
      const proposal = parseModelValue(value);
      if (proposal) {
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
