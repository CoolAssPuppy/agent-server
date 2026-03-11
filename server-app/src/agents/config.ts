import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { InteractionConfigSchema, NotificationConfigSchema } from '../interaction/schema.js';

const TriggerRefSchema = z.object({
  agent: z.string().min(1),
});

export type TriggerRef = z.infer<typeof TriggerRefSchema>;

const FileWatchSchema = z.object({
  path: z.string().min(1),
  glob: z.string().optional(),
});

export type FileWatch = z.infer<typeof FileWatchSchema>;

export const PermissionsSchema = z.object({
  allow: z.array(z.string().min(1)).default([]),
  deny: z.array(z.string().min(1)).default([]),
});

export type Permissions = z.infer<typeof PermissionsSchema>;

const McpStdioServerSchema = z.object({
  type: z.literal('stdio').optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const McpSseServerSchema = z.object({
  type: z.literal('sse'),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
});

const McpHttpServerSchema = z.object({
  type: z.literal('http'),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
});

const McpServerConfigSchema = z.union([
  McpSseServerSchema,
  McpHttpServerSchema,
  McpStdioServerSchema,
]);

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

const ENV_VAR_PATTERN = /\$\{([^}]+)}/g;

export function resolveEnvVars(
  env: Record<string, string>,
  source: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = value.replace(ENV_VAR_PATTERN, (_match, varName: string) => source[varName] ?? '');
  }
  return resolved;
}

export const AgentConfigSchema = z
  .object({
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    name: z.string().trim().min(1).max(120),
    description: z.string().max(500).optional(),
    schedule: z.string().trim().min(1).max(120).optional(),
    timezone: z.string().trim().max(120).optional(),
    prompt: z.string().trim().min(1).max(40_000),
    tools: z.array(z.string().trim().min(1).max(120)).max(128).default([]),
    disallowed_tools: z.array(z.string().trim().min(1).max(120)).max(128).default([]),
    max_turns: z.number().int().positive().default(20),
    working_directory: z.string().max(1024).refine((v) => !v.includes('\0')).optional(),
    permission_mode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk']).optional(),
    enabled: z.boolean().default(true),
    on_complete: z.array(TriggerRefSchema).optional(),
    on_failure: z.array(TriggerRefSchema).optional(),
    watch: z.array(FileWatchSchema).optional(),
    executor: z.string().trim().min(1).max(64).optional(),
    permissions: PermissionsSchema.optional(),
    mcp_servers: z.record(z.string().min(1), McpServerConfigSchema).optional(),
    interaction: InteractionConfigSchema.optional(),
    notification: NotificationConfigSchema.optional(),
  })
  .passthrough();

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export function parseAgentYaml(yaml: string): AgentConfig {
  const raw = parseYaml(yaml);
  return AgentConfigSchema.parse(raw);
}

const FRONTMATTER_OPEN = /^---\r?\n/;
const FRONTMATTER_CLOSE = /\r?\n---\s*(?:\r?\n|$)/;

function hasFrontmatter(content: string): boolean {
  return FRONTMATTER_OPEN.test(content);
}

function splitFrontmatter(content: string): { yaml: string; body: string } {
  const afterOpener = content.slice(content.indexOf('\n') + 1);
  const closeMatch = FRONTMATTER_CLOSE.exec(afterOpener);
  if (!closeMatch) {
    throw new Error('Frontmatter opening delimiter has no closing ---');
  }
  const yaml = afterOpener.slice(0, closeMatch.index);
  const body = afterOpener.slice(closeMatch.index + closeMatch[0].length).trim();
  return { yaml, body };
}

export function parseAgentFile(content: string): AgentConfig {
  if (!hasFrontmatter(content)) {
    return parseAgentYaml(content);
  }

  const { yaml, body } = splitFrontmatter(content);
  const raw = parseYaml(yaml);

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Frontmatter must be a YAML mapping');
  }

  const config = body.length > 0
    ? { ...(raw as Record<string, unknown>), prompt: body }
    : raw;

  return AgentConfigSchema.parse(config);
}
