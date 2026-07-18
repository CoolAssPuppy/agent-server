import type { Permissions } from '../agents/config.js';
import type { AgentConfig } from '../agents/config.js';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';

export function matchesPattern(toolName: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(toolName);
}

function matchesAnyPattern(toolName: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesPattern(toolName, p));
}

export function isToolAllowed(toolName: string, permissions: Permissions): boolean {
  if (matchesAnyPattern(toolName, permissions.deny)) return false;
  if (matchesAnyPattern(toolName, permissions.allow)) return true;
  return false;
}

type PermissionResult =
  | { behavior: 'allow' }
  | { behavior: 'deny'; message: string };

type CanUseToolFn = (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal; toolUseID: string },
) => Promise<PermissionResult>;

type FileAccessOptions = {
  cwd: string;
  fileAccess: NonNullable<AgentConfig['file_access']>;
};

const READ_FILE_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const WRITE_FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

function expandedPath(path: string, cwd: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return resolve(homedir(), path.slice(2));
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}

function requestedPath(input: Record<string, unknown>, cwd: string): string | undefined {
  const value = input.file_path ?? input.notebook_path ?? input.path;
  return typeof value === 'string' && value.length > 0 ? expandedPath(value, cwd) : undefined;
}

function grantContains(
  grant: NonNullable<AgentConfig['file_access']>[number],
  requested: string,
  cwd: string,
): boolean {
  const root = expandedPath(grant.path, cwd);
  if (grant.kind === 'file') return requested === root;
  const child = relative(root, requested);
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

function hasFileAccess(
  toolName: string,
  input: Record<string, unknown>,
  options: FileAccessOptions,
): boolean {
  const isRead = READ_FILE_TOOLS.has(toolName);
  const isWrite = WRITE_FILE_TOOLS.has(toolName);
  if (!isRead && !isWrite) return true;
  const path = requestedPath(input, options.cwd);
  if (!path) return false;
  return options.fileAccess.some((grant) => (
    grantContains(grant, path, options.cwd)
    && (isRead || grant.access === 'read_write')
  ));
}

export function buildCanUseTool(permissions: Permissions, fileOptions?: FileAccessOptions): CanUseToolFn {
  return async (toolName, input) => {
    if (isToolAllowed(toolName, permissions)) {
      if (fileOptions && !hasFileAccess(toolName, input, fileOptions)) {
        return { behavior: 'deny', message: `Tool "${toolName}" cannot access that file or folder` };
      }
      return { behavior: 'allow' };
    }
    return { behavior: 'deny', message: `Tool "${toolName}" is not permitted by agent permissions` };
  };
}
