import type { AgentConfig } from '../agents/config.js';

export type NotificationData = {
  agentName: string;
  status: 'completed' | 'failed' | 'skipped';
  summary?: string;
  error?: string;
  turnCount?: number;
  toolsUsed?: string[];
  filesWritten?: string[];
  durationMs?: number;
};

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

export function formatSkippedNotification(agentName: string, reason?: string): string {
  const base = `Agent "${agentName}" did not start.`;
  return reason ? `${base}\n\n${reason}` : base;
}

export function formatPlainNotification(data: NotificationData): string {
  if (data.status === 'completed') {
    return formatCompletionNotification(data.agentName, data.summary);
  }
  if (data.status === 'skipped') {
    return formatSkippedNotification(data.agentName, data.error);
  }
  return formatFailureNotification(data.agentName, data.error);
}
