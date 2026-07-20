import { realpath, readFile, stat, writeFile } from 'fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'path';
import type { AgentConfig } from '../agents/config.js';
import { expandHome } from '../agents/file-watcher.js';
import { isToolPermitted } from '../execution/permission-policy.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024;

type FileGrant = {
  path: string;
  kind: 'file' | 'folder';
  canWrite: boolean;
};

export type KimiFilePolicy = {
  readTextFile: (path: string, line?: number | null, limit?: number | null) => Promise<string>;
  writeTextFile: (path: string, content: string) => Promise<void>;
};

export function assertKimiSafety(agent: AgentConfig): void {
  if ((agent.file_access?.length ?? 0) > 0 && isToolPermitted(agent, 'Bash')) {
    throw new Error('Kimi Code cannot enforce exact file access while command execution is allowed.');
  }
}

export async function createKimiFilePolicy(agent: AgentConfig): Promise<KimiFilePolicy> {
  const configured = agent.file_access ?? [{
    path: kimiWorkingDirectory(agent),
    kind: 'folder' as const,
    access: 'read_write' as const,
  }];
  const grants = await Promise.all(configured.map(async (grant): Promise<FileGrant> => ({
    path: await canonicalGrantPath(expandHome(grant.path), grant.kind),
    kind: grant.kind,
    canWrite: grant.access === 'read_write',
  })));

  return {
    readTextFile: async (path, line, limit) => {
      await assertFileAccess(agent, grants, path, false);
      const file = await stat(path);
      if (file.size > MAX_FILE_BYTES) throw new Error('The requested file is too large to read safely.');
      return sliceLines(await readFile(path, 'utf8'), line, limit);
    },
    writeTextFile: async (path, content) => {
      if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
        throw new Error('The requested file is too large to write safely.');
      }
      await assertFileAccess(agent, grants, path, true);
      await writeFile(path, content, 'utf8');
    },
  };
}

export function kimiWorkingDirectory(agent: AgentConfig): string {
  return resolve(expandHome(agent.working_directory ?? process.env.HOME ?? process.cwd()));
}

export function kimiAdditionalDirectories(agent: AgentConfig): string[] {
  const cwd = kimiWorkingDirectory(agent);
  return [...new Set((agent.file_access ?? [])
    .filter((grant) => grant.kind === 'folder')
    .map((grant) => resolve(expandHome(grant.path)))
    .filter((path) => path !== cwd))];
}

async function assertFileAccess(
  agent: AgentConfig,
  grants: FileGrant[],
  path: string,
  isWrite: boolean,
): Promise<void> {
  const canUseTool = isWrite
    ? isToolPermitted(agent, 'Write') || isToolPermitted(agent, 'Edit')
    : isToolPermitted(agent, 'Read');
  const target = await canonicalTargetPath(path, isWrite);
  const allowed = canUseTool && grants.some((grant) => (
    (!isWrite || grant.canWrite) && contains(grant, target)
  ));
  if (!allowed) throw new Error(`${isWrite ? 'Writing' : 'Reading'} ${path} is not permitted.`);
}

async function canonicalGrantPath(path: string, kind: 'file' | 'folder'): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    if (kind === 'folder') throw new Error(`Kimi Code cannot access missing folder ${path}.`);
    return canonicalTargetPath(path, true);
  }
}

async function canonicalTargetPath(path: string, mayNotExist: boolean): Promise<string> {
  if (!isAbsolute(path)) throw new Error(`Path ${path} is not permitted.`);
  try {
    return await realpath(path);
  } catch {
    if (!mayNotExist) throw new Error(`Path ${path} is not permitted.`);
    return resolve(await realpath(dirname(path)), basename(path));
  }
}

function contains(grant: FileGrant, target: string): boolean {
  if (grant.kind === 'file') return grant.path === target;
  const child = relative(grant.path, target);
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

function sliceLines(content: string, line?: number | null, limit?: number | null): string {
  if (line === undefined && limit === undefined) return content;
  const lines = content.split('\n');
  const start = Math.max(0, (line ?? 1) - 1);
  return lines.slice(start, limit ? start + limit : undefined).join('\n');
}
