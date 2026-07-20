import { randomUUID } from 'crypto';
import type { AgentConfig, TriggerRef } from './config.js';

type CompletionStatus = 'completed' | 'failed';

export type TriggerChain = {
  id: string;
  visitedAgentIds: readonly string[];
  depth: number;
};

export type SafeTrigger = {
  agent: AgentConfig;
  chain: TriggerChain;
};

/** Start ancestry tracking for a manually or externally launched agent. */
export function createTriggerChain(sourceAgentId: string, id: string = randomUUID()): TriggerChain {
  return {
    id,
    visitedAgentIds: [sourceAgentId],
    depth: 0,
  };
}

function refsForStatus(source: AgentConfig, status: CompletionStatus): TriggerRef[] {
  return (status === 'completed' ? source.on_complete : source.on_failure) ?? [];
}

/** Resolve trigger references as outgoing edges declared by the source agent. */
export function evaluateTriggers(
  agents: AgentConfig[],
  sourceAgentId: string,
  status: CompletionStatus,
): AgentConfig[] {
  const source = agents.find((agent) => agent.id === sourceAgentId);
  if (!source) return [];

  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const seenTargetIds = new Set<string>();

  return refsForStatus(source, status).flatMap((reference) => {
    if (seenTargetIds.has(reference.agent)) return [];
    seenTargetIds.add(reference.agent);

    const target = agentsById.get(reference.agent);
    return target?.enabled ? [target] : [];
  });
}

function childChain(
  chain: TriggerChain,
  targetAgentId: string,
  maxDepth: number,
): TriggerChain | undefined {
  const childDepth = chain.depth + 1;
  if (childDepth > maxDepth || chain.visitedAgentIds.includes(targetAgentId)) {
    return undefined;
  }

  return {
    id: chain.id,
    visitedAgentIds: [...chain.visitedAgentIds, targetAgentId],
    depth: childDepth,
  };
}

/** Resolve outgoing edges and attach branch-local ancestry to safe targets. */
export function evaluateSafeTriggers(
  agents: AgentConfig[],
  sourceAgentId: string,
  status: CompletionStatus,
  chain: TriggerChain,
  maxDepth: number,
): SafeTrigger[] {
  return evaluateTriggers(agents, sourceAgentId, status).flatMap((agent) => {
    const nextChain = childChain(chain, agent.id, maxDepth);
    return nextChain ? [{ agent, chain: nextChain }] : [];
  });
}
