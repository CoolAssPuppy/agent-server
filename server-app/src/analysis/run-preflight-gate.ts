import type { AgentConfig } from '../agents/config.js';
import type { PreflightResult } from './models.js';
import type { PreflightSkipRecorder } from './preflight-skip-recorder.js';
import {
  evaluateRunPreflight,
  type RunPreflightContext,
  type RunPreflightOutcome,
} from './run-preflight.js';

type DeniedOutcome = Extract<RunPreflightOutcome, { allowed: false }>;

export class RunPreflightDeniedError extends Error {
  constructor(readonly outcome: DeniedOutcome) {
    super(outcome.message);
    this.name = 'RunPreflightDeniedError';
  }
}

export function createRunPreflightGate<TriggerOptions>(dependencies: {
  preflight: (agent: AgentConfig) => Promise<PreflightResult>;
  trigger: (agent: AgentConfig, options: TriggerOptions) => string;
  skipRecorder: PreflightSkipRecorder;
  onAutomaticSkip?: (agent: AgentConfig, outcome: DeniedOutcome, runId: string) => void;
}) {
  return {
    async run(
      agent: AgentConfig,
      options: TriggerOptions,
      context: RunPreflightContext,
    ): Promise<string | undefined> {
      if (context.source === 'safe_test') return dependencies.trigger(agent, options);
      const preflight = await dependencies.preflight(agent);
      const outcome = evaluateRunPreflight(preflight, context);
      if (outcome.allowed) {
        dependencies.skipRecorder.clear(agent.id);
        return dependencies.trigger(agent, options);
      }
      if (context.source === 'manual') throw new RunPreflightDeniedError(outcome);
      const runId = dependencies.skipRecorder.record(agent, outcome, context.source);
      if (runId) dependencies.onAutomaticSkip?.(agent, outcome, runId);
      return undefined;
    },
  };
}
