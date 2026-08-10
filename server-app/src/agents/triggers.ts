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

/** A downstream agent that was declared but will not fire, and why. */
export type RefusedTrigger = {
  agent: AgentConfig;
  reason: 'depth_limit' | 'cycle';
};

export type SafeTriggerEvaluation = {
  fired: SafeTrigger[];
  /**
   * Refusals used to be silent: a chain that hit its depth cap or looped
   * simply had its tail never happen, with nothing anywhere saying so.
   */
  refused: RefusedTrigger[];
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
): SafeTriggerEvaluation {
  const fired: SafeTrigger[] = [];
  const refused: RefusedTrigger[] = [];

  for (const agent of evaluateTriggers(agents, sourceAgentId, status)) {
    const nextChain = childChain(chain, agent.id, maxDepth);
    if (nextChain) {
      fired.push({ agent, chain: nextChain });
    } else {
      refused.push({
        agent,
        reason: chain.visitedAgentIds.includes(agent.id) ? 'cycle' : 'depth_limit',
      });
    }
  }

  return { fired, refused };
}
