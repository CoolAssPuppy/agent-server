import type { Permissions } from '../agents/config.js';

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

export function buildCanUseTool(permissions: Permissions): CanUseToolFn {
  return async (toolName) => {
    if (isToolAllowed(toolName, permissions)) {
      return { behavior: 'allow' };
    }
    return { behavior: 'deny', message: `Tool "${toolName}" is not permitted by agent permissions` };
  };
}
