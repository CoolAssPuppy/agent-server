import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  classifyStoredMcpCapabilities,
  type ConnectionCapabilitySnapshot,
} from './capability-snapshot.js';
import type { ConnectionProfile } from './profile.js';

type EnvironmentSource = Record<string, string | undefined>;
type DiscoveredOperation = { name: string; inputFields: string[] };
type OperationLoader = (
  profile: ConnectionProfile,
  credentials: Record<string, string>,
  timeoutMs: number,
) => Promise<DiscoveredOperation[]>;

type CapabilityProbeOptions = {
  timeoutMs?: number;
  now?: () => string;
  loadOperations?: OperationLoader;
};

function credentialById(profile: ConnectionProfile): Map<string, string> {
  return new Map(profile.credentials.map((credential) => [
    credential.id,
    credential.environment_variable,
  ]));
}

/** Resolves reviewed credential references without retaining them in the snapshot. */
export function resolveProfileCredentials(
  profile: ConnectionProfile,
  environment: EnvironmentSource,
): Record<string, string> {
  const variables = credentialById(profile);
  const resolveValue = (credentialId: string): string => {
    const variable = variables.get(credentialId);
    if (!variable) throw new Error(`${profile.label} has an invalid credential reference.`);
    const value = environment[variable]?.trim();
    if (!value) throw new Error(`${profile.label} needs ${variable}.`);
    return value;
  };
  if (profile.transport.kind === 'mcp_stdio') {
    return Object.fromEntries(Object.entries(profile.transport.environment).map(([name, id]) => [
      name,
      resolveValue(id),
    ]));
  }
  if (profile.transport.kind === 'runtime_account') return {};
  return Object.fromEntries(profile.transport.headers.map((header) => [
    header.name,
    `${header.prefix}${resolveValue(header.credential_id)}`,
  ]));
}

function authenticatedFetch(credentials: Record<string, string>): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    for (const [name, value] of Object.entries(credentials)) headers.set(name, value);
    return fetch(input, { ...init, headers });
  };
}

function profileTransport(
  profile: ConnectionProfile,
  credentials: Record<string, string>,
): Transport {
  switch (profile.transport.kind) {
    case 'mcp_stdio':
      return new StdioClientTransport({
        command: profile.transport.command,
        args: profile.transport.args,
        env: { ...getDefaultEnvironment(), ...credentials },
        stderr: 'pipe',
      });
    case 'mcp_http':
      return new StreamableHTTPClientTransport(new URL(profile.transport.url), {
        fetch: authenticatedFetch(credentials),
      });
    case 'mcp_sse':
      return new SSEClientTransport(new URL(profile.transport.url), {
        fetch: authenticatedFetch(credentials),
      });
    case 'runtime_account':
      throw new Error(`${profile.label} is checked through its ${profile.transport.executor} runtime.`);
  }
}

function schemaRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function localSchemaReference(root: Record<string, unknown>, reference: string): unknown {
  if (!reference.startsWith('#/')) return undefined;
  return reference.slice(2).split('/').reduce<unknown>((current, encodedSegment) => {
    const record = schemaRecord(current);
    if (!record) return undefined;
    const segment = encodedSegment.replaceAll('~1', '/').replaceAll('~0', '~');
    return record[segment];
  }, root);
}

/** Lists bounded top-level and nested argument paths declared by an MCP input schema. */
export function inputFieldPaths(inputSchema: unknown): string[] {
  const root = schemaRecord(inputSchema);
  if (!root) return [];
  const fields = new Set<string>();
  const activeReferences = new Set<string>();

  const visit = (value: unknown, prefix: string, depth: number): void => {
    if (depth > 16 || fields.size >= 256) return;
    const schema = schemaRecord(value);
    if (!schema) return;
    const reference = typeof schema.$ref === 'string' ? schema.$ref : undefined;
    if (reference && !activeReferences.has(reference)) {
      activeReferences.add(reference);
      visit(localSchemaReference(root, reference), prefix, depth + 1);
      activeReferences.delete(reference);
    }
    const properties = schemaRecord(schema.properties);
    for (const [name, child] of Object.entries(properties ?? {})) {
      const path = prefix ? `${prefix}.${name}` : name;
      fields.add(path);
      visit(child, path, depth + 1);
    }
    for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
      const alternatives = schema[keyword];
      if (Array.isArray(alternatives)) {
        for (const alternative of alternatives) visit(alternative, prefix, depth + 1);
      }
    }
    if (schema.items) visit(schema.items, prefix, depth + 1);
  };

  visit(root, '', 0);
  return [...fields].sort();
}

async function loadMcpOperations(
  profile: ConnectionProfile,
  credentials: Record<string, string>,
  timeoutMs: number,
): Promise<DiscoveredOperation[]> {
  const client = new Client(
    { name: 'agent-server-connection-check', version: '1.0.0' },
    { capabilities: {} },
  );
  try {
    await client.connect(profileTransport(profile, credentials), { timeout: timeoutMs });
    const operations: DiscoveredOperation[] = [];
    let cursor: string | undefined;
    do {
      const response = await client.listTools(cursor ? { cursor } : undefined, { timeout: timeoutMs });
      operations.push(...response.tools.map(({ name, inputSchema }) => ({
        name,
        inputFields: inputFieldPaths(inputSchema),
      })));
      if (operations.length > 512) throw new Error('MCP tool inventory exceeds 512 operations.');
      cursor = response.nextCursor;
    } while (cursor);
    return operations;
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** Connects to one saved MCP service and records its current concrete inventory. */
export async function probeStoredMcpCapabilities(
  profile: ConnectionProfile,
  environment: EnvironmentSource,
  options: CapabilityProbeOptions = {},
): Promise<ConnectionCapabilitySnapshot> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const credentials = resolveProfileCredentials(profile, environment);
  const operations = await (options.loadOperations ?? loadMcpOperations)(
    profile,
    credentials,
    timeoutMs,
  );
  const names = new Set<string>();
  for (const operation of operations) {
    if (names.has(operation.name)) throw new Error(`Duplicate MCP tool name: ${operation.name}`);
    names.add(operation.name);
  }
  return classifyStoredMcpCapabilities(profile, {
    capturedAt: options.now?.() ?? new Date().toISOString(),
    operations,
  });
}
