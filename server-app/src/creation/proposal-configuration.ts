import type { AgentConfig } from '../agents/config.js';
import { mcpServerKey } from '../agents/capabilities.js';
import type { CreationProposal } from './proposal-schema.js';

const FILE_READ_TOOLS = ['Read', 'Glob', 'Grep'] as const;
const FILE_WRITE_TOOLS = ['Write', 'Edit'] as const;
const WEB_TOOLS = ['WebFetch', 'WebSearch'] as const;

function serviceToolPattern(id: string): string | undefined {
  const normalized = mcpServerKey(id);
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
  const primaryPath = proposal.file_access[0]?.path;
  const watch = proposal.trigger.type === 'watch' && proposal.trigger.watched_path
    ? [{ path: proposal.trigger.watched_path }]
    : undefined;
  const notification = proposal.permissions.can_send_messages
    && proposal.notification_destination?.configured
    ? { channel: proposal.notification_destination.kind, on_complete: true, on_failure: true }
    : undefined;
  return {
    id,
    name: proposal.name,
    description: proposal.description,
    prompt: proposal.markdown_instructions,
    schedule: proposal.trigger.type === 'schedule' ? proposal.trigger.schedule : undefined,
    timezone: proposal.timezone,
    working_directory: primaryPath ?? proposal.trigger.watched_path,
    watch,
    tools: allow,
    disallowed_tools: [],
    permissions: { allow, deny: [] },
    max_turns: 20,
    enabled: false,
    executor: proposal.runtime?.executor,
    model: proposal.runtime?.model ?? undefined,
    codex_sandbox: proposal.permissions.can_modify_files || proposal.permissions.can_run_commands
      ? 'workspace-write'
      : 'read-only',
    notification,
  };
}

export function deriveProposalAgentId(name: string): string {
  const id = name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  if (!id) throw new Error('The proposed agent name cannot be used as a file name');
  return id;
}
