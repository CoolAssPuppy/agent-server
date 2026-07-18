import type { AgentConfig } from '../agents/config.js';
import type { CreationProposal } from './proposal-schema.js';

const FILE_READ_TOOLS = ['Read', 'Glob', 'Grep'] as const;
const FILE_WRITE_TOOLS = ['Write', 'Edit'] as const;
const WEB_TOOLS = ['WebFetch', 'WebSearch'] as const;

function serviceToolPattern(id: string): string | undefined {
  const normalized = id.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return normalized.length > 0 ? `mcp__${normalized}__*` : undefined;
}

function explicitToolAllowlist(proposal: CreationProposal): string[] {
  const allow = new Set<string>();
  if (proposal.file_access.length > 0) FILE_READ_TOOLS.forEach((tool) => allow.add(tool));
  if (proposal.permissions.can_modify_files) FILE_WRITE_TOOLS.forEach((tool) => allow.add(tool));
  if (proposal.permissions.can_run_commands) allow.add('Bash');

  const hasWebCapability = proposal.capabilities.some((capability) => (
    capability.required && ['browse-web', 'web', 'internet'].includes(capability.id.toLowerCase())
  ));
  if (proposal.permissions.requires_network && hasWebCapability) {
    WEB_TOOLS.forEach((tool) => allow.add(tool));
  }
  if (proposal.permissions.can_use_connected_apps) {
    proposal.connections.filter((connection) => connection.required).forEach((connection) => {
      const tool = serviceToolPattern(connection.id);
      if (tool) allow.add(tool);
    });
  }
  return [...allow];
}

/** Convert a reviewed proposal into a default-deny runtime configuration. */
export function proposalToAgentConfig(proposal: CreationProposal, id: string): AgentConfig {
  const allow = explicitToolAllowlist(proposal);
  return {
    id,
    name: proposal.name,
    description: proposal.description,
    prompt: proposal.markdown_instructions,
    schedule: proposal.trigger.type === 'schedule' ? proposal.trigger.schedule : undefined,
    timezone: proposal.timezone,
    tools: allow,
    disallowed_tools: [],
    permissions: { allow, deny: [] },
    max_turns: 20,
    enabled: false,
    executor: proposal.runtime?.executor,
    model: proposal.runtime?.model ?? undefined,
    codex_sandbox: proposal.permissions.can_modify_files ? 'workspace-write' : 'read-only',
  };
}
