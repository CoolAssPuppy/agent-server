import { readdir, readFile } from 'fs/promises';
import { join, extname } from 'path';
import { type AgentConfig, parseAgentYaml } from './agent-config.js';

const YAML_EXTENSIONS = new Set(['.yaml', '.yml']);

function isYamlFile(filename: string): boolean {
  return YAML_EXTENSIONS.has(extname(filename));
}

async function tryParseAgent(directory: string, file: string): Promise<AgentConfig | null> {
  try {
    const content = await readFile(join(directory, file), 'utf-8');
    return parseAgentYaml(content);
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

  const yamlFiles = entries.filter(isYamlFile).sort();
  const results = await Promise.all(yamlFiles.map((file) => tryParseAgent(directory, file)));

  return results
    .filter((agent): agent is AgentConfig => agent !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}
