import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { Document } from 'yaml';
import { AgentConfigSchema, parseAgentFile, type AgentConfig } from './config.js';
import { AGENT_EXTENSIONS } from './discovery.js';

export type ReviewedAgentWriteResult = { agent: AgentConfig; content: string };

export class ReviewedAgentWriteError extends Error {
  constructor(message: string, readonly code: 'already_exists' | 'invalid') {
    super(message);
    this.name = 'ReviewedAgentWriteError';
  }
}

async function hasAgentId(directory: string, id: string): Promise<boolean> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!AGENT_EXTENSIONS.has(extname(entry))) continue;
    try {
      const content = await readFile(join(directory, entry), 'utf8');
      if (parseAgentFile(content).id === id) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export function renderReviewedAgentFile(input: AgentConfig): string {
  const agent = AgentConfigSchema.parse(input);
  if (!agent.permissions) {
    throw new ReviewedAgentWriteError('Reviewed agents require explicit tool permissions', 'invalid');
  }
  if (agent.permission_mode === 'bypassPermissions' || agent.codex_sandbox === 'danger-full-access') {
    throw new ReviewedAgentWriteError('Reviewed agents cannot bypass safety restrictions', 'invalid');
  }

  const { prompt, ...frontmatter } = agent;
  const document = new Document(frontmatter);
  return `---\n${document.toString()}---\n\n${prompt}\n`;
}

export async function writeReviewedAgent(
  directory: string,
  input: AgentConfig,
): Promise<ReviewedAgentWriteResult> {
  const content = renderReviewedAgentFile(input);
  const agent = parseAgentFile(content);
  if (await hasAgentId(directory, agent.id)) {
    throw new ReviewedAgentWriteError(`An agent named "${agent.name}" already exists`, 'already_exists');
  }

  await mkdir(directory, { recursive: true });
  try {
    await writeFile(join(directory, `${agent.id}.md`), content, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new ReviewedAgentWriteError(`An agent named "${agent.name}" already exists`, 'already_exists');
    }
    throw error;
  }
  return { agent, content };
}
