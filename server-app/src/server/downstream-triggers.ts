import type { AgentConfig } from '../agents/config.js';
import {
  createTriggerChain,
  evaluateSafeTriggers,
  type TriggerChain,
} from '../agents/triggers.js';

type DownstreamTriggerDependencies = {
  discover: () => Promise<AgentConfig[]>;
  trigger: (agent: AgentConfig, chain: TriggerChain) => Promise<void> | void;
  maxDepth: number;
  log?: (message: string) => void;
  logError?: (message: string, error: unknown) => void;
};

export type DownstreamTriggerHandler = (
  sourceAgent: AgentConfig,
  status: 'completed' | 'failed' | 'skipped',
  existingChain?: TriggerChain,
) => Promise<void>;

/** Builds the production terminal hook for bounded outgoing agent triggers. */
export function createDownstreamTriggerHandler(
  dependencies: DownstreamTriggerDependencies,
): DownstreamTriggerHandler {
  const log = dependencies.log ?? console.log;
  const logError = dependencies.logError ?? console.error;

  return async (sourceAgent, status, existingChain) => {
    if (status === 'skipped') return;

    try {
      const agents = await dependencies.discover();
      const chain = existingChain ?? createTriggerChain(sourceAgent.id);
      const targets = evaluateSafeTriggers(
        agents,
        sourceAgent.id,
        status,
        chain,
        dependencies.maxDepth,
      );
      for (const target of targets) {
        log(`[triggers] ${status} ${sourceAgent.id} -> triggering ${target.agent.id}`);
        await dependencies.trigger(target.agent, target.chain);
      }
    } catch (error) {
      logError(`[triggers] Failed to evaluate triggers for ${sourceAgent.id}:`, error);
    }
  };
}
