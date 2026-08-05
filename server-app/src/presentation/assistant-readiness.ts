import type { AgentConfig } from '../agents/config.js';
import { mcpServerKey } from '../agents/capabilities.js';
import type { RuntimePaths } from '../execution/runtime-discovery.js';
import { inlineConnectionId, type ServiceConnection, type ServiceRegistry } from '../services/registry.js';
import type {
  AssistantConnectionFact,
  AssistantHomeFacts,
  AssistantPathFact,
} from './assistant-home.js';
import { safeTestSupport } from '../creation/safe-test-support.js';

export type PathInspection = Omit<AssistantPathFact, 'path'>;

export type AssistantFactsInput = {
  agent: AgentConfig;
  runtimePaths: RuntimePaths;
  registry: ServiceRegistry;
  inspectPath: (path: string) => PathInspection;
};

function runtimeAvailable(agent: AgentConfig, runtimePaths: RuntimePaths): boolean {
  switch (agent.executor ?? 'claude-code') {
    case 'claude-code':
      return Boolean(runtimePaths.claudeExecutablePath);
    case 'codex':
      return Boolean(runtimePaths.codexExecutablePath);
    case 'kimi-code':
      return Boolean(runtimePaths.kimiExecutablePath);
  }
}

function pathsToCheck(agent: AgentConfig): string[] {
  if (agent.file_access?.length) {
    return [...new Set(agent.file_access.map(({ path }) => path))];
  }
  return agent.working_directory ? [agent.working_directory] : [];
}

function statusForConnection(connection: ServiceConnection): AssistantConnectionFact['status'] {
  if (connection.status === 'needs_setup') return 'needs_setup';
  if (connection.status === 'unavailable' || connection.status === 'conflict') return 'unavailable';
  return connection.source === 'account' || connection.source === 'macos' ? 'ready' : 'unknown';
}

function savedConnectionFacts(
  agent: AgentConfig,
  registry: ServiceRegistry,
): AssistantConnectionFact[] {
  return Object.entries(agent.connection_bindings ?? {}).map(([runtimeName, id]) => {
    const connection = registry.connections.find((candidate) => candidate.id === id);
    return {
      id,
      label: connection?.name ?? runtimeName.replaceAll(/[-_]+/g, ' '),
      status: connection ? statusForConnection(connection) : 'unavailable',
      sourceReference: `agent.connection_bindings.${runtimeName}`,
    };
  });
}

function configuredInlineFacts(
  agent: AgentConfig,
  registry: ServiceRegistry,
): AssistantConnectionFact[] {
  return Object.entries(agent.mcp_servers ?? {}).flatMap(([runtimeName, config]): AssistantConnectionFact[] => {
    if (agent.connection_bindings?.[runtimeName]) return [];
    const bound = registry.connections
      .filter((candidate) => registry.bindings.get(candidate.id)?.serverName === runtimeName)
      .sort((left, right) => left.id.localeCompare(right.id));
    // The catalog holds a placeholder for every known service, bound to the
    // same server name an agent may choose. For an OAuth service that
    // placeholder is permanently "needs setup", so preferring it over the
    // connection built from this agent's own entry reports a working server as
    // unconfigured. Ask the registry which connection is this agent's.
    const ownId = inlineConnectionId(runtimeName, config);
    const connection = bound.find((candidate) => candidate.id === ownId) ?? bound[0];
    return [{
      id: connection?.id ?? `inline:${runtimeName}`,
      label: connection?.name ?? runtimeName.replaceAll(/[-_]+/g, ' '),
      status: connection ? statusForConnection(connection) : 'unknown',
      sourceReference: `agent.mcp_servers.${runtimeName}`,
    }];
  });
}

type AccountRule = { serverName: string; sourceReference: string };

function accountRules(agent: AgentConfig): AccountRule[] {
  const groups: Array<{ rules: readonly string[]; sourceReference: string }> = [
    { rules: agent.permissions?.allow ?? [], sourceReference: 'agent.permissions.allow' },
    { rules: agent.tools, sourceReference: 'agent.tools' },
  ];
  const found = groups.flatMap(({ rules, sourceReference }) => rules.flatMap((rule): AccountRule[] => {
    const match = /^mcp__(claude_ai_[A-Za-z0-9_]+?)(?:__|$)/.exec(rule);
    return match?.[1] ? [{ serverName: match[1], sourceReference }] : [];
  }));
  return [...new Map(found.map((rule) => [rule.serverName, rule])).values()];
}

function accountConnectionFacts(
  agent: AgentConfig,
  registry: ServiceRegistry,
): AssistantConnectionFact[] {
  return accountRules(agent).map(({ serverName, sourceReference }) => {
    // A connector's runtime name is its display name ("claude.ai Notion"),
    // while a tool rule carries the sanitized spelling ("claude_ai_Notion").
    // Compare on the same key the registry uses, or every connector with a
    // space or dot in its name reads as unconnected.
    const entry = registry.connections.find((connection) => {
      const binding = registry.bindings.get(connection.id)?.serverName;
      return connection.source === 'account'
        && binding !== undefined
        && mcpServerKey(binding) === mcpServerKey(serverName);
    });
    return {
      id: entry?.id ?? `account:${serverName}`,
      label: entry?.name ?? serverName.replace(/^claude_ai_/, '').replaceAll('_', ' '),
      status: entry ? statusForConnection(entry) : 'needs_setup',
      sourceReference,
    };
  });
}

/**
 * Collect only local facts that existing Server probes can prove. Credential
 * presence is setup evidence, not provider-health or authentication evidence.
 */
export function collectAssistantHomeFacts(input: AssistantFactsInput): AssistantHomeFacts {
  const isRuntimeAvailable = runtimeAvailable(input.agent, input.runtimePaths);
  return {
    engine: {
      runtimeAvailable: isRuntimeAvailable,
      authentication: isRuntimeAvailable ? 'unknown' : 'unavailable',
    },
    paths: pathsToCheck(input.agent).map((path) => ({ path, ...input.inspectPath(path) })),
    connections: [
      ...savedConnectionFacts(input.agent, input.registry),
      ...accountConnectionFacts(input.agent, input.registry),
      ...configuredInlineFacts(input.agent, input.registry),
    ],
    ...(input.agent.output ? {
      destination: { configured: true, verified: 'unknown' as const },
    } : {}),
    canEnforceSafeTest: safeTestSupport(input.agent).available,
  };
}
