export function formatCompletionNotification(agentName: string, summary?: string): string {
  const base = `Agent "${agentName}" completed successfully.`;
  return summary ? `${base}\n\n${summary}` : base;
}

export function formatFailureNotification(agentName: string, error?: string): string {
  const base = `Agent "${agentName}" failed.`;
  return error ? `${base}\n\n${error}` : base;
}
