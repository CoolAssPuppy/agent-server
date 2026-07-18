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
Use only calendar identifiers confirmed in the answers. Keep calendar access view-only unless changes are confirmed.
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
  const selectedCalendarIds = new Set((request.answers ?? [])
    .filter((answer) => answer.question_id === 'calendar-id' && typeof answer.value === 'string')
    .map((answer) => String(answer.value)));
  const selectedCalendars = (request.availableCalendars ?? [])
    .filter((calendar) => selectedCalendarIds.has(calendar.id));
  const calendars = selectedCalendars.length > 0
    ? selectedCalendars.map((calendar) => `${sanitizeText(calendar.name, 160)} (${calendar.id})`).join(', ')
    : 'None';

  return `${SYSTEM_INSTRUCTIONS}\n\nUser request:\n${safeRequest}\n\nUser time zone: ${request.timezone}\nConnected apps and services: ${services}\nSelected calendars: ${calendars}\nConfirmed answers:\n${answers}`;
}
