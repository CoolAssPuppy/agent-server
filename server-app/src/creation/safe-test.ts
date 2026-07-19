import type { AgentConfig } from '../agents/config.js';
import { isToolPermitted } from '../execution/permission-policy.js';

const READ_TOOLS = ['Read', 'Glob', 'Grep'] as const;
const BLOCKED_TOOLS = [
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
  'WebFetch',
  'WebSearch',
  'web_search',
  'mcp__*',
] as const;

const SAFE_TEST_INSTRUCTIONS = `Safe test mode:
External actions are intentionally unavailable. Do not send messages, use connected services, access the internet, run commands, or create or change files. Review the instructions and available read-only setup. Report which external connection or permission the full agent would need instead of attempting the action.`;

/** Derive an in-memory run-only configuration. The saved definition is untouched. */
export function prepareSafeTestAgent(agent: AgentConfig): AgentConfig {
  const readTools = READ_TOOLS.filter((tool) => isToolPermitted(agent, tool));
  return {
    ...agent,
    prompt: `${agent.prompt}\n\n${SAFE_TEST_INSTRUCTIONS}`,
    schedule: undefined,
    watch: undefined,
    on_complete: undefined,
    on_failure: undefined,
    interaction: undefined,
    notification: undefined,
    conversation: undefined,
    tools: readTools,
    disallowed_tools: [...new Set([...agent.disallowed_tools, ...BLOCKED_TOOLS])],
    permissions: { allow: readTools, deny: [...BLOCKED_TOOLS] },
    mcp_servers: {},
    connection_bindings: undefined,
    codex_sandbox: 'read-only',
    permission_mode: 'dontAsk',
    max_turns: Math.min(agent.max_turns, 5),
    enabled: false,
  };
}

export function createSafeTestTrigger(dependencies: {
  getAgent(agentId: string): Promise<AgentConfig | undefined>;
  triggerAgent(agent: AgentConfig): string | Promise<string>;
}): (agentId: string) => Promise<string> {
  return async (agentId) => {
    const agent = await dependencies.getAgent(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    return dependencies.triggerAgent(prepareSafeTestAgent(agent));
  };
}
