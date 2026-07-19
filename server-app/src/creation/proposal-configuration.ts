import type { AgentConfig } from '../agents/config.js';
import { mcpServerKey } from '../agents/capabilities.js';
import type { McpServerConfig } from '../agents/config.js';
import { mcpServicePermissionTools } from '../agents/mcp-service-profile.js';
import type { CreationProposal } from './proposal-schema.js';
import { dirname } from 'node:path';

const FILE_READ_TOOLS = ['Read', 'Glob', 'Grep'] as const;
const FILE_WRITE_TOOLS = ['Write', 'Edit'] as const;
const WEB_TOOLS = ['WebFetch', 'WebSearch'] as const;
const CALENDAR_READ_TOOLS = ['mcp__eventkit__list_calendars', 'mcp__eventkit__list_events'] as const;
const CALENDAR_WRITE_TOOLS = ['mcp__eventkit__create_event', 'mcp__eventkit__update_event'] as const;
const REMINDER_READ_TOOLS = ['mcp__eventkit__list_reminder_lists', 'mcp__eventkit__list_reminders'] as const;
const REMINDER_CREATE_TOOL = 'mcp__eventkit__create_reminder';
const REMINDER_COMPLETE_TOOL = 'mcp__eventkit__complete_reminder';

export type ProposalServiceBinding = {
  id: string;
  serverName: string;
  config?: McpServerConfig;
  connectionId?: string;
};

export type ProposalConfigurationOptions = {
  serviceBindings?: readonly ProposalServiceBinding[];
};

function explicitToolAllowlist(
  proposal: CreationProposal,
  bindings: ReadonlyMap<string, ProposalServiceBinding>,
): string[] {
  const allow = new Set<string>();
  if (proposal.file_access.length > 0) FILE_READ_TOOLS.forEach((tool) => allow.add(tool));
  if (proposal.permissions.can_modify_files) FILE_WRITE_TOOLS.forEach((tool) => allow.add(tool));
  if (proposal.permissions.can_run_commands) allow.add('Bash');
  if (proposal.calendar_access.length > 0) CALENDAR_READ_TOOLS.forEach((tool) => allow.add(tool));
  if (proposal.calendar_access.some((calendar) => calendar.access === 'read_write')) {
    CALENDAR_WRITE_TOOLS.forEach((tool) => allow.add(tool));
  }
  const reminderActions = new Set(
    proposal.native_services.reminders?.resources.flatMap((resource) => resource.actions) ?? [],
  );
  if (reminderActions.has('read')) REMINDER_READ_TOOLS.forEach((tool) => allow.add(tool));
  if (reminderActions.has('create')) allow.add(REMINDER_CREATE_TOOL);
  if (reminderActions.has('complete')) allow.add(REMINDER_COMPLETE_TOOL);
  if ((proposal.native_services.contacts?.resources.length ?? 0) > 0) {
    allow.add('mcp__eventkit__list_contacts');
  }

  const hasWebCapability = proposal.capabilities.some((capability) => (
    capability.required && ['browse-web', 'web', 'internet'].includes(capability.id.toLowerCase())
  ));
  if (proposal.permissions.requires_network && hasWebCapability) {
    WEB_TOOLS.forEach((tool) => allow.add(tool));
  }
  if (proposal.permissions.can_use_connected_apps) {
    proposal.connections.filter((connection) => connection.required).forEach((connection) => {
      const binding = bindings.get(connection.id);
      const serverKey = binding?.config
        ? binding.serverName
        : mcpServerKey(binding?.serverName ?? connection.id);
      mcpServicePermissionTools(serverKey, binding?.config).forEach((tool) => allow.add(tool));
    });
  }
  return [...allow];
}

/** Convert a reviewed proposal into a default-deny runtime configuration. */
export function proposalToAgentConfig(
  proposal: CreationProposal,
  id: string,
  options: ProposalConfigurationOptions = {},
): AgentConfig {
  const bindings = new Map((options.serviceBindings ?? []).map((binding) => [binding.id, binding]));
  const requiredConnections = proposal.permissions.can_use_connected_apps
    ? proposal.connections.filter((connection) => connection.required)
    : [];
  if (options.serviceBindings) {
    const missing = requiredConnections.find((connection) => !bindings.has(connection.id));
    if (missing) throw new Error(`Reviewed service binding is unavailable: ${missing.name}`);
    const runtimeNames = new Set<string>();
    for (const connection of requiredConnections) {
      const binding = bindings.get(connection.id);
      if (!binding) continue;
      const runtimeName = mcpServerKey(binding.serverName);
      if (runtimeNames.has(runtimeName)) {
        throw new Error(`Two reviewed services use the same runtime name: ${binding.serverName}`);
      }
      runtimeNames.add(runtimeName);
    }
  }
  const allow = explicitToolAllowlist(proposal, bindings);
  const mcpServers = Object.fromEntries(
    requiredConnections
      .flatMap((connection) => {
        const binding = bindings.get(connection.id);
        return binding?.config ? [[binding.serverName, binding.config] as const] : [];
      }),
  );
  const connectionBindings = Object.fromEntries(
    requiredConnections.flatMap((connection) => {
      const binding = bindings.get(connection.id);
      return binding?.connectionId
        ? [[binding.serverName, binding.connectionId] as const]
        : [];
    }),
  );
  const primaryPath = proposal.file_access[0]?.path;
  const workingDirectory = proposal.file_access[0]?.kind === 'file' && primaryPath
    ? dirname(primaryPath)
    : primaryPath;
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
    working_directory: workingDirectory ?? proposal.trigger.watched_path,
    file_access: proposal.file_access.map(({ path, kind, access }) => ({ path, kind, access })),
    watch,
    calendar_access: proposal.calendar_access.map(({ id: calendarId, name, account, access }) => ({
      id: calendarId,
      name,
      account,
      access,
    })),
    native_services: proposal.native_services,
    tools: allow,
    disallowed_tools: [],
    permissions: { allow, deny: [] },
    mcp_servers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
    connection_bindings: Object.keys(connectionBindings).length > 0 ? connectionBindings : undefined,
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
