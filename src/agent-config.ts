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
    schedule: z.string().min(1),
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
