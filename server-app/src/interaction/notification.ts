import type { AgentConfig } from '../agents/config.js';

export function formatAgentListMessage(agents: AgentConfig[]): string {
  if (agents.length === 0) return 'No agents installed.';

  const lines = agents.map((agent) => {
    const schedule = agent.schedule ? `Schedule: ${agent.schedule}` : 'On-demand';
    const description = agent.description ? ` - ${agent.description}` : '';
    return `- ${agent.name}${description} (${schedule})`;
  });

  return `Available agents:\n\n${lines.join('\n')}`;
}

export function formatCompletionNotification(agentName: string, summary?: string): string {
  const base = `Agent "${agentName}" completed successfully.`;
  return summary ? `${base}\n\n${summary}` : base;
}

export function formatFailureNotification(agentName: string, error?: string): string {
  const base = `Agent "${agentName}" failed.`;
  return error ? `${base}\n\n${error}` : base;
}
