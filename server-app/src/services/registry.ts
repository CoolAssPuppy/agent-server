import { createHash } from 'node:crypto';
import type { AgentConfig, McpServerConfig } from '../agents/config.js';
import {
  CAPABILITY_CATALOG,
  mcpServerKey,
  type CapabilityDefinition,
  type DiscoveredConnection,
} from '../agents/capabilities.js';

type EnvironmentSource = Record<string, string | undefined>;

export type ServiceConnectionStatus = 'connected' | 'needs_setup' | 'unavailable';
export type ServiceConnectionSource = 'account' | 'configured_api' | 'mcp' | 'macos';
export type ServiceAction = 'read' | 'write' | 'send' | 'delete';

export type NativeServiceAvailability = {
  id: string;
  name: string;
  status: ServiceConnectionStatus;
  actions: ServiceAction[];
};

export type ServiceConnection = {
  id: string;
  service_id: string;
  name: string;
  source: ServiceConnectionSource;
  status: ServiceConnectionStatus;
  actions: ServiceAction[];
};

export type ServiceRegistry = {
  connections: ServiceConnection[];
  runtimeConfigurations: ReadonlyMap<string, { serverName: string; config: McpServerConfig }>;
};

type RegistryInput = {
  agents: AgentConfig[];
  environment: EnvironmentSource;
  discovered: DiscoveredConnection[];
  nativeServices?: NativeServiceAvailability[];
};

const ENV_REFERENCE = /\$\{([A-Z][A-Z0-9_]*)}/g;

function catalogDefinition(name: string): CapabilityDefinition | undefined {
  return CAPABILITY_CATALOG.find((definition) => definition.kind === 'mcp' && (
    definition.match?.test(name) === true
    || definition.serverName === name
    || mcpServerKey(definition.serverName ?? definition.id) === mcpServerKey(name)
  ));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stableValue(entry)]));
}

function configurationId(serverName: string, config: McpServerConfig): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(stableValue(config)))
    .digest('hex')
    .slice(0, 16);
  return `mcp:${serverName}:${digest}`;
}

function environmentReferences(config: McpServerConfig): string[] {
  const values = 'command' in config ? Object.values(config.env ?? {}) : Object.values(config.headers ?? {});
  return values.flatMap((value) => [...value.matchAll(ENV_REFERENCE)].map((match) => match[1]));
}

function connectionStatus(config: McpServerConfig, environment: EnvironmentSource): ServiceConnectionStatus {
  return environmentReferences(config).every((name) => Boolean(environment[name]?.trim()))
    ? 'connected'
    : 'needs_setup';
}

function connectionName(serverName: string, serviceName: string): string {
  const tokens = serverName.toLowerCase().split(/[^a-z0-9]+/);
  if (tokens.includes('personal')) return `Personal ${serviceName}`;
  if (tokens.includes('work')) return `Work ${serviceName}`;
  return `${serviceName} connection`;
}

function configuredAgentConnections(
  agents: AgentConfig[],
  environment: EnvironmentSource,
): { connections: ServiceConnection[]; runtime: Map<string, { serverName: string; config: McpServerConfig }> } {
  const connections = new Map<string, ServiceConnection>();
  const runtime = new Map<string, { serverName: string; config: McpServerConfig }>();
  for (const agent of agents) {
    for (const [serverName, config] of Object.entries(agent.mcp_servers ?? {})) {
      const definition = catalogDefinition(serverName);
      const id = configurationId(serverName, config);
      if (connections.has(id)) continue;
      const serviceId = definition?.id ?? mcpServerKey(serverName).toLowerCase();
      const source = environmentReferences(config).length > 0 ? 'configured_api' : 'mcp';
      connections.set(id, {
        id,
        service_id: serviceId,
        name: connectionName(serverName, definition?.label ?? serverName),
        source,
        status: connectionStatus(config, environment),
        actions: ['read', 'write'],
      });
      runtime.set(id, { serverName, config });
    }
  }
  return { connections: [...connections.values()], runtime };
}

function configuredCatalogConnections(
  environment: EnvironmentSource,
  existing: ServiceConnection[],
): { connections: ServiceConnection[]; runtime: Map<string, { serverName: string; config: McpServerConfig }> } {
  const connections: ServiceConnection[] = [];
  const runtime = new Map<string, { serverName: string; config: McpServerConfig }>();
  for (const definition of CAPABILITY_CATALOG) {
    const required = definition.requiredEnv ?? [];
    if (definition.kind !== 'mcp' || required.length === 0) continue;
    if (!required.every((name) => Boolean(environment[name]?.trim()))) continue;
    if (existing.some((connection) => connection.service_id === definition.id && connection.source === 'configured_api')) {
      continue;
    }
    const config = definition.staticServer ?? (() => {
      const template = definition.remoteServer;
      const url = template ? environment[template.urlEnv]?.trim() : undefined;
      return template && url
        ? { type: template.type, url, ...(template.headers ? { headers: template.headers } : {}) }
        : undefined;
    })();
    if (!config) continue;
    const id = `catalog:${definition.id}`;
    connections.push({
      id,
      service_id: definition.id,
      name: definition.label,
      source: 'configured_api',
      status: 'connected',
      actions: ['read', 'write'],
    });
    runtime.set(id, { serverName: definition.serverName ?? definition.id, config });
  }
  return { connections, runtime };
}

function accountConnections(
  discovered: DiscoveredConnection[],
  existing: ServiceConnection[],
): ServiceConnection[] {
  return discovered.map((connection) => {
    const definition = catalogDefinition(connection.name);
    const serviceId = definition?.id ?? mcpServerKey(connection.name).toLowerCase();
    const hasPersonal = existing.some((candidate) => (
      candidate.service_id === serviceId && candidate.name.toLowerCase().startsWith('personal ')
    ));
    const baseName = definition?.label ?? connection.name.replace(/^claude\.ai\s+/i, '');
    return {
      id: `runtime:${encodeURIComponent(connection.name)}`,
      service_id: serviceId,
      name: hasPersonal ? `Work ${baseName}` : `${baseName} account`,
      source: 'account',
      status: connection.status === 'connected' ? 'connected' : 'needs_setup',
      actions: ['read', 'write'],
    };
  });
}

export function buildServiceRegistry(input: RegistryInput): ServiceRegistry {
  const configured = configuredAgentConnections(input.agents, input.environment);
  const catalog = configuredCatalogConnections(input.environment, configured.connections);
  const existing = [...configured.connections, ...catalog.connections];
  const accounts = accountConnections(input.discovered, existing);
  const native = (input.nativeServices ?? []).map((service): ServiceConnection => ({
    id: `macos:${service.id}`,
    service_id: service.id,
    name: service.name,
    source: 'macos',
    status: service.status,
    actions: service.actions,
  }));
  return {
    connections: [...existing, ...accounts, ...native],
    runtimeConfigurations: new Map([...configured.runtime, ...catalog.runtime]),
  };
}
