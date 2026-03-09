import { readdir, readFile } from 'fs/promises';
import { join, extname } from 'path';
import { type AgentConfig, parseAgentFile } from './config.js';

export const AGENT_EXTENSIONS = new Set(['.yaml', '.yml', '.md']);

function isAgentFile(filename: string): boolean {
  return AGENT_EXTENSIONS.has(extname(filename));
}

async function tryParseAgent(directory: string, file: string): Promise<AgentConfig | null> {
  try {
    const content = await readFile(join(directory, file), 'utf-8');
    return parseAgentFile(content);
  } catch {
    console.warn(`Skipping invalid agent definition: ${file}`);
    return null;
  }
}

export async function discoverAgents(directory: string): Promise<AgentConfig[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }

  const agentFiles = entries.filter(isAgentFile).sort();
  const results = await Promise.all(agentFiles.map((file) => tryParseAgent(directory, file)));

  return results
    .filter((agent): agent is AgentConfig => agent !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}
