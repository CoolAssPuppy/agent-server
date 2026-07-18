import type { AgentConfig, McpServerConfig } from './config.js';
import { isToolAllowed } from '../execution/permissions.js';

/**
 * The capability catalog is the translation layer between agent YAML
 * (tools, disallowed_tools, mcp_servers) and the consumer-facing UI
 * ("Can read your files", "Can access Notion"). The UI never speaks
 * YAML field names; it toggles capabilities by id and the server maps
 * each toggle onto the underlying fields.
 *
 * Semantics:
 * - A tool-kind capability is enabled when any of its tools is effectively
 *   allowed: not in `disallowed_tools`, and either the `tools` allowlist is
 *   empty (unrestricted) or the tool is listed.
 * - An MCP-kind capability is enabled when its server entry exists (or is
 *   builtin, like eventkit), the server-level rule `mcp__<name>` is not in
 *   `disallowed_tools`, and a non-empty `tools` allowlist covers the server.
 * - Disabling never deletes configuration. Tool capabilities are disabled by
 *   adding their tools to `disallowed_tools` (deny wins in the SDK); MCP
 *   capabilities by adding the server-level `mcp__<name>` rule. This keeps
 *   every toggle reversible and hand-written YAML intact.
 * - A `permissions` block is deliberately not consulted or modified here;
 *   agents using it are power-user territory handled via the raw editor.
 */

export type CapabilityKind = 'tools' | 'mcp';

/**
 * How a connection authenticates, so the app can pick the right Connect flow:
 * - `none`   -- no credentials (local tools, builtin eventkit).
 * - `api_key` -- one or more secrets pasted once, stored in `.env` as `${VAR}`.
 * - `oauth`  -- interactive browser sign-in; the app runs the OAuth handshake
 *               and stores tokens in the Keychain. No key ever touches a file.
 */
export type CapabilityAuth = 'none' | 'api_key' | 'oauth';

/**
 * One MCP server the Claude runtime reported it can reach — an account
 * connector (`claude.ai Slack`), a plugin (`plugin:figma:figma`), or a local
 * server (`eventkit`). Produced by the discovery probe and cached app-wide.
 * Same shape as `McpServerInfo`; declared here to keep this module free of a
 * dependency on the executor.
 */
export type DiscoveredConnection = { name: string; status: string; error?: string };

type EnvSource = Record<string, string | undefined>;

type RemoteServerTemplate = {
  type: 'http' | 'sse';
  /** Env var holding the literal server URL (URLs cannot use ${VAR} in YAML). */
  urlEnv: string;
  /** Header values may reference ${VAR}; resolved at run time, not here. */
  headers?: Record<string, string>;
};

export type CapabilityDefinition = {
  id: string;
  label: string;
  description: string;
  /** SF Symbol name rendered by the macOS app. */
  icon: string;
  kind: CapabilityKind;
  /**
   * How this connection authenticates. Drives the app's Connect flow. Defaults
   * to `none` for tool capabilities and builtins; `api_key` when `requiredEnv`
   * is set; `oauth` must be declared explicitly (it cannot be inferred, since an
   * OAuth server and a builtin both have no required env).
   */
  auth?: CapabilityAuth;
  /** kind 'tools': the Claude Code tools this capability covers. */
  tools?: string[];
  /** kind 'mcp': canonical mcp_servers key written when enabling. */
  serverName?: string;
  /** kind 'mcp': matches existing mcp_servers keys declared by hand. */
  match?: RegExp;
  /** Auto-injected by the runtime (eventkit); no config entry required. */
  builtin?: boolean;
  /** Complete server config written verbatim on enable. */
  staticServer?: McpServerConfig;
  /** Remote server whose URL is read from an env var on enable. */
  remoteServer?: RemoteServerTemplate;
  /** Env vars that must be set (in ~/.agent-server/.env) for this to work. */
  requiredEnv?: string[];
};

export const CAPABILITY_CATALOG: CapabilityDefinition[] = [
  {
    id: 'read-files',
    label: 'Read your files',
    description: 'Look inside files and folders on this Mac',
    icon: 'folder',
    kind: 'tools',
    tools: ['Read', 'Glob', 'Grep'],
  },
  {
    id: 'write-files',
    label: 'Create & edit files',
    description: 'Create new files and change existing ones',
    icon: 'square.and.pencil',
    kind: 'tools',
    tools: ['Write', 'Edit'],
  },
  {
    id: 'run-commands',
    label: 'Run commands',
    description: 'Run terminal commands on this Mac',
    icon: 'terminal',
    kind: 'tools',
    tools: ['Bash'],
  },
  {
    id: 'browse-web',
    label: 'Browse the web',
    description: 'Search the web and read pages',
    icon: 'globe',
    kind: 'tools',
    tools: ['WebFetch', 'WebSearch'],
  },
  {
    id: 'calendar',
    label: 'Calendar & Reminders',
    description: 'See and manage your Apple Calendar events and Reminders',
    icon: 'calendar',
    kind: 'mcp',
    serverName: 'eventkit',
    match: /^eventkit$/i,
    builtin: true,
  },
  {
    id: 'notion',
    label: 'Notion',
    description: 'Read and update pages in your Notion workspace',
    icon: 'doc.richtext',
    kind: 'mcp',
    serverName: 'notion',
    match: /notion/i,
    staticServer: {
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server'],
      env: { NOTION_TOKEN: '${NOTION_API_KEY}' },
    },
    requiredEnv: ['NOTION_API_KEY'],
  },
  {
    id: 'slack',
    label: 'Slack',
    description: 'Read channels and send messages in your Slack workspace',
    icon: 'bubble.left.and.bubble.right',
    kind: 'mcp',
    serverName: 'slack',
    match: /slack/i,
    staticServer: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
      env: {
        SLACK_BOT_TOKEN: '${SLACK_BOT_TOKEN}',
        SLACK_TEAM_ID: '${SLACK_TEAM_ID}',
      },
    },
    requiredEnv: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
  },
  {
    id: 'linear',
    label: 'Linear',
    description: 'View and update issues in Linear',
    icon: 'checklist',
    kind: 'mcp',
    serverName: 'linear',
    match: /linear/i,
    auth: 'oauth',
    staticServer: {
      type: 'sse',
      url: 'https://mcp.linear.app/sse',
    },
  },
  {
    id: 'gmail',
    label: 'Gmail',
    description: 'Read and organize email through your Gmail MCP server',
    icon: 'envelope',
    kind: 'mcp',
    serverName: 'gmail',
    match: /gmail/i,
    remoteServer: {
      type: 'http',
      urlEnv: 'GMAIL_MCP_URL',
      headers: { Authorization: 'Bearer ${GMAIL_MCP_TOKEN}' },
    },
    requiredEnv: ['GMAIL_MCP_URL', 'GMAIL_MCP_TOKEN'],
  },
  {
    id: 'tripmaster',
    label: 'TripMaster',
    description: 'Plan trips and manage itineraries in TripMaster',
    icon: 'airplane',
    kind: 'mcp',
    serverName: 'tripmaster',
    match: /trip[-_]?master/i,
    // Hosted at a stable URL; authenticates with a long-lived API key
    // (tripmaster api-key create) pasted as a bearer token. Only the key
    // is collected via the Connect flow; the URL is known.
    staticServer: {
      type: 'http',
      url: 'https://www.tripmaster.dev/mcp',
      headers: { Authorization: 'Bearer ${TRIPMASTER_API_KEY}' },
    },
    requiredEnv: ['TRIPMASTER_API_KEY'],
  },
  {
    id: 'calorienerds',
    label: 'CalorieNerds',
    description: 'Log meals and review nutrition data in CalorieNerds',
    icon: 'fork.knife',
    kind: 'mcp',
    serverName: 'calorienerds',
    match: /calorie[-_]?nerds/i,
    auth: 'oauth',
    // OAuth-protected resource (no static key): the MCP client performs the
    // OAuth flow, so the server entry is just the hosted URL. Enabling
    // succeeds immediately; the run surfaces `needs-auth` until the user
    // authorizes in the browser.
    staticServer: {
      type: 'http',
      url: 'https://www.calorienerds.dev/mcp',
    },
  },
];

/** Wire shape served to clients. Field names are snake_case like the rest of the API. */
export type AgentCapability = {
  id: string;
  label: string;
  description: string;
  icon: string;
  kind: CapabilityKind;
  auth: CapabilityAuth;
  enabled: boolean;
  custom: boolean;
  required_env: string[];
  env_ready: boolean;
  server_name?: string;
  /** Connection status from the discovery probe, when this maps to a reachable
   * runtime connector (`connected` | `needs-auth` | `failed` | …). */
  status?: string;
};

export type CapabilityChange = { id: string; enabled: boolean };

/** Only the fields a batch of toggles actually changed. */
export type CapabilityFieldUpdates = {
  tools?: string[];
  disallowed_tools?: string[];
  mcp_servers?: Record<string, McpServerConfig>;
};

export class CapabilityError extends Error {
  constructor(
    message: string,
    readonly code: 'unknown_capability' | 'missing_env',
    readonly missingEnv?: string[],
  ) {
    super(message);
    this.name = 'CapabilityError';
  }
}

const CUSTOM_MCP_PREFIX = 'mcp:';
const CUSTOM_TOOL_PREFIX = 'tool:';

function isToolEffectivelyAllowed(agent: AgentConfig, tool: string): boolean {
  // A permissions block (allow/deny globs) is the authoritative gate when
  // present, so a capability granted only through permissions still reads as
  // enabled instead of falsely "off".
  if (agent.permissions) return isToolAllowed(tool, agent.permissions);
  if (agent.disallowed_tools.includes(tool)) return false;
  if (agent.tools.length === 0) return true;
  return agent.tools.includes(tool);
}

/**
 * Whether a `permissions` block grants any tool on an MCP server — i.e. an
 * `allow` pattern targets `mcp__<serverKey>__*` (or a broad wildcard). Deny
 * rules only narrow which tools are usable; as long as something on the server
 * is allowed, the capability is on.
 */
function isServerAllowedByPermissions(agent: AgentConfig, serverKey: string): boolean {
  if (!agent.permissions) return false;
  const prefix = `mcp__${serverKey}`;
  return agent.permissions.allow.some(
    (p) => p === '*' || p === 'mcp__*' || p === prefix || p.startsWith(`${prefix}__`),
  );
}

function serverRule(serverKey: string): string {
  return `mcp__${serverKey}`;
}

function isServerDisallowed(agent: AgentConfig, serverKey: string): boolean {
  return agent.disallowed_tools.includes(serverRule(serverKey));
}

function isServerCoveredByAllowlist(agent: AgentConfig, serverKey: string): boolean {
  if (agent.tools.length === 0) return true;
  const rule = serverRule(serverKey);
  return agent.tools.some((t) => t === rule || t.startsWith(`${rule}__`));
}

function matchedServerKey(agent: AgentConfig, def: CapabilityDefinition): string | undefined {
  const keys = Object.keys(agent.mcp_servers ?? {});
  if (def.match) {
    const hit = keys.find((k) => def.match!.test(k));
    if (hit) return hit;
  }
  return def.serverName && keys.includes(def.serverName) ? def.serverName : undefined;
}

function envReady(def: Pick<CapabilityDefinition, 'requiredEnv'>, env: EnvSource): boolean {
  return (def.requiredEnv ?? []).every((v) => Boolean(env[v]?.trim()));
}

/**
 * Whether the user has configured this service with its own keys. Only entries
 * that actually declare `requiredEnv` count — an OAuth entry with no env is not
 * "configured" just because it needs nothing, so it stays hidden until it is
 * discovered or declared on an agent.
 */
function isConfigured(def: CapabilityDefinition, env: EnvSource): boolean {
  return (def.requiredEnv?.length ?? 0) > 0 && envReady(def, env);
}

/**
 * Normalizes an MCP server's display name to the key used in its tool names
 * (`mcp__<key>__<tool>`): every run of non-alphanumeric characters collapses to
 * a single underscore, trimmed at the ends. So `claude.ai Slack` -> `claude_ai_Slack`.
 * Consistency here is what makes a per-agent allow/deny of an account connector
 * actually match the tools the runtime exposes.
 */
export function mcpServerKey(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Finds the discovered connector that backs a catalog capability, if any.
 * Prefers a `claude.ai …` account connector when several names match (e.g. an
 * account Slack over a bring-your-own plugin Slack).
 */
function matchDiscovered(
  def: CapabilityDefinition,
  discovered: DiscoveredConnection[],
): DiscoveredConnection | undefined {
  if (def.kind !== 'mcp') return undefined;
  const candidates = discovered.filter((d) => {
    if (def.match?.test(d.name)) return true;
    if (def.serverName && mcpServerKey(d.name) === mcpServerKey(def.serverName)) return true;
    return false;
  });
  if (candidates.length === 0) return undefined;
  return candidates.find((d) => /^claude\.ai\s/i.test(d.name)) ?? candidates[0];
}

/** Human label for a discovered connector with no catalog entry. */
function prettifyConnectionName(name: string): string {
  let rest = name.replace(/^claude\.ai\s+/i, '');
  const plugin = /^plugin:(.+)$/i.exec(rest);
  if (plugin) {
    const parts = plugin[1].split(':');
    rest = parts[parts.length - 1] ?? plugin[1];
  }
  return prettifyKey(rest);
}

/**
 * The auth model for a catalog entry: explicit `auth` wins; otherwise infer
 * `api_key` when the entry needs env vars, else `none`. `oauth` is never
 * inferred (see the field docs) so it must be declared on the entry.
 */
function resolveAuth(def: Pick<CapabilityDefinition, 'auth' | 'requiredEnv'>): CapabilityAuth {
  if (def.auth) return def.auth;
  return (def.requiredEnv ?? []).length > 0 ? 'api_key' : 'none';
}

function prettifyKey(key: string): string {
  return key
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function isMcpToolName(tool: string): boolean {
  return tool.startsWith('mcp__');
}

/** Permission-aware on/off state for an MCP server the agent can reach. */
function isServerEnabled(agent: AgentConfig, serverKey: string): boolean {
  return agent.permissions
    ? isServerAllowedByPermissions(agent, serverKey)
    : !isServerDisallowed(agent, serverKey) && isServerCoveredByAllowlist(agent, serverKey);
}

/**
 * Derives the consumer-facing capability list for ONE agent from what is
 * actually available to it — never the full static catalog. The list is:
 *
 *  - built-in local abilities (read/write files, run commands, browse web) and
 *    the builtin Calendar — always shown;
 *  - catalog services that are available: the user configured their keys, the
 *    Claude runtime can reach them as an account connector, or the agent
 *    already declares them. Unconfigured, unreachable services are hidden so
 *    they don't clutter every agent;
 *  - generic entries for any reachable connector or declared MCP server the
 *    catalog doesn't recognize, and any allowlisted tool it doesn't recognize.
 *
 * The catalog supplies only presentation (label, logo, description, auth,
 * env mapping) over this live set. `discovered` is the cached probe result.
 */
export function deriveCapabilities(
  agent: AgentConfig,
  env: EnvSource = process.env,
  discovered: DiscoveredConnection[] = [],
): AgentCapability[] {
  const result: AgentCapability[] = [];
  const claimedServerKeys = new Set<string>();
  const consumedConnectors = new Set<string>();
  const emittedIds = new Set<string>();
  const catalogTools = new Set(CAPABILITY_CATALOG.flatMap((d) => d.tools ?? []));

  for (const def of CAPABILITY_CATALOG) {
    if (def.kind === 'tools') {
      // Local abilities are always shown — they are what the Mac itself can do.
      result.push({
        id: def.id,
        label: def.label,
        description: def.description,
        icon: def.icon,
        kind: 'tools',
        auth: resolveAuth(def),
        enabled: (def.tools ?? []).some((t) => isToolEffectivelyAllowed(agent, t)),
        custom: false,
        required_env: def.requiredEnv ?? [],
        env_ready: envReady(def, env),
      });
      emittedIds.add(def.id);
      continue;
    }

    const existingKey = matchedServerKey(agent, def);
    if (existingKey) claimedServerKeys.add(existingKey);
    const connector = matchDiscovered(def, discovered);
    if (connector) consumedConnectors.add(connector.name);

    // Hide a service the agent has no relationship to: not declared, not
    // reachable at run time, not configured, not a builtin.
    const available =
      Boolean(existingKey) || Boolean(connector) || isConfigured(def, env) || Boolean(def.builtin);
    if (!available) continue;

    const serverKey =
      existingKey ?? (connector ? mcpServerKey(connector.name) : def.serverName ?? def.id);
    // "Configured but not wired in" reads as available-yet-off: env is ready but
    // there is no server entry, connector, or builtin backing it on this agent.
    const present = Boolean(existingKey) || Boolean(connector) || Boolean(def.builtin);
    result.push({
      id: def.id,
      label: def.label,
      description: def.description,
      icon: def.icon,
      kind: 'mcp',
      auth: resolveAuth(def),
      enabled: present && isServerEnabled(agent, serverKey),
      custom: false,
      required_env: def.requiredEnv ?? [],
      env_ready: envReady(def, env),
      server_name: serverKey,
      ...(connector ? { status: connector.status } : {}),
    });
    emittedIds.add(def.id);
  }

  // Reachable connectors the catalog doesn't recognize (account connectors and
  // plugins without a branded entry). Skip any the agent also declares — the
  // per-agent loop below owns those.
  for (const connector of discovered) {
    if (consumedConnectors.has(connector.name)) continue;
    const key = mcpServerKey(connector.name);
    const id = `${CUSTOM_MCP_PREFIX}${key}`;
    if (emittedIds.has(id)) continue;
    if (agent.mcp_servers && key in agent.mcp_servers) continue;
    result.push({
      id,
      label: prettifyConnectionName(connector.name),
      description: 'Available through your Claude connections',
      icon: 'puzzlepiece.extension',
      kind: 'mcp',
      auth: 'none',
      enabled: isServerEnabled(agent, key),
      custom: true,
      required_env: [],
      env_ready: true,
      server_name: key,
      status: connector.status,
    });
    emittedIds.add(id);
  }

  for (const key of Object.keys(agent.mcp_servers ?? {})) {
    if (claimedServerKeys.has(key)) continue;
    const id = `${CUSTOM_MCP_PREFIX}${key}`;
    if (emittedIds.has(id)) continue;
    result.push({
      id,
      label: prettifyKey(key),
      description: `Custom connection: ${key}`,
      icon: 'puzzlepiece.extension',
      kind: 'mcp',
      auth: 'none',
      enabled: !isServerDisallowed(agent, key) && isServerCoveredByAllowlist(agent, key),
      custom: true,
      required_env: [],
      env_ready: true,
      server_name: key,
    });
    emittedIds.add(id);
  }

  for (const tool of agent.tools) {
    if (catalogTools.has(tool) || isMcpToolName(tool)) continue;
    result.push({
      id: `${CUSTOM_TOOL_PREFIX}${tool}`,
      label: tool,
      description: `Custom tool: ${tool}`,
      icon: 'wrench.and.screwdriver',
      kind: 'tools',
      auth: 'none',
      enabled: isToolEffectivelyAllowed(agent, tool),
      custom: true,
      required_env: [],
      env_ready: true,
    });
  }

  return result;
}

/** Catalog metadata for clients that need the full list (e.g. new-agent flow). */
export function catalogSummary(env: EnvSource = process.env): Array<{
  id: string;
  label: string;
  description: string;
  icon: string;
  kind: CapabilityKind;
  auth: CapabilityAuth;
  builtin: boolean;
  required_env: string[];
  env_ready: boolean;
}> {
  return CAPABILITY_CATALOG.map((def) => ({
    id: def.id,
    label: def.label,
    description: def.description,
    icon: def.icon,
    kind: def.kind,
    auth: resolveAuth(def),
    builtin: def.builtin ?? false,
    required_env: def.requiredEnv ?? [],
    env_ready: envReady(def, env),
  }));
}

/**
 * Builds the mcp_servers entry for a catalog definition. Remote templates
 * read their literal URL from an env var (the schema rejects ${VAR} in
 * `url`); header values keep ${VAR} references so secrets never land in
 * agent files.
 */
function buildServerConfig(
  def: CapabilityDefinition,
  env: EnvSource,
): McpServerConfig {
  const missing = (def.requiredEnv ?? []).filter((v) => !env[v]?.trim());
  if (missing.length > 0) {
    throw new CapabilityError(
      `Capability "${def.id}" needs environment variables: ${missing.join(', ')}`,
      'missing_env',
      missing,
    );
  }

  if (def.staticServer) return def.staticServer;

  if (def.remoteServer) {
    const url = env[def.remoteServer.urlEnv]!.trim();
    return {
      type: def.remoteServer.type,
      url,
      ...(def.remoteServer.headers ? { headers: def.remoteServer.headers } : {}),
    };
  }

  throw new CapabilityError(
    `Capability "${def.id}" has no server template`,
    'unknown_capability',
  );
}

function addUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

function removeAll(list: string[], values: string[]): void {
  for (const value of values) {
    let idx = list.indexOf(value);
    while (idx !== -1) {
      list.splice(idx, 1);
      idx = list.indexOf(value);
    }
  }
}

/**
 * Translates a batch of capability toggles into concrete field updates.
 * Pure with respect to the agent: returns new arrays/objects, never mutates.
 * Throws CapabilityError for unknown ids or missing env vars.
 */
export function applyCapabilityChanges(
  agent: AgentConfig,
  changes: CapabilityChange[],
  env: EnvSource = process.env,
  discovered: DiscoveredConnection[] = [],
): CapabilityFieldUpdates {
  const tools = [...agent.tools];
  const disallowed = [...agent.disallowed_tools];
  const servers: Record<string, McpServerConfig> = { ...(agent.mcp_servers ?? {}) };
  let toolsChanged = false;
  let disallowedChanged = false;
  let serversChanged = false;

  const markTools = (before: number): void => {
    if (tools.length !== before) toolsChanged = true;
  };
  const markDisallowed = (before: number): void => {
    if (disallowed.length !== before) disallowedChanged = true;
  };

  const enableServer = (serverKey: string): void => {
    const beforeD = disallowed.length;
    removeAll(disallowed, [serverRule(serverKey)]);
    markDisallowed(beforeD);
    if (tools.length > 0 && !isServerCoveredByAllowlist({ ...agent, tools } as AgentConfig, serverKey)) {
      tools.push(serverRule(serverKey));
      toolsChanged = true;
    }
  };

  const disableServer = (serverKey: string): void => {
    if (!disallowed.includes(serverRule(serverKey))) {
      disallowed.push(serverRule(serverKey));
      disallowedChanged = true;
    }
  };

  for (const change of changes) {
    if (change.id.startsWith(CUSTOM_MCP_PREFIX)) {
      const key = change.id.slice(CUSTOM_MCP_PREFIX.length);
      // Either the agent declares this server, or the runtime reaches it as a
      // connector (ambient — nothing to write, just gate access).
      const isDiscovered = discovered.some((d) => mcpServerKey(d.name) === key);
      if (!servers[key] && !isDiscovered) {
        throw new CapabilityError(
          `Unknown MCP server "${key}" on agent "${agent.id}"`,
          'unknown_capability',
        );
      }
      if (change.enabled) enableServer(key);
      else disableServer(key);
      continue;
    }

    if (change.id.startsWith(CUSTOM_TOOL_PREFIX)) {
      const tool = change.id.slice(CUSTOM_TOOL_PREFIX.length);
      if (change.enabled) {
        const beforeD = disallowed.length;
        removeAll(disallowed, [tool]);
        markDisallowed(beforeD);
        if (tools.length > 0 && !tools.includes(tool)) {
          tools.push(tool);
          toolsChanged = true;
        }
      } else if (!disallowed.includes(tool)) {
        disallowed.push(tool);
        disallowedChanged = true;
      }
      continue;
    }

    const def = CAPABILITY_CATALOG.find((d) => d.id === change.id);
    if (!def) {
      throw new CapabilityError(`Unknown capability "${change.id}"`, 'unknown_capability');
    }

    if (def.kind === 'tools') {
      const defTools = def.tools ?? [];
      if (change.enabled) {
        const beforeD = disallowed.length;
        removeAll(disallowed, defTools);
        markDisallowed(beforeD);
        if (tools.length > 0) {
          const beforeT = tools.length;
          for (const tool of defTools) addUnique(tools, tool);
          markTools(beforeT);
        }
      } else {
        const beforeD = disallowed.length;
        for (const tool of defTools) addUnique(disallowed, tool);
        markDisallowed(beforeD);
      }
      continue;
    }

    // Catalog MCP capability.
    const existingKey = matchedServerKey(agent, def);
    const connector = matchDiscovered(def, discovered);
    const serverKey =
      existingKey ?? (connector ? mcpServerKey(connector.name) : def.serverName ?? def.id);
    if (change.enabled) {
      // Write a bring-your-own server only when the service is not already
      // declared, not a builtin, and not reachable as an account connector.
      if (!existingKey && !def.builtin && !connector) {
        servers[serverKey] = buildServerConfig(def, env);
        serversChanged = true;
      }
      enableServer(serverKey);
    } else {
      disableServer(serverKey);
    }
  }

  const updates: CapabilityFieldUpdates = {};
  if (toolsChanged) updates.tools = tools;
  if (disallowedChanged) updates.disallowed_tools = disallowed;
  if (serversChanged) updates.mcp_servers = servers;
  return updates;
}

const ENV_REF_ONLY = /^\s*\$\{[A-Za-z_][A-Za-z0-9_]*\}\s*$/;
const REDACTED = '__redacted__';

function redactValueMap(map: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!map) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    out[key] = ENV_REF_ONLY.test(value) || value === '' ? value : REDACTED;
  }
  return out;
}

/**
 * Returns a copy of the agent safe to serve over HTTP: any literal secret
 * hard-coded into mcp_servers env/headers is masked. Pure ${VAR} references
 * are kept — they are names, not secrets, and the UI needs them to show
 * which env vars a connection uses.
 */
export function redactAgentSecrets(agent: AgentConfig): AgentConfig {
  if (!agent.mcp_servers) return agent;

  const redacted: Record<string, McpServerConfig> = {};
  for (const [name, server] of Object.entries(agent.mcp_servers)) {
    if ('command' in server) {
      redacted[name] = { ...server, env: redactValueMap(server.env) };
    } else {
      redacted[name] = { ...server, headers: redactValueMap(server.headers) };
    }
  }
  return { ...agent, mcp_servers: redacted };
}
