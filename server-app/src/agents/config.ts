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
    interaction: InteractionConfigSchema.optional(),
    notification: NotificationConfigSchema.optional(),
  })
  .passthrough();

export type AgentConfig = z.infer<typeof AgentConfigSchema>;


const DEFAULT_MAX_TURNS = 20;

type ParseAgentOptions = {
  defaultMaxTurns?: number;
};

function applyDefaultMaxTurns(raw: unknown, options: ParseAgentOptions = {}): unknown {
  const configuredDefault = options.defaultMaxTurns ?? DEFAULT_MAX_TURNS;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return raw;
  }
  const record = { ...(raw as Record<string, unknown>) };
  if (record.max_turns === undefined) {
    record.max_turns = configuredDefault;
  }
  return record;
}
export function parseAgentYaml(yaml: string, options: ParseAgentOptions = {}): AgentConfig {
  const raw = parseYaml(yaml);
  return AgentConfigSchema.parse(applyDefaultMaxTurns(raw, options));
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

export function parseAgentFile(content: string, options: ParseAgentOptions = {}): AgentConfig {
  if (!hasFrontmatter(content)) {
    return parseAgentYaml(content, options);
  }

  const { yaml, body } = splitFrontmatter(content);
  const raw = parseYaml(yaml);

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Frontmatter must be a YAML mapping');
  }

  const config = body.length > 0
    ? { ...(raw as Record<string, unknown>), prompt: body }
    : raw;

  return AgentConfigSchema.parse(applyDefaultMaxTurns(config, options));
}
