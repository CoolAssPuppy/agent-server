function matchesTrigger(triggers, sourceAgentId) {
    if (!triggers)
        return false;
    return triggers.some((t) => t.agent === sourceAgentId);
}
export function evaluateTriggers(agents, sourceAgentId, status) {
    return agents.filter((agent) => {
        if (!agent.enabled)
            return false;
        if (status === 'completed') {
            return matchesTrigger(agent.on_complete, sourceAgentId);
        }
        if (status === 'failed') {
            return matchesTrigger(agent.on_failure, sourceAgentId);
        }
        return false;
    });
}
//# sourceMappingURL=triggers.js.map