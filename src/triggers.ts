import type { AgentConfig, TriggerRef } from './agent-config.js';

type CompletionStatus = 'completed' | 'failed';

function matchesTrigger(triggers: TriggerRef[] | undefined, sourceAgentId: string): boolean {
  if (!triggers) return false;
  return triggers.some((t) => t.agent === sourceAgentId);
}

export function evaluateTriggers(
  agents: AgentConfig[],
  sourceAgentId: string,
  status: CompletionStatus,
): AgentConfig[] {
  return agents.filter((agent) => {
    if (!agent.enabled) return false;

    if (status === 'completed') {
      return matchesTrigger(agent.on_complete, sourceAgentId);
    }

    if (status === 'failed') {
      return matchesTrigger(agent.on_failure, sourceAgentId);
    }

    return false;
  });
}
