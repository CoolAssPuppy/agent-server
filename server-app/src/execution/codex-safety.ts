import type { AgentConfig } from '../agents/config.js';
import { isToolAllowed } from './permissions.js';

export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

// Tool names mirror the consumer capability catalog (agents/capabilities.ts):
// "write your files" -> Write/Edit, "run commands" -> Bash, "search the web" ->
// WebFetch/WebSearch. Keeping these lists aligned is what lets a UI toggle
// translate into a Codex sandbox setting.
const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const EXEC_TOOLS = ['Bash'];
const NETWORK_TOOLS = ['WebFetch', 'WebSearch'];

/**
 * Whether a tool is permitted for an agent under its declared permission model.
 * A `permissions` block is an allowlist (deny wins, default deny). Otherwise the
 * `tools`/`disallowed_tools` model applies: an empty `tools` list means "all
 * allowed" (matching how the Claude executor sets `allowedTools`).
 */
export function isToolPermitted(agent: AgentConfig, tool: string): boolean {
  if (agent.permissions) {
    return isToolAllowed(tool, agent.permissions);
  }
  if (agent.disallowed_tools?.includes(tool)) return false;
  if (agent.tools.length > 0 && !agent.tools.includes(tool)) return false;
  return true;
}

/** Whether a tool is *explicitly* granted (present in the allowlist), never by default. */
function isToolExplicitlyGranted(agent: AgentConfig, tool: string): boolean {
  if (agent.permissions) {
    return isToolAllowed(tool, agent.permissions);
  }
  return agent.tools.includes(tool) && !(agent.disallowed_tools?.includes(tool) ?? false);
}

/**
 * Translate an agent's capability/permission model into a Codex sandbox mode,
 * so the UI toggles still gate a Codex-run agent (the toggles map to Claude's
 * tool allowlist, which Codex otherwise ignores). The mapping is deliberately
 * conservative and coarse — Codex safety is broad tiers, not per-tool:
 *
 * - An explicit `codex_sandbox` on the agent always wins.
 * - `permission_mode: plan` forces read-only.
 * - If the agent may write files or run commands -> workspace-write.
 * - Otherwise -> read-only.
 *
 * `danger-full-access` is never derived automatically; it must be set explicitly.
 * The default (an agent with no tool restrictions) still resolves to
 * workspace-write, preserving prior Codex behavior.
 */
export function deriveCodexSandbox(agent: AgentConfig): CodexSandboxMode {
  const explicit = agent.codex_sandbox;
  if (explicit === 'read-only' || explicit === 'workspace-write' || explicit === 'danger-full-access') {
    return explicit;
  }

  if (agent.permission_mode === 'plan') return 'read-only';

  const canWrite = WRITE_TOOLS.some((tool) => isToolPermitted(agent, tool));
  const canExecute = EXEC_TOOLS.some((tool) => isToolPermitted(agent, tool));
  return canWrite || canExecute ? 'workspace-write' : 'read-only';
}

/**
 * Whether the Codex run may access the network. Off by default (preserving
 * prior Codex behavior); on only when a web tool is *explicitly* granted, so
 * the "search the web" toggle keeps its meaning without silently opening the
 * network for every agent.
 */
export function deriveCodexNetworkAccess(agent: AgentConfig): boolean {
  return NETWORK_TOOLS.some((tool) => isToolExplicitlyGranted(agent, tool));
}
