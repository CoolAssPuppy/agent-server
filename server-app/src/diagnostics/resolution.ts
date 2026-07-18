import type { AgentConfig } from '../agents/config.js';
import type { DiagnosticResult } from '../analysis/models.js';
import { ConfigurationPatchSchema, type ConfigurationPatch } from '../analysis/patch.js';
import { computeAgentContentHash } from '../analysis/security-rules.js';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';

export type DiagnosticResolution =
  | {
    type: 'configuration_patch';
    patch: ConfigurationPatch;
    preview_endpoint: '/configuration-patches/preview';
    apply_endpoint: '/configuration-patches/apply';
    confirmation_required: boolean;
  }
  | { type: 'connect'; action_id: string; label: string }
  | { type: 'choose_path'; action_id: string; label: string }
  | { type: 'retry'; retry_endpoint: string; confirmation_required: boolean }
  | { type: 'manual'; action_id: string; label: string; limitation?: string };

function expandedPath(path: string, workingDirectory: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return resolve(homedir(), path.slice(2));
  return isAbsolute(path) ? resolve(path) : resolve(workingDirectory, path);
}

function reviewedWritableGrant(agent: AgentConfig, writtenPath: string) {
  const cwd = agent.working_directory ?? homedir();
  const target = expandedPath(writtenPath, cwd);
  return agent.file_access
    ?.filter((grant) => {
      const root = expandedPath(grant.path, cwd);
      if (grant.kind === 'file') return root === target;
      const child = relative(root, target);
      return child === '' || (!child.startsWith('..') && !isAbsolute(child));
    })
    .sort((left, right) => right.path.length - left.path.length)[0];
}

function debuggerPatch(
  diagnosis: DiagnosticResult,
  agent: AgentConfig,
  content: string,
): ConfigurationPatch | undefined {
  if (diagnosis.source !== 'deterministic') return undefined;
  const base = {
    schema_version: 1 as const,
    agent_id: agent.id,
    expected_content_hash: computeAgentContentHash(content),
    source: 'debugger' as const,
    reason: diagnosis.suggested_fix.label,
  };
  if (diagnosis.suggested_fix.id === 'review-write-access') {
    const writtenPath = diagnosis.evidence.find((item) => item.code === 'write-path')?.detail;
    const reviewedGrant = writtenPath ? reviewedWritableGrant(agent, writtenPath) : undefined;
    if (!reviewedGrant || !agent.file_access) return undefined;
    const added = ['Write', 'Edit'];
    const allow = [...new Set([...(agent.permissions?.allow ?? agent.tools), ...added])];
    return ConfigurationPatchSchema.parse({
      ...base,
      changes: {
        file_access: agent.file_access.map((grant) => (
          grant === reviewedGrant ? { ...grant, access: 'read_write' as const } : grant
        )),
        tools: [...new Set([...agent.tools, ...added])],
        disallowed_tools: agent.disallowed_tools.filter((tool) => !added.includes(tool)),
        permissions: {
          allow,
          deny: (agent.permissions?.deny ?? []).filter((tool) => !added.includes(tool)),
        },
        codex_sandbox: 'workspace-write',
      },
    });
  }
  if (diagnosis.suggested_fix.id === 'review-network-access') {
    return ConfigurationPatchSchema.parse({ ...base, changes: { network_access: true } });
  }
  return undefined;
}

export function buildDiagnosticResolution(
  diagnosis: DiagnosticResult,
  agent: AgentConfig,
  content?: string,
): DiagnosticResolution {
  const patch = content ? debuggerPatch(diagnosis, agent, content) : undefined;
  if (patch) {
    return {
      type: 'configuration_patch',
      patch,
      preview_endpoint: '/configuration-patches/preview',
      apply_endpoint: '/configuration-patches/apply',
      confirmation_required: diagnosis.suggested_fix.requires_confirmation,
    };
  }
  const action = diagnosis.suggested_fix;
  if (action.id === 'review-write-access') {
    return {
      type: 'manual',
      action_id: action.id,
      label: action.label,
      limitation: 'Choose the exact file or folder before allowing changes.',
    };
  }
  if (action.kind === 'connect') return { type: 'connect', action_id: action.id, label: action.label };
  if (action.kind === 'choose_path') return { type: 'choose_path', action_id: action.id, label: action.label };
  if (action.kind === 'retry') {
    return {
      type: 'retry',
      retry_endpoint: `/guidance/runs/${diagnosis.run_id}/retry`,
      confirmation_required: diagnosis.rerun_safety !== 'safe',
    };
  }
  return {
    type: 'manual',
    action_id: action.id,
    label: action.label,
    ...(action.kind === 'configuration_patch'
      ? { limitation: 'No validated automatic change is available for this diagnosis.' }
      : {}),
  };
}
