import { readdir, readFile } from 'fs/promises';
import { join, extname } from 'path';
import { sanitizeText } from '../server/security-utils.js';
import { type AgentConfig, parseAgentFile } from './config.js';

export const AGENT_EXTENSIONS = new Set(['.yaml', '.yml', '.md']);

export function isAgentFile(filename: string): boolean {
  return AGENT_EXTENSIONS.has(extname(filename));
}

export type DiscoveryOptions = {
  readdir?: (directory: string) => Promise<string[]>;
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  warn?: (message: string) => void;
  /**
   * Called with the coarse failure code for each definition that could not be
   * loaded. Separate from `warn` because the warning carries the filename and
   * this does not: a filename is user-authored text that must not be reported
   * anywhere off the machine.
   */
  onInvalid?: (code: string) => void;
};

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function invalidDefinitionCode(error: unknown): string {
  if (!(error instanceof Error)) return 'INVALID_DEFINITION';
  if (error.name === 'YAMLParseError') return 'YAML_PARSE_ERROR';
  if (error.name === 'ZodError') return 'SCHEMA_VALIDATION_ERROR';
  return 'INVALID_DEFINITION';
}

export class AgentDiscoveryError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(path: string, code: string) {
    const safePath = sanitizeText(path, 500);
    super(`Cannot read agent directory "${safePath}" (${code})`);
    this.name = 'AgentDiscoveryError';
    this.code = code;
    this.path = safePath;
  }
}

async function tryParseAgent(
  directory: string,
  file: string,
  options: Required<Pick<DiscoveryOptions, 'readFile' | 'warn' | 'onInvalid'>>,
): Promise<AgentConfig | null> {
  let content: string;
  try {
    content = await options.readFile(join(directory, file), 'utf-8');
  } catch (error) {
    const code = errorCode(error) ?? 'READ_FAILED';
    options.warn(`[agent-discovery] Cannot read agent file "${sanitizeText(file, 240)}" (${code})`);
    options.onInvalid(code);
    return null;
  }

  try {
    return parseAgentFile(content);
  } catch (error) {
    const code = invalidDefinitionCode(error);
    options.warn(`[agent-discovery] Invalid agent file "${sanitizeText(file, 240)}" (${code})`);
    options.onInvalid(code);
    return null;
  }
}

export async function discoverAgents(
  directory: string,
  options: DiscoveryOptions = {},
): Promise<AgentConfig[]> {
  const readDirectory = options.readdir ?? readdir;
  const readAgentFile = options.readFile ?? readFile;
  const warn = options.warn ?? console.warn;
  const onInvalid = options.onInvalid ?? (() => {});
  let entries: string[];
  try {
    entries = await readDirectory(directory);
  } catch (error) {
    const code = errorCode(error) ?? 'READ_FAILED';
    if (code === 'ENOENT') return [];
    throw new AgentDiscoveryError(directory, code);
  }

  const agentFiles = entries.filter(isAgentFile).sort();
  const results = await Promise.all(
    agentFiles.map((file) => tryParseAgent(directory, file, {
      readFile: readAgentFile,
      warn,
      onInvalid,
    }))
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
