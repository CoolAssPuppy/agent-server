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
  /**
   * Called for each declared downstream agent that will not fire, so the
   * refusal lands in run history instead of being the part of the chain
   * that silently never happens.
   */
  onRefused?: (agent: AgentConfig, reason: 'depth_limit' | 'cycle', sourceAgentId: string) => void;
  log?: (message: string) => void;
  logError?: (message: string, error: unknown) => void;
};

type DownstreamTriggerHandler = (
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

    let targets: ReturnType<typeof evaluateSafeTriggers>['fired'];
    try {
      const agents = await dependencies.discover();
      const chain = existingChain ?? createTriggerChain(sourceAgent.id);
      const evaluation = evaluateSafeTriggers(
        agents,
        sourceAgent.id,
        status,
        chain,
        dependencies.maxDepth,
      );
      targets = evaluation.fired;
      for (const refusal of evaluation.refused) {
        log(`[triggers] ${sourceAgent.id} -> ${refusal.agent.id} refused (${refusal.reason})`);
        dependencies.onRefused?.(refusal.agent, refusal.reason, sourceAgent.id);
      }
    } catch (error) {
      logError(`[triggers] Failed to evaluate triggers for ${sourceAgent.id}:`, error);
      return;
    }

    for (const target of targets) {
      log(`[triggers] ${status} ${sourceAgent.id} -> triggering ${target.agent.id}`);
      try {
        await dependencies.trigger(target.agent, target.chain);
      } catch (error) {
        logError(
          `[triggers] Failed to trigger ${target.agent.id} from ${sourceAgent.id}:`,
          error,
        );
      }
    }
  };
}
