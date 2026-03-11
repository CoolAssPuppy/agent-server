import { readdir, readFile } from 'fs/promises';
import { join, extname } from 'path';
import { type AgentConfig, parseAgentFile } from './config.js';

export const AGENT_EXTENSIONS = new Set(['.yaml', '.yml', '.md']);

function isAgentFile(filename: string): boolean {
  return AGENT_EXTENSIONS.has(extname(filename));
}

type DiscoverAgentOptions = {
  defaultMaxTurns?: number;
};

async function tryParseAgent(directory: string, file: string, options: DiscoverAgentOptions = {}): Promise<AgentConfig | null> {
  try {
    const content = await readFile(join(directory, file), 'utf-8');
    return parseAgentFile(content, { defaultMaxTurns: options.defaultMaxTurns });
  } catch {
    console.warn(`Skipping invalid agent definition: ${file}`);
    return null;
  }
}

export async function discoverAgents(directory: string, options: DiscoverAgentOptions = {}): Promise<AgentConfig[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }

  const agentFiles = entries.filter(isAgentFile).sort();
  const results = await Promise.all(
    agentFiles.map((file) => tryParseAgent(directory, file, options))
  );

  const unique = new Map<string, AgentConfig>();
  for (const agent of results) {
    if (!agent) continue;

    if (unique.has(agent.id)) {
      console.warn(`Skipping duplicate agent id: ${agent.id}`);
      continue;
    }

    unique.set(agent.id, agent);
  }

  return [...unique.values()]
    .sort((a, b) => a.id.localeCompare(b.id));
}
