import type { AgentConfig } from '../agents/config.js';
import type { McpServerConfig } from '../agents/config.js';
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
  serviceType?: string;
  actions?: readonly ('read' | 'write' | 'send' | 'delete')[];
};

export type ProposalConfigurationOptions = {
  serviceBindings?: readonly ProposalServiceBinding[];
};

type ServiceAction = NonNullable<ProposalServiceBinding['actions']>[number];

const PORTABLE_OPERATIONS: Readonly<Record<
  string,
  Partial<Record<ServiceAction, readonly string[]>>
>> = {
  notion: {
    read: ['notion.search', 'notion.data_source.query', 'notion.page.read'],
    write: ['notion.page.create'],
    delete: ['notion.page.delete'],
  },
  slack: {
    read: ['slack.message.search', 'slack.message.read', 'slack.thread.read'],
    write: ['slack.message.update'],
    send: ['slack.message.send'],
    delete: ['slack.message.delete'],
  },
  linear: {
    read: ['linear.issue.search', 'linear.issue.read', 'linear.comment.read'],
    write: ['linear.issue.create', 'linear.issue.update'],
    delete: ['linear.issue.delete'],
  },
  gmail: {
    read: ['gmail.message.search', 'gmail.message.read'],
    write: ['gmail.draft.create'],
    send: ['gmail.message.send'],
    delete: ['gmail.message.delete'],
  },
  calendar: {
    read: ['calendar.calendar.list', 'calendar.event.list'],
    write: ['calendar.event.create'],
    delete: ['calendar.event.delete'],
  },
  github: {
    read: ['github.repository.read', 'github.issue.search', 'github.issue.read'],
    write: ['github.issue.create', 'github.issue.update'],
    delete: ['github.issue.delete'],
  },
};

function operationsFor(type: string, actions: readonly ServiceAction[]): string[] {
  return [...new Set(actions.flatMap((action) => (
    PORTABLE_OPERATIONS[type]?.[action] ?? [`${type}.${action}`]
  )))];
}

function resourcesFor(
  type: string,
  name: string,
  actions: readonly ServiceAction[],
): NonNullable<AgentConfig['connections']>[string]['resources'] {
  if (type === 'notion' && actions.includes('write')) {
    return {
      output_destination: {
        type: 'notion.data_source',
        purpose: `Approved destination used by ${name}.`,
        access: 'write',
      },
    };
  }
  return {};
}

function explicitToolAllowlist(
  proposal: CreationProposal,
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
  return [...allow];
}

function portableIdentifier(value: string, fallback: string): string {
  const normalized = value.toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
    .replace(/_+$/g, '');
  if (/^[a-z]/.test(normalized)) return normalized;
  return fallback;
}

function serviceType(
  connection: CreationProposal['connections'][number],
  binding: ProposalServiceBinding | undefined,
): string {
  return portableIdentifier(
    binding?.serviceType ?? connection.id.split(':')[0] ?? connection.name,
    'service',
  );
}

function portableConnections(
  connections: readonly CreationProposal['connections'][number][],
  bindings: ReadonlyMap<string, ProposalServiceBinding>,
): NonNullable<AgentConfig['connections']> {
  const usedKeys = new Set<string>();
  return Object.fromEntries(connections.map((connection) => {
    const binding = bindings.get(connection.id);
    const type = serviceType(connection, binding);
    const baseKey = portableIdentifier(connection.name, type);
    let key = baseKey;
    for (let suffix = 2; usedKeys.has(key); suffix += 1) {
      key = `${baseKey.slice(0, 61)}_${suffix}`;
    }
    usedKeys.add(key);
    const actions = binding?.actions && binding.actions.length > 0
      ? [...new Set(binding.actions)]
      : ['read'] as const;
    return [key, {
      type,
      name: connection.name,
      purpose: connection.reason,
      operations: operationsFor(type, actions),
      resources: resourcesFor(type, connection.name, actions),
    }];
  }));
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
  }
  const allow = explicitToolAllowlist(proposal);
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
    connections: requiredConnections.length > 0
      ? portableConnections(requiredConnections, bindings)
      : undefined,
    max_turns: 20,
    enabled: false,
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
