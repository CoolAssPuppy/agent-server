import { z } from 'zod';
import { parse as parseYaml } from 'yaml';

const TriggerRefSchema = z.object({
  agent: z.string().min(1),
});

export type TriggerRef = z.infer<typeof TriggerRefSchema>;

const FileWatchSchema = z.object({
  path: z.string().min(1),
  glob: z.string().optional(),
});

export type FileWatch = z.infer<typeof FileWatchSchema>;

export const AgentConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    schedule: z.string().min(1).optional(),
    timezone: z.string().optional(),
    prompt: z.string().min(1),
    tools: z.array(z.string()).default([]),
    max_turns: z.number().int().positive().default(20),
    working_directory: z.string().optional(),
    enabled: z.boolean().default(true),
    on_complete: z.array(TriggerRefSchema).optional(),
    on_failure: z.array(TriggerRefSchema).optional(),
    watch: z.array(FileWatchSchema).optional(),
    executor: z.string().optional(),
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
