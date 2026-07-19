import type { AgentConfig } from '../agents/config.js';
import type { ConnectionProfile } from './profile.js';
import { resolveConnectionProfile } from './profile-resolver.js';

const ENV_REFERENCE = /\$\{([A-Z][A-Z0-9_]*)}/g;
const RESOLVED_CONNECTION_CREDENTIALS = Symbol('resolved-connection-credentials');

type ResolvedAgentConfig = AgentConfig & {
  [RESOLVED_CONNECTION_CREDENTIALS]?: ReadonlyMap<string, ReadonlySet<string>>;
};

export class ConnectionBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectionBindingError';
  }
}

/**
 * Replaces or fills MCP transports from saved, opaque connection bindings.
 * Credential references stay symbolic here and are resolved only inside the
 * selected executor immediately before it starts the MCP transport.
 */
export function resolveAgentConnectionBindings(
  agent: AgentConfig,
  profiles: readonly ConnectionProfile[],
): AgentConfig {
  const bindings = agent.connection_bindings;
  if (!bindings || Object.keys(bindings).length === 0) return agent;

  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const servers = { ...(agent.mcp_servers ?? {}) };
  const credentialsByRuntime = new Map<string, ReadonlySet<string>>();

  for (const [runtimeName, connectionId] of Object.entries(bindings)) {
    const profile = profilesById.get(connectionId);
    if (!profile) {
      throw new ConnectionBindingError(
        `Saved connection for "${runtimeName}" is unavailable. Choose another connection in agent settings.`,
      );
    }
    const resolved = resolveConnectionProfile(profile);
    if (resolved.serverName !== runtimeName) {
      throw new ConnectionBindingError(
        `Saved connection for "${runtimeName}" has changed identity. Review this agent’s connection settings.`,
      );
    }
    servers[runtimeName] = resolved.config;
    credentialsByRuntime.set(
      runtimeName,
      new Set(profile.credentials.map((credential) => credential.environment_variable)),
    );
  }

  const resolvedAgent: ResolvedAgentConfig = { ...agent, mcp_servers: servers };
  Object.defineProperty(resolvedAgent, RESOLVED_CONNECTION_CREDENTIALS, {
    value: credentialsByRuntime,
    enumerable: false,
  });
  return resolvedAgent;
}

/** Resolves only variables reviewed as part of a saved connection profile. */
export function resolveSavedConnectionValues(
  agent: AgentConfig,
  runtimeName: string,
  values: Record<string, string>,
  source: Record<string, string | undefined> = process.env,
): Record<string, string> | undefined {
  const allowed = (agent as ResolvedAgentConfig)[RESOLVED_CONNECTION_CREDENTIALS]?.get(runtimeName);
  if (!allowed) return undefined;

  return Object.fromEntries(Object.entries(values).map(([target, value]) => [
    target,
    value.replace(ENV_REFERENCE, (_reference, variable: string) => {
      if (!allowed.has(variable)) {
        throw new ConnectionBindingError(
          `Environment variable ${variable} is not part of saved connection "${runtimeName}".`,
        );
      }
      const secret = source[variable];
      if (!secret) throw new ConnectionBindingError(`Saved connection "${runtimeName}" needs ${variable}.`);
      return secret;
    }),
  ]));
}
