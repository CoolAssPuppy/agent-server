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
  const fileGrants = (request.answers ?? [])
    .find((answer) => answer.question_id === 'file-access')?.value;
  const selectedPaths = Array.isArray(fileGrants)
    ? fileGrants.flatMap((grant) => typeof grant === 'string' ? [] : [grant.path])
    : [];
  const requestWithoutSelectedPaths = selectedPaths
    .sort((left, right) => right.length - left.length)
    .reduce((text, path) => text.split(path).join('[selected local item]'), request.request);
  const safeRequest = sanitizeText(requestWithoutSelectedPaths, 8_000);
  const services = request.connectedServices.length > 0
    ? request.connectedServices.map((service) => (
      `${sanitizeText(service.name, 160)} (${sanitizeText(service.id, 240)}); `
      + `Connection type: ${'source' in service ? service.source ?? 'legacy' : 'legacy'}; `
      + `Known capabilities: ${service.actions_known ? service.actions.join(', ') || 'none' : 'not verified'}`
    )).join(', ')
    : 'None';
  const modelAnswers = (request.answers ?? []).filter((answer) => answer.question_id !== 'file-access');
  const fileSummary = Array.isArray(fileGrants) && fileGrants.length > 0 && typeof fileGrants[0] !== 'string'
    ? `${fileGrants.length} selected item${fileGrants.length === 1 ? '' : 's'}; ${
      fileGrants.some((grant) => typeof grant !== 'string' && grant.access === 'read_write')
        ? 'some can be changed'
        : 'view only'
    }. Paths stay local and will be added after generation.`
    : 'None';
  const answers = modelAnswers.length > 0
    ? modelAnswers.map((answer) => {
      const value = typeof answer.value === 'object' ? JSON.stringify(answer.value) : String(answer.value);
      return `${answer.question_id}: ${sanitizeText(value, 1_000)}`;
    }).join('\n')
    : 'None';
  const selectedCalendarIds = new Set((request.answers ?? [])
    .filter((answer) => answer.question_id === 'calendar-id' && typeof answer.value === 'string')
    .map((answer) => String(answer.value)));
  const selectedCalendars = (request.availableCalendars ?? [])
    .filter((calendar) => selectedCalendarIds.has(calendar.id));
  const calendars = selectedCalendars.length > 0
    ? selectedCalendars.map((calendar) => `${sanitizeText(calendar.name, 160)} (${calendar.id})`).join(', ')
    : 'None';
  const selectedContactId = (request.answers ?? []).find((answer) => answer.question_id === 'contact-group-id')?.value;
  const selectedContactFields = (request.answers ?? []).find((answer) => answer.question_id === 'contact-fields')?.value;
  const selectedContactGroup = (request.availableContactGroups ?? []).find((group) => group.id === selectedContactId);
  const contacts = selectedContactGroup
    ? `${sanitizeText(selectedContactGroup.name, 160)} (${sanitizeText(selectedContactGroup.account, 160)}), `
      + `resource id ${sanitizeText(selectedContactGroup.id, 512)}, fields ${sanitizeText(String(selectedContactFields ?? ''), 120)}`
    : 'None';

  return `${SYSTEM_INSTRUCTIONS}\n\nUser request:\n${safeRequest}\n\nUser time zone: ${request.timezone}\nConnected apps and services: ${services}\nConfirmed file access: ${fileSummary}\nSelected calendars: ${calendars}\nSelected Contacts scope: ${contacts}\nConfirmed answers:\n${answers}`;
}
