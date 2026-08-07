import type { AgentConfig } from '../agents/config.js';
import { canonicalFileAccessPath } from '../execution/permissions.js';

const PROFILE_NAME = 'agent-server';

export type CodexCommand = {
  executable: string;
  arguments: string[];
};

/** Build the permission-profile overrides used by file-scoped Codex runs. */
export function buildCodexPermissionOverrides(agent: AgentConfig): string[] {
  const cwd = agent.working_directory ?? process.env.HOME ?? process.cwd();
  const entries = new Map<string, 'read' | 'write'>([
    [':minimal', 'read'],
    ['/System/Library', 'read'],
  ]);
  for (const grant of agent.file_access ?? []) {
    const path = canonicalFileAccessPath(grant.path, cwd);
    const access = grant.access === 'read_write' ? 'write' : 'read';
    const existing = entries.get(path);
    if (existing !== 'write') entries.set(path, access);
  }
  const filesystem = [...entries]
    .map(([path, access]) => `${JSON.stringify(path)} = ${JSON.stringify(access)}`)
    .join(', ');
  return [
    `default_permissions=${JSON.stringify(PROFILE_NAME)}`,
    `permissions.${PROFILE_NAME}.filesystem={${filesystem}}`,
  ];
}

/** Resolve the installed Codex CLI required by file-scoped runs. */
export function resolveCodexCommand(codexExecutablePath?: string): CodexCommand {
  if (codexExecutablePath) return { executable: codexExecutablePath, arguments: [] };
  throw new Error('Codex is not installed. Install Codex or choose another coding agent.');
}
