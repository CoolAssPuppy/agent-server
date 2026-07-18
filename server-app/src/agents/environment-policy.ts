type EnvironmentSource = Record<string, string | undefined>;

type ProviderSettings = {
  base_url: string;
  api_key?: string;
};

type AgentEnvironmentSettings = {
  provider?: ProviderSettings;
};

type McpCredentialSettings =
  | { command: string; args?: readonly string[]; url?: never }
  | { url: string; command?: never; args?: never };

export type McpCredentialOwner = { name: string } & McpCredentialSettings;

export function mcpCredentialOwner(name: string, settings: McpCredentialSettings): McpCredentialOwner {
  if (settings.url !== undefined) return { name, url: settings.url };
  return { name, command: settings.command, args: settings.args };
}

const EXACT_ENV_REFERENCE = /^\$\{([A-Z][A-Z0-9_]*)}$/;
const ENV_REFERENCE = /\$\{([A-Z][A-Z0-9_]*)}/g;
const HAS_ENV_REFERENCE = /\$\{[A-Z][A-Z0-9_]*}/;

const CLAUDE_RUNTIME_VARIABLES = [
  'COLORTERM',
  'HOME',
  'LANG',
  'LC_ALL',
  'LOGNAME',
  'PATH',
  'SHELL',
  'TERM',
  'TMPDIR',
  'USER',
  'XDG_CONFIG_HOME',
] as const;

const CODEX_RUNTIME_VARIABLES = [
  'CODEX_HOME',
  'COLORTERM',
  'HOME',
  'LANG',
  'LC_ALL',
  'LOGNAME',
  'PATH',
  'SHELL',
  'TERM',
  'TMPDIR',
  'USER',
  'XDG_CONFIG_HOME',
] as const;

const PROVIDER_CREDENTIALS: Readonly<Record<string, ReadonlySet<string>>> = {
  'api.moonshot.ai': new Set(['MOONSHOT_API_KEY']),
};

const MCP_CREDENTIALS: ReadonlyArray<{
  matches: (owner: McpCredentialOwner, source: EnvironmentSource) => boolean;
  references: Readonly<Record<string, ReadonlySet<string>>>;
}> = [
  {
    matches: (owner) => owner.name.toLowerCase() === 'notion-personal'
      && 'command' in owner
      && owner.command === 'npx'
      && owner.args?.join('\0') === '-y\0@notionhq/notion-mcp-server',
    references: { NOTION_TOKEN: new Set(['NOTION_PERSONAL_API_KEY']) },
  },
  {
    matches: (owner) => owner.name.toLowerCase() === 'notion'
      && 'command' in owner
      && owner.command === 'npx'
      && owner.args?.join('\0') === '-y\0@notionhq/notion-mcp-server',
    references: { NOTION_TOKEN: new Set(['NOTION_API_KEY']) },
  },
  {
    matches: (owner) => owner.name === 'hex'
      && 'url' in owner
      && owner.url === 'https://app.hex.tech/mcp',
    references: { Authorization: new Set(['HEX_PERSONAL_ACCESS_TOKEN']) },
  },
  {
    matches: (owner) => owner.name === 'slack'
      && 'command' in owner
      && owner.command === 'npx'
      && owner.args?.join('\0') === '-y\0@modelcontextprotocol/server-slack',
    references: {
      SLACK_BOT_TOKEN: new Set(['SLACK_BOT_TOKEN']),
      SLACK_TEAM_ID: new Set(['SLACK_TEAM_ID']),
    },
  },
  {
    matches: (owner, source) => owner.name === 'gmail'
      && 'url' in owner
      && source.GMAIL_MCP_URL === owner.url,
    references: { Authorization: new Set(['GMAIL_MCP_TOKEN']) },
  },
  {
    matches: (owner) => owner.name === 'tripmaster'
      && 'url' in owner
      && owner.url === 'https://www.tripmaster.dev/mcp',
    references: { Authorization: new Set(['TRIPMASTER_API_KEY']) },
  },
];

function approvedMcpReferences(
  owner: McpCredentialOwner,
  source: EnvironmentSource,
): ReadonlyMap<string, ReadonlySet<string>> {
  return new Map(MCP_CREDENTIALS
    .filter((entry) => entry.matches(owner, source))
    .flatMap((entry) => Object.entries(entry.references)));
}

function hasEnvironmentReference(values: Record<string, string>): boolean {
  return Object.values(values).some((value) => HAS_ENV_REFERENCE.test(value));
}

function environmentReference(value: string): string {
  const match = EXACT_ENV_REFERENCE.exec(value);
  if (!match) throw new Error('Credential must be one ${VAR} reference');
  return match[1];
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function isApprovedProviderReference(provider: ProviderSettings): boolean {
  if (!provider.api_key) return true;
  const match = EXACT_ENV_REFERENCE.exec(provider.api_key);
  if (!match) return false;
  const hostname = new URL(provider.base_url).hostname;
  return isLoopback(hostname) || PROVIDER_CREDENTIALS[hostname]?.has(match[1]) === true;
}

export function areApprovedMcpReferences(
  owner: McpCredentialOwner,
  values: Record<string, string>,
  source: EnvironmentSource = process.env,
): boolean {
  if (!hasEnvironmentReference(values)) return true;
  const approved = approvedMcpReferences(owner, source);
  return Object.entries(values).every(([target, value]) => (
    approved.has(target)
    && [...value.matchAll(ENV_REFERENCE)].every((match) => approved.get(target)?.has(match[1]) === true)
  ));
}

function resolveReference(name: string, source: EnvironmentSource): string {
  const value = source[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Environment variable ${name} is not configured`);
  }
  return value;
}

/** Resolve a provider credential only after the endpoint has been approved. */
export function resolveApprovedProviderKey(
  provider: ProviderSettings,
  source: EnvironmentSource = process.env,
): string | undefined {
  if (!provider.api_key) return undefined;
  const variable = environmentReference(provider.api_key);
  const hostname = new URL(provider.base_url).hostname;
  if (!isApprovedProviderReference(provider)) {
    throw new Error(`Environment variable ${variable} is not approved for provider ${hostname}`);
  }
  return resolveReference(variable, source);
}

/** Resolve MCP values only for credentials owned by a trusted catalog connection. */
export function resolveApprovedMcpValues(
  owner: McpCredentialOwner,
  values: Record<string, string>,
  source: EnvironmentSource = process.env,
): Record<string, string> {
  const hasReferences = hasEnvironmentReference(values);
  const approved = approvedMcpReferences(owner, source);
  const resolved: Record<string, string> = {};
  for (const [target, value] of Object.entries(values)) {
    if (hasReferences && !approved.has(target)) {
      throw new Error(`Environment field ${target} is not approved for MCP server ${owner.name}`);
    }
    resolved[target] = value.replace(ENV_REFERENCE, (_match, variable: string) => {
      if (approved.get(target)?.has(variable) !== true) {
        throw new Error(`Environment variable ${variable} is not approved for MCP server ${owner.name}`);
      }
      return resolveReference(variable, source);
    });
  }
  return resolved;
}

/** Build an explicit child environment so subscription runs never inherit server secrets. */
export function buildClaudeChildEnvironment(
  agent: AgentEnvironmentSettings,
  source: EnvironmentSource = process.env,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const name of CLAUDE_RUNTIME_VARIABLES) {
    const value = source[name];
    if (value !== undefined) environment[name] = value;
  }
  if (!agent.provider) return environment;
  environment.ANTHROPIC_BASE_URL = agent.provider.base_url;
  const apiKey = resolveApprovedProviderKey(agent.provider, source);
  if (apiKey) environment.ANTHROPIC_API_KEY = apiKey;
  return environment;
}

/** Build a Codex child environment without inheriting server or provider secrets. */
export function buildCodexChildEnvironment(
  source: EnvironmentSource = process.env,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const name of CODEX_RUNTIME_VARIABLES) {
    const value = source[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}
