import type { AgentConfig } from './config.js';
import type { RuntimeAssignment } from './runtime-assignment.js';

/** Applies a machine-local runtime choice without changing the shareable agent definition. */
export function applyRuntimeAssignment(
  agent: AgentConfig,
  assignment: RuntimeAssignment | undefined,
): AgentConfig {
  if (!assignment) return agent;
  return {
    ...agent,
    executor: assignment.executor,
    model: assignment.model,
    provider: assignment.provider,
  };
}
