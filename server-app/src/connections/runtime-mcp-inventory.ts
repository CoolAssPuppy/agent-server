import { execFileSync } from 'child_process';
import { readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { McpServerInfo } from '../execution/executor.js';
import type { RuntimePaths } from '../execution/runtime-discovery.js';
import { buildCodexChildEnvironment } from '../agents/environment-policy.js';

export type RuntimeMcpStatus =
  | 'connected'
  | 'needs_auth'
  | 'configured'
  | 'disabled'
  | 'failed'
  | 'pending'
  | 'unknown';

export type RuntimeMcpServer = {
  name: string;
  status: RuntimeMcpStatus;
};

export type RuntimeConnectionInventory = {
  id: 'claude-code' | 'codex' | 'kimi-code';
  label: string;
  installed: boolean;
  authentication: 'unknown';
  mcp_servers: RuntimeMcpServer[];
  mcp_inventory_state: 'not_checked' | 'ready' | 'failed' | 'unavailable';
  mcp_evidence: 'runtime_status' | 'configuration';
};

type InventoryInput = {
  paths: RuntimePaths;
  claudeServers: McpServerInfo[];
  claudeState?: 'not_checked' | 'ready' | 'failed';
  codexServers: RuntimeMcpServer[] | undefined;
  kimiServers: RuntimeMcpServer[] | undefined;
  codexState?: RuntimeConnectionInventory['mcp_inventory_state'];
  kimiState?: RuntimeConnectionInventory['mcp_inventory_state'];
};

const MAX_SERVERS = 200;
const MAX_NAME_LENGTH = 160;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function boundedName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const printable = Array.from(value, (character) => (
    character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character
  )).join('');
  const trimmed = printable.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed.slice(0, MAX_NAME_LENGTH) : undefined;
}

export function parseCodexMcpInventory(value: unknown): RuntimeMcpServer[] {
  if (!Array.isArray(value)) return [];
  const projected = value.slice(0, MAX_SERVERS).flatMap((candidate) => {
    const item = record(candidate);
    const name = boundedName(item?.name);
    if (!item || !name) return [];
    const isEnabled = item.enabled !== false;
    const authStatus = typeof item.auth_status === 'string' ? item.auth_status : '';
    const status: RuntimeMcpStatus = !isEnabled
      ? 'disabled'
      : authStatus === 'not_logged_in' ? 'needs_auth' : 'configured';
    return [{ name, status }];
  });
  return stableUnique(projected);
}

export function parseKimiMcpInventory(value: unknown): RuntimeMcpServer[] {
  const root = record(value);
  const servers = record(root?.mcpServers);
  if (!servers) return [];
  const projected = Object.entries(servers).slice(0, MAX_SERVERS).flatMap(([rawName, candidate]) => {
    const name = boundedName(rawName);
    const config = record(candidate);
    if (!name || !config) return [];
    const status: RuntimeMcpStatus = config.enabled === false ? 'disabled' : 'configured';
    return [{ name, status }];
  });
  return stableUnique(projected);
}

export function discoverCodexMcpInventory(executablePath?: string): RuntimeMcpServer[] | undefined {
  if (!executablePath) return [];
  try {
    const output = execFileSync(executablePath, ['mcp', 'list', '--json'], {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 1_048_576,
      env: buildCodexChildEnvironment(),
    });
    return parseCodexMcpInventory(JSON.parse(output) as unknown);
  } catch {
    return undefined;
  }
}

export function discoverKimiMcpInventory(
  executablePath?: string,
  environment: Record<string, string | undefined> = process.env,
): RuntimeMcpServer[] | undefined {
  if (!executablePath) return [];
  const root = environment.KIMI_CODE_HOME ?? join(homedir(), '.kimi-code');
  const configPath = join(root, 'mcp.json');
  try {
    if (statSync(configPath).size > 1_048_576) return undefined;
    return parseKimiMcpInventory(JSON.parse(readFileSync(configPath, 'utf8')) as unknown);
  } catch (error) {
    const code = record(error)?.code;
    return code === 'ENOENT' ? [] : undefined;
  }
}

export function runtimeConnectionInventory(input: InventoryInput): RuntimeConnectionInventory[] {
  return [
    runtime(
      'claude-code',
      'Claude Code',
      input.paths.claudeExecutablePath,
      input.claudeServers.map(({ name, status }) => ({ name, status: claudeStatus(status) })),
      input.claudeState ?? 'ready',
      'runtime_status',
    ),
    runtime(
      'codex',
      'Codex',
      input.paths.codexExecutablePath,
      input.codexServers,
      input.codexState ?? (input.codexServers ? 'ready' : 'failed'),
      'configuration',
    ),
    runtime(
      'kimi-code',
      'Kimi Code',
      input.paths.kimiExecutablePath,
      input.kimiServers,
      input.kimiState ?? (input.kimiServers ? 'ready' : 'failed'),
      'configuration',
    ),
  ];
}

function runtime(
  id: RuntimeConnectionInventory['id'],
  label: string,
  executablePath: string | undefined,
  servers: RuntimeMcpServer[] | undefined,
  inventoryState: RuntimeConnectionInventory['mcp_inventory_state'],
  evidence: RuntimeConnectionInventory['mcp_evidence'],
): RuntimeConnectionInventory {
  const isInstalled = executablePath !== undefined;
  return {
    id,
    label,
    installed: isInstalled,
    authentication: 'unknown',
    mcp_servers: stableUnique(servers ?? []),
    mcp_inventory_state: isInstalled ? inventoryState : 'unavailable',
    mcp_evidence: evidence,
  };
}

function stableUnique(servers: RuntimeMcpServer[]): RuntimeMcpServer[] {
  const byName = new Map<string, RuntimeMcpServer>();
  for (const server of servers) {
    if (!byName.has(server.name)) byName.set(server.name, server);
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function claudeStatus(status: string): RuntimeMcpStatus {
  switch (status) {
  case 'connected': return 'connected';
  case 'needs-auth': return 'needs_auth';
  case 'disabled': return 'disabled';
  case 'failed': return 'failed';
  case 'pending': return 'pending';
  default: return 'unknown';
  }
}
