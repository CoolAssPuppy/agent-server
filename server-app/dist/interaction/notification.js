export function formatAgentListMessage(agents) {
    if (agents.length === 0)
        return 'No agents installed.';
    const lines = agents.map((agent) => {
        const schedule = agent.schedule ? `Schedule: ${agent.schedule}` : 'On-demand';
        const description = agent.description ? ` - ${agent.description}` : '';
        return `- ${agent.name}${description} (${schedule})`;
    });
    return `Available agents:\n\n${lines.join('\n')}`;
}
export function formatCompletionNotification(agentName, summary) {
    const base = `Agent "${agentName}" completed successfully.`;
    return summary ? `${base}\n\n${summary}` : base;
}
export function formatFailureNotification(agentName, error) {
    const base = `Agent "${agentName}" failed.`;
    return error ? `${base}\n\n${error}` : base;
}
export function formatPlainNotification(data) {
    if (data.status === 'completed') {
        return formatCompletionNotification(data.agentName, data.summary);
    }
    return formatFailureNotification(data.agentName, data.error);
}
//# sourceMappingURL=notification.js.map