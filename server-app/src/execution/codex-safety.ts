import type { AgentConfig } from '../agents/config.js';
import {
  COMMAND_TOOLS,
  NETWORK_TOOLS,
  WRITE_TOOLS,
  hasAnyPermittedTool,
  isToolExplicitlyGranted,
} from './permission-policy.js';
export { isToolPermitted } from './permission-policy.js';

export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

// Tool names mirror the consumer capability catalog (agents/capabilities.ts):
// "write your files" -> Write/Edit, "run commands" -> Bash, "search the web" ->
// WebFetch/WebSearch. Keeping these lists aligned is what lets a UI toggle
// translate into a Codex sandbox setting.

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

  const canWrite = hasAnyPermittedTool(agent, WRITE_TOOLS);
  const canExecute = hasAnyPermittedTool(agent, COMMAND_TOOLS);
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
