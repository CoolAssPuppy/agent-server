import { sanitizeText } from '../server/security-utils.js';
import type { ProposalRequest } from './proposal-schema.js';

const SYSTEM_INSTRUCTIONS = `You create Agent Server proposals for people who do not use developer tools.
Return only a value matching the supplied JSON schema.
Use consumer language in all explanations and questions.
Ask only questions that block a safe, complete proposal.
Optimize for the least access needed.
Never invent credentials or file paths. Mark suggested paths as suggestions.
Never add write access unless the request requires it and a narrow path is known.
Never add command execution unless the requested outcome cannot be achieved without it.
Never add network access unless a named app, service, or web source requires it.
Prefer read-only access, manual triggers, the default runtime, and existing connections.
Explain each risky recommendation without implementation jargon.
Instructions must include success criteria, expected output, missing-data handling, secret protection, and relevant safeguards.`;

export function buildAgentProposalPrompt(request: ProposalRequest): string {
  const safeRequest = sanitizeText(request.request, 8_000);
  const services = request.connectedServices.length > 0
    ? request.connectedServices.map((service) => sanitizeText(service, 120)).join(', ')
    : 'None';
  const answers = (request.answers ?? []).length > 0
    ? (request.answers ?? []).map((answer) => `${answer.question_id}: ${sanitizeText(String(answer.value), 1_000)}`).join('\n')
    : 'None';

  return `${SYSTEM_INSTRUCTIONS}\n\nUser request:\n${safeRequest}\n\nUser time zone: ${request.timezone}\nConnected apps and services: ${services}\nConfirmed answers:\n${answers}`;
}
