import type { McpServerConfig } from './config.js';

const ENV_REFERENCE = /\$\{([A-Z][A-Z0-9_]*)}/g;

const NOTION_REST_SAFE_TOOLS = [
  'API-get-user',
  'API-get-users',
  'API-get-self',
  'API-post-search',
  'API-get-block-children',
  'API-retrieve-a-block',
  'API-retrieve-a-page',
  'API-retrieve-a-page-property',
  'API-retrieve-a-comment',
  'API-query-data-source',
  'API-retrieve-a-data-source',
  'API-list-data-source-templates',
  'API-retrieve-a-database',
  'API-retrieve-page-markdown',
  'API-patch-block-children',
  'API-update-a-block',
  'API-patch-page',
  'API-post-page',
  'API-update-page-markdown',
] as const;

function credentialValues(config: McpServerConfig): string[] {
  return 'command' in config ? Object.values(config.env ?? {}) : Object.values(config.headers ?? {});
}

export function mcpEnvironmentReferences(config: McpServerConfig): string[] {
  return [...new Set(credentialValues(config)
    .flatMap((value) => [...value.matchAll(ENV_REFERENCE)].map((match) => match[1])))];
}

function isNotionRestServer(config: McpServerConfig | undefined): boolean {
  return Boolean(config && 'command' in config
    && config.command === 'npx'
    && config.args?.join('\0') === '-y\0@notionhq/notion-mcp-server');
}

/** Permission rules for the tools an exact MCP transport exposes. */
export function mcpServicePermissionTools(
  serverKey: string,
  config: McpServerConfig | undefined,
): string[] {
  if (isNotionRestServer(config)) {
    return NOTION_REST_SAFE_TOOLS.map((tool) => `mcp__${serverKey}__${tool}`);
  }
  return [`mcp__${serverKey}__*`];
}
