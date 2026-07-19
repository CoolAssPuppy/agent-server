import type { AgentConfig } from '../agents/config.js';
import type { ExecutorFn } from '../execution/executor-registry.js';
import type { ConnectionProfile } from './profile.js';
import { resolveAgentConnectionBindings } from './runtime-resolution.js';

type ConnectionProfileSource = {
  list: () => Promise<ConnectionProfile[]>;
};

type ExecutorResolver = (agent: AgentConfig) => ExecutorFn;

/** Builds an executor that refreshes saved connection profiles for every run. */
export function createConnectionResolvingExecutor(
  profiles: ConnectionProfileSource,
  resolveExecutor: ExecutorResolver,
): ExecutorFn {
  return async (agent, reporter, options) => {
    const hasBindings = agent.connection_bindings
      && Object.keys(agent.connection_bindings).length > 0;
    const resolvedAgent = hasBindings
      ? resolveAgentConnectionBindings(agent, await profiles.list())
      : agent;
    return resolveExecutor(resolvedAgent)(resolvedAgent, reporter, options);
  };
}
