import type { AgentConfig } from '../agents/config.js';
import { sanitizeText } from '../server/security-utils.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function describeTrigger(agent: AgentConfig): string {
  const weekly = /^(\d{1,2}) (\d{1,2}) \* \* ([0-6])$/.exec(agent.schedule ?? '');
  if (weekly) {
    const minute = weekly[1].padStart(2, '0');
    const hour = weekly[2].padStart(2, '0');
    return `Every ${WEEKDAYS[Number(weekly[3])]} at ${hour}:${minute}`;
  }
  if (agent.schedule) return 'It runs automatically on a schedule';
  if ((agent.watch ?? []).length > 0) return 'It reacts when selected files change';
  return 'It runs only when started by the user';
}

/**
 * Builds minimal model context for creating a related agent. It deliberately
 * excludes the source prompt, paths, connection configuration, credentials,
 * runtime settings, and access rules. The new proposal must earn its own
 * narrowly scoped access through the normal review flow.
 */
export function buildSimilarAgentRequest(agent: AgentConfig, requestedChanges: string): string {
  const safeName = sanitizeText(agent.name, 120);
  const safeDescription = agent.description ? sanitizeText(agent.description, 300) : undefined;
  // Leave room under ProposalRequestSchema's 8,000-character bound for the
  // redacted source context and safety instruction.
  const safeChanges = sanitizeText(requestedChanges, 7_000);
  return [
    `Create an agent similar in purpose to "${safeName}".`,
    ...(safeDescription ? [`Existing purpose: ${safeDescription}`] : []),
    `Existing timing: ${describeTrigger(agent)}.`,
    `Requested changes: ${safeChanges}`,
    'Treat this only as a high-level reference. Choose the least access needed for the changed request.',
  ].join('\n');
}
