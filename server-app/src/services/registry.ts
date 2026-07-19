import { createHash } from 'node:crypto';
import type { AgentConfig, McpServerConfig } from '../agents/config.js';
import { areApprovedMcpReferences, mcpCredentialOwner } from '../agents/environment-policy.js';
import {
  CAPABILITY_CATALOG,
  mcpServerKey,
  type CapabilityDefinition,
  type DiscoveredConnection,
} from '../agents/capabilities.js';

type EnvironmentSource = Record<string, string | undefined>;
export type ServiceRuntimeBinding = { serverName: string; config?: McpServerConfig };

export type ServiceConnectionStatus = 'connected' | 'needs_setup' | 'unavailable' | 'conflict';
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
  actions_known: boolean;
  required_env: string[];
};

export type ServiceRegistry = {
  connections: ServiceConnection[];
  bindings: ReadonlyMap<string, ServiceRuntimeBinding>;
};

type RegistryInput = {
  agents: AgentConfig[];
  environment: EnvironmentSource;
  discovered: DiscoveredConnection[];
  nativeServices?: NativeServiceAvailability[];
};

const ENV_REFERENCE = /\$\{([A-Z][A-Z0-9_]*)}/g;

const CATALOG_ACTIONS: Readonly<Record<string, ServiceAction[]>> = {
  notion: ['read', 'write'],
  slack: ['read', 'send'],
  linear: ['read', 'write'],
  gmail: ['read', 'send'],
  tripmaster: ['read', 'write'],
  calorienerds: ['read', 'write'],
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stableValue(entry)]));
}

function safeDisplayName(value: string, maxLength = 120): string {
  return value.replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function safeIdentifier(value: string, maxLength = 72): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, maxLength);
}

function stableDigest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex')
    .slice(0, 16);
}

function configurationId(serverName: string, config: McpServerConfig): string {
  const digest = stableDigest({ serverName, config });
  return `mcp:${safeIdentifier(serverName) || 'connection'}:${digest}`;
}

function runtimeConnectionId(name: string): string {
  const encoded = encodeURIComponent(name);
  if (encoded.length <= 180 && safeDisplayName(name) === name) return `runtime:${encoded}`;
  const digest = createHash('sha256').update(name).digest('hex').slice(0, 16);
  return `runtime:${encodeURIComponent(safeDisplayName(name, 80))}:${digest}`;
}

function credentialValues(config: McpServerConfig): string[] {
  return 'command' in config ? Object.values(config.env ?? {}) : Object.values(config.headers ?? {});
}

function environmentReferences(config: McpServerConfig): string[] {
  return credentialValues(config)
    .flatMap((value) => [...value.matchAll(ENV_REFERENCE)].map((match) => match[1]));
}

function hasOnlyReferencedCredentials(config: McpServerConfig): boolean {
  return credentialValues(config).every((value) => {
    const references = [...value.matchAll(ENV_REFERENCE)];
    const fixedText = value.replace(ENV_REFERENCE, '').trim();
    return references.length > 0 && /^(?:Bearer|Basic|Token)?$/i.test(fixedText);
  });
}

function isReusableConfiguration(
  serverName: string,
  config: McpServerConfig,
  environment: EnvironmentSource,
): boolean {
  if (!hasOnlyReferencedCredentials(config)) return false;
  const values = 'command' in config ? config.env : config.headers;
  if (!values || environmentReferences(config).length === 0) return true;
  return areApprovedMcpReferences(mcpCredentialOwner(serverName, config), values, environment);
}

function connectionStatus(config: McpServerConfig, environment: EnvironmentSource): ServiceConnectionStatus {
  return environmentReferences(config).every((name) => Boolean(environment[name]?.trim()))
    ? 'connected'
    : 'needs_setup';
}

function transportMatches(definition: CapabilityDefinition, config: McpServerConfig): boolean {
  const canonical = definition.staticServer;
  if (canonical && 'command' in canonical && 'command' in config) {
    return canonical.command === config.command
      && JSON.stringify(canonical.args ?? []) === JSON.stringify(config.args ?? []);
  }
  if (canonical && !('command' in canonical) && !('command' in config)) {
    return canonical.type === config.type && canonical.url === config.url;
  }
  return false;
}

function configuredDefinition(config: McpServerConfig): CapabilityDefinition | undefined {
  return CAPABILITY_CATALOG.find((definition) => definition.kind === 'mcp' && transportMatches(definition, config));
}

function discoveredDefinition(name: string): CapabilityDefinition | undefined {
  return CAPABILITY_CATALOG.find((definition) => definition.kind === 'mcp' && (
    definition.serverName === name
    || mcpServerKey(definition.serverName ?? definition.id) === mcpServerKey(name)
    || definition.match?.test(name) === true
  ));
}

function connectionName(serverName: string, serviceName: string): string {
  const tokens = serverName.toLowerCase().split(/[^a-z0-9]+/);
  if (tokens.includes('personal')) return `Personal ${serviceName}`;
  if (tokens.includes('work')) return `Work ${serviceName}`;
  return `${safeDisplayName(serviceName)} connection`.slice(0, 160);
}

function customServiceId(serverName: string): string {
  return `custom:${safeIdentifier(serverName) || 'connection'}`;
}

function configuredAgentConnections(
  agents: AgentConfig[],
  environment: EnvironmentSource,
): { connections: ServiceConnection[]; runtime: Map<string, ServiceRuntimeBinding> } {
  const candidates = new Map<string, { connection: ServiceConnection; runtime: ServiceRuntimeBinding }>();
  const idsByServerName = new Map<string, Set<string>>();

  for (const agent of agents) {
    for (const [serverName, config] of Object.entries(agent.mcp_servers ?? {})) {
      if (!isReusableConfiguration(serverName, config, environment)) continue;
      const id = configurationId(serverName, config);
      if (candidates.has(id)) continue;
      const definition = configuredDefinition(config);
      const actions = definition ? (CATALOG_ACTIONS[definition.id] ?? []) : [];
      const label = definition?.label ?? safeDisplayName(serverName.replaceAll(/[-_]+/g, ' '));
      candidates.set(id, {
        connection: {
          id,
          service_id: definition?.id ?? customServiceId(serverName),
          name: connectionName(serverName, label),
          source: environmentReferences(config).length > 0 ? 'configured_api' : 'mcp',
          status: definition ? connectionStatus(config, environment) : 'unavailable',
          actions,
          actions_known: Boolean(definition),
          required_env: environmentReferences(config),
        },
        runtime: { serverName, config },
      });
      const serverIds = idsByServerName.get(serverName) ?? new Set<string>();
      serverIds.add(id);
      idsByServerName.set(serverName, serverIds);
    }
  }

  const runtime = new Map<string, ServiceRuntimeBinding>();
  const connections = [...candidates.values()].map(({ connection, runtime: binding }) => {
    if ((idsByServerName.get(binding.serverName)?.size ?? 0) > 1) {
      return { ...connection, status: 'conflict' as const };
    }
    if (connection.status !== 'unavailable') runtime.set(connection.id, binding);
    return connection;
  });
  return { connections, runtime };
}

function catalogConfiguration(
  definition: CapabilityDefinition,
  environment: EnvironmentSource,
): McpServerConfig | undefined {
  if (definition.staticServer) return definition.staticServer;
  const template = definition.remoteServer;
  const url = template ? environment[template.urlEnv]?.trim() : undefined;
  return template && url
    ? { type: template.type, url, ...(template.headers ? { headers: template.headers } : {}) }
    : undefined;
}

function configuredCatalogConnections(
  environment: EnvironmentSource,
  occupiedIds: ReadonlySet<string>,
): { connections: ServiceConnection[]; runtime: Map<string, ServiceRuntimeBinding> } {
  const connections: ServiceConnection[] = [];
  const runtime = new Map<string, ServiceRuntimeBinding>();
  for (const definition of CAPABILITY_CATALOG) {
    if (definition.kind !== 'mcp' || definition.builtin) continue;
    const config = catalogConfiguration(definition, environment);
    const id = definition.remoteServer && config
      ? `catalog:${definition.id}:${stableDigest(config)}`
      : `catalog:${definition.id}`;
    if (occupiedIds.has(id)) continue;
    const required = definition.requiredEnv ?? [];
    const isReady = definition.auth !== 'oauth'
      && required.every((name) => Boolean(environment[name]?.trim()));
    const actions = CATALOG_ACTIONS[definition.id] ?? [];
    connections.push({
      id,
      service_id: definition.id,
      name: definition.label,
      source: 'configured_api',
      status: config && isReady ? 'connected' : 'needs_setup',
      actions,
      actions_known: actions.length > 0,
      required_env: required,
    });
    if (config) runtime.set(id, { serverName: definition.serverName ?? definition.id, config });
  }
  return { connections, runtime };
}

function runtimeStatus(status: string): ServiceConnectionStatus {
  if (status === 'connected') return 'connected';
  if (status === 'failed' || status === 'disabled') return 'unavailable';
  return 'needs_setup';
}

function accountConnections(discovered: DiscoveredConnection[]): ServiceConnection[] {
  return discovered.map((connection) => {
    const definition = discoveredDefinition(connection.name);
    const serviceId = definition?.id ?? customServiceId(connection.name);
    const actions = definition ? (CATALOG_ACTIONS[definition.id] ?? []) : [];
    const baseName = definition?.label ?? safeDisplayName(connection.name.replace(/^claude\.ai\s+/i, ''));
    return {
      id: runtimeConnectionId(connection.name),
      service_id: serviceId,
      name: definition ? `${baseName} (Claude account)` : `${baseName} account`,
      source: 'account',
      status: runtimeStatus(connection.status),
      actions,
      actions_known: Boolean(definition),
      required_env: [],
    };
  });
}

export function buildServiceRegistry(input: RegistryInput): ServiceRegistry {
  const configured = configuredAgentConnections(input.agents, input.environment);
  const catalog = configuredCatalogConnections(input.environment, new Set(configured.connections.map(({ id }) => id)));
  const accounts = accountConnections(input.discovered);
  const accountBindings = accounts.map((connection, index) => {
    const discoveredName = input.discovered[index]?.name ?? '';
    return [connection.id, { serverName: discoveredName }] as const;
  });
  const native = (input.nativeServices ?? []).map((service): ServiceConnection => ({
    id: `macos:${service.id}`,
    service_id: service.id,
    name: service.name,
    source: 'macos',
    status: service.status,
    actions: service.actions,
    actions_known: true,
    required_env: [],
  }));
  return {
    connections: [...configured.connections, ...catalog.connections, ...accounts, ...native],
    bindings: new Map([...configured.runtime, ...catalog.runtime, ...accountBindings]),
  };
}
