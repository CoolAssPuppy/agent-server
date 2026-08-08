import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import type { AgentBindingSet } from '../agents/agent-binding-store.js';
import type { AgentConfig } from '../agents/config.js';
import { splitFrontmatter } from '../agents/config.js';
import { copyRuntimeConnectionPolicies } from '../connections/runtime-policy.js';

const MAX_SKILL_BYTES = 128 * 1_024;
const SkillMetadataSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2_000),
}).passthrough();

export class AgentSkillPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentSkillPreparationError';
  }
}

function skillFilePath(bindingPath: string): string {
  return basename(bindingPath) === 'SKILL.md' ? bindingPath : join(bindingPath, 'SKILL.md');
}

async function readValidatedSkill(bindingPath: string): Promise<{
  content: string;
  metadata: z.infer<typeof SkillMetadataSchema>;
  path: string;
}> {
  const path = skillFilePath(bindingPath);
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    throw new AgentSkillPreparationError(`The selected skill is unavailable at ${JSON.stringify(path)}.`);
  }
  if (size > MAX_SKILL_BYTES) {
    throw new AgentSkillPreparationError(`The selected skill exceeds ${MAX_SKILL_BYTES} bytes.`);
  }
  const content = await readFile(path, 'utf8');
  try {
    const { yaml } = splitFrontmatter(content);
    const metadata = SkillMetadataSchema.parse(parseYaml(yaml));
    return { content, metadata, path };
  } catch {
    throw new AgentSkillPreparationError('The selected skill has invalid SKILL.md metadata.');
  }
}

/** Adds validated, machine-local skill instructions to a shareable agent contract. */
export async function prepareAgentSkills(
  agent: AgentConfig,
  bindings: AgentBindingSet,
): Promise<AgentConfig> {
  if (!agent.skills || Object.keys(agent.skills).length === 0) return agent;

  const prepared = await Promise.all(Object.entries(agent.skills).map(async ([slot, requirement]) => {
    const binding = bindings.skills?.[slot];
    if (!binding) {
      throw new AgentSkillPreparationError(
        `Choose a local skill for ${JSON.stringify(requirement.name)} before running this agent.`,
      );
    }
    const skill = await readValidatedSkill(binding.path);
    return [slot, requirement, skill] as const;
  }));
  const skillContext = [
    '<agent_server_skills>',
    'Apply these skills as domain methods for this run.',
    'The agent definition controls scope, tools, write destinations, and output requirements when instructions conflict.',
    ...prepared.flatMap(([slot, requirement, skill]) => [
      `<skill slot=${JSON.stringify(slot)} name=${JSON.stringify(requirement.name)} implementation=${JSON.stringify(skill.metadata.name)} source=${JSON.stringify(skill.path)}>`,
      `Purpose: ${requirement.purpose}`,
      skill.content,
      '</skill>',
    ]),
    '</agent_server_skills>',
  ].join('\n');
  const preparedAgent = { ...agent, prompt: `${agent.prompt}\n\n${skillContext}` };
  copyRuntimeConnectionPolicies(agent, preparedAgent);
  return preparedAgent;
}
