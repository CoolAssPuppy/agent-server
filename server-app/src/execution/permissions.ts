import type { Permissions } from '../agents/config.js';
import type { AgentConfig } from '../agents/config.js';
import { homedir } from 'node:os';
import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

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

type CanonicalFileAccessOptions = {
  cwd: string;
  grants: Array<{
    root: string;
    kind: 'file' | 'folder';
    access: 'read_only' | 'read_write';
  }>;
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

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    if (parent === path) return resolve(path);
    return join(canonicalPath(parent), basename(path));
  }
}

/** Resolve a reviewed path without following a later symlink outside its grant. */
export function canonicalFileAccessPath(path: string, cwd: string): string {
  return canonicalPath(expandedPath(path, cwd));
}

function grantContains(root: string, kind: 'file' | 'folder', requested: string): boolean {
  if (kind === 'file') return requested === root;
  const child = relative(root, requested);
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

function hasFileAccess(
  toolName: string,
  input: Record<string, unknown>,
  options: CanonicalFileAccessOptions,
): boolean {
  const isRead = READ_FILE_TOOLS.has(toolName);
  const isWrite = WRITE_FILE_TOOLS.has(toolName);
  if (toolName === 'Bash') return false;
  if (!isRead && !isWrite) return true;
  const requested = requestedPath(input, options.cwd);
  const path = requested ? canonicalPath(requested) : undefined;
  if (!path) return false;
  const matching = options.grants
    .filter((grant) => grantContains(grant.root, grant.kind, path))
    .sort((left, right) => (
      right.root.length - left.root.length
      || left.access.localeCompare(right.access)
    ));
  const effectiveGrant = matching[0];
  return Boolean(effectiveGrant && (isRead || effectiveGrant.access === 'read_write'));
}

export function buildCanUseTool(permissions: Permissions, fileOptions?: FileAccessOptions): CanUseToolFn {
  const canonicalFileOptions = fileOptions ? {
    cwd: fileOptions.cwd,
    grants: fileOptions.fileAccess.map((grant) => ({
      root: canonicalFileAccessPath(grant.path, fileOptions.cwd),
      kind: grant.kind,
      access: grant.access,
    })),
  } : undefined;
  return async (toolName, input) => {
    if (isToolAllowed(toolName, permissions)) {
      if (canonicalFileOptions && !hasFileAccess(toolName, input, canonicalFileOptions)) {
        return { behavior: 'deny', message: `Tool "${toolName}" cannot access that file or folder` };
      }
      return { behavior: 'allow' };
    }
    return { behavior: 'deny', message: `Tool "${toolName}" is not permitted by agent permissions` };
  };
}
