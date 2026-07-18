import { resolve } from 'path';
import type { AgentConfig } from '../agents/config.js';
import { isToolAllowed } from './permissions.js';

export const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'] as const;
export const COMMAND_TOOLS = ['Bash'] as const;
export const NETWORK_TOOLS = ['WebFetch', 'WebSearch', 'web_search'] as const;

/** Apply the single effective tool policy used by runtimes and analyzers. */
export function isToolPermitted(agent: AgentConfig, tool: string): boolean {
  if (agent.permissions) return isToolAllowed(tool, agent.permissions);
  if (agent.disallowed_tools.includes(tool)) return false;
  return agent.tools.length === 0 || agent.tools.includes(tool);
}

/** Return true only when a tool was deliberately added to an allowlist. */
export function isToolExplicitlyGranted(agent: AgentConfig, tool: string): boolean {
  if (agent.permissions) return isToolAllowed(tool, agent.permissions);
  return agent.tools.includes(tool) && !agent.disallowed_tools.includes(tool);
}

export function hasAnyPermittedTool(agent: AgentConfig, tools: readonly string[]): boolean {
  return tools.some((tool) => isToolPermitted(agent, tool));
}

export function effectiveWorkingDirectory(agent: AgentConfig, homeDir: string): string {
  const configured = agent.working_directory;
  if (!configured || configured === '~') return resolve(homeDir);
  if (configured.startsWith('~/')) return resolve(homeDir, configured.slice(2));
  return resolve(configured);
}

export function hasRemoteMcp(agent: AgentConfig): boolean {
  return Object.values(agent.mcp_servers ?? {}).some((server) => 'url' in server);
}

export function hasRemoteProvider(agent: AgentConfig): boolean {
  if (!agent.provider) return false;
  const hostname = new URL(agent.provider.base_url).hostname;
  return hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]';
}

/** Describe network access as it is actually granted to the selected runtime. */
export function hasEffectiveNetworkAccess(agent: AgentConfig): boolean {
  if (hasRemoteMcp(agent) || hasRemoteProvider(agent)) return true;
  if ((agent.executor ?? 'claude-code') === 'codex') {
    return NETWORK_TOOLS.some((tool) => isToolExplicitlyGranted(agent, tool));
  }
  return hasAnyPermittedTool(agent, NETWORK_TOOLS);
}
