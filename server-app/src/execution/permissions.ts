import type { Permissions } from '../agents/config.js';
import type { AgentConfig } from '../agents/config.js';
import { homedir } from 'node:os';
import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { AGENT_LOG_TOOL_NAME } from '../logging/log-tool.js';
import { AGENT_LOG_READ_TOOL_NAME } from '../logging/log-read-tool.js';
import { AGENT_DOCUMENT_READ_TOOL_NAME } from '../documents/tool-name.js';

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

type CanonicalGrant = {
  root: string;
  kind: 'file' | 'folder';
  access: 'read_only' | 'read_write';
};

/** Answers whether one path is inside the reviewed grants, for one kind of use. */
export type FileAccessCheck = (path: string, access: 'read' | 'write') => boolean;

/**
 * Every tool that takes a path belongs in one of these two sets. A tool in
 * neither is treated as taking no path at all and is never checked against the
 * grants, so a path-taking tool left out of both reads and writes anywhere the
 * process can reach. Adding a tool here is not optional bookkeeping.
 */
const READ_FILE_TOOLS = new Set(['Read', 'Glob', 'Grep', AGENT_DOCUMENT_READ_TOOL_NAME]);
const WRITE_FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

function expandedPath(path: string, cwd: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return resolve(homedir(), path.slice(2));
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}

/**
 * The argument each path-taking tool names its path with. The SDK's file tools
 * use `file_path` and `notebook_path`; the server's document reader uses
 * `path`, which is also what the SDK's directory tools use.
 */
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

function grantsAllow(path: string, access: 'read' | 'write', grants: CanonicalGrant[]): boolean {
  const matching = grants
    .filter((grant) => grantContains(grant.root, grant.kind, path))
    .sort((left, right) => (
      right.root.length - left.root.length
      || left.access.localeCompare(right.access)
    ));
  const effectiveGrant = matching[0];
  return Boolean(effectiveGrant && (access === 'read' || effectiveGrant.access === 'read_write'));
}

/**
 * Canonicalize the reviewed grants once, then test paths against them.
 *
 * Exported so a server-owned tool that takes a path can apply the same grants
 * from inside itself. The permission callback is the first gate; a tool that
 * opens a file the agent named should not be the only thing standing between a
 * mistake in the allowlist and the whole disk.
 */
export function createFileAccessCheck(options: FileAccessOptions): FileAccessCheck {
  const grants: CanonicalGrant[] = options.fileAccess.map((grant) => ({
    root: canonicalFileAccessPath(grant.path, options.cwd),
    kind: grant.kind,
    access: grant.access,
  }));
  return (path, access) => grantsAllow(canonicalFileAccessPath(path, options.cwd), access, grants);
}

function hasFileAccess(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
  canAccessFile: FileAccessCheck,
): boolean {
  const isRead = READ_FILE_TOOLS.has(toolName);
  const isWrite = WRITE_FILE_TOOLS.has(toolName);
  if (toolName === 'Bash') return false;
  if (!isRead && !isWrite) return true;
  const requested = requestedPath(input, cwd);
  if (!requested) return false;
  return canAccessFile(requested, isWrite ? 'write' : 'read');
}

export function buildCanUseTool(permissions: Permissions, fileOptions?: FileAccessOptions): CanUseToolFn {
  const fileGate = fileOptions
    ? { cwd: fileOptions.cwd, canAccessFile: createFileAccessCheck(fileOptions) }
    : undefined;
  return async (toolName, input) => {
    // The log tool takes no path and writes only where the server puts it, so it
    // needs no allowlist entry. An agent that explicitly denies it still wins.
    // The document tool is deliberately not in this branch: it takes a path, so
    // it is allowed only where the agent allows it and only inside the grants.
    const isLogTool = toolName === AGENT_LOG_TOOL_NAME || toolName === AGENT_LOG_READ_TOOL_NAME;
    if (isLogTool && !matchesAnyPattern(toolName, permissions.deny)) {
      return { behavior: 'allow' };
    }
    if (isToolAllowed(toolName, permissions)) {
      if (fileGate && !hasFileAccess(toolName, input, fileGate.cwd, fileGate.canAccessFile)) {
        return { behavior: 'deny', message: `Tool "${toolName}" cannot access that file or folder` };
      }
      return { behavior: 'allow' };
    }
    return { behavior: 'deny', message: `Tool "${toolName}" is not permitted by agent permissions` };
  };
}
