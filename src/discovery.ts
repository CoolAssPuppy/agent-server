import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { type AgentConfig, parseAgentYaml } from './agent-config.js';

const YAML_EXTENSIONS = new Set(['.yaml', '.yml']);

function isYamlFile(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.'));
  return YAML_EXTENSIONS.has(ext);
}

export async function discoverAgents(directory: string): Promise<AgentConfig[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }

  const yamlFiles = entries.filter(isYamlFile).sort();
  const agents: AgentConfig[] = [];

  for (const file of yamlFiles) {
    try {
      const content = await readFile(join(directory, file), 'utf-8');
      agents.push(parseAgentYaml(content));
    } catch {
      console.warn(`Skipping invalid agent definition: ${file}`);
    }
  }

  return agents.sort((a, b) => a.id.localeCompare(b.id));
}
