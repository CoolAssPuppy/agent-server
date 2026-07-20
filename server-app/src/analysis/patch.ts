import { randomUUID } from 'crypto';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod';
import {
  AgentTelemetrySchema,
  CalendarAccessSchema,
  ConnectionBindingsSchema,
  FileAccessSchema,
  NativeServicesSchema,
  parseAgentFile,
} from '../agents/config.js';
import { renderLosslessAgentPatch } from '../agents/lossless-yaml-editor.js';
import { ConversationConfigSchema } from '../conversation/schema.js';
import { NETWORK_TOOLS } from '../execution/permission-policy.js';
import { computeAgentContentHash } from './security-rules.js';
import { EXECUTOR_NAMES } from '../agents/executor.js';

const ContentHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const OptionalText = z.string().trim().min(1).max(1_024).nullable().optional();
const ToolListSchema = z.array(z.string().trim().min(1).max(120)).max(128);
const TriggerListSchema = z.array(z.object({ agent: z.string().trim().min(1).max(64) }).strict()).max(64);

export const ConfigurationChangesSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  prompt: z.string().trim().min(1).max(40_000).optional(),
  schedule: z.string().trim().min(1).max(120).nullable().optional(),
  timezone: z.string().trim().min(1).max(120).nullable().optional(),
  enabled: z.boolean().optional(),
  max_turns: z.number().int().positive().optional(),
  timeout: z.string().trim().min(1).max(16).nullable().optional(),
  working_directory: OptionalText,
  file_access: z.array(FileAccessSchema).max(32).nullable().optional(),
  calendar_access: z.array(CalendarAccessSchema).max(128).nullable().optional(),
  native_services: NativeServicesSchema.nullable().optional(),
  tools: ToolListSchema.optional(),
  disallowed_tools: ToolListSchema.optional(),
  permissions: z.object({ allow: ToolListSchema, deny: ToolListSchema }).strict().nullable().optional(),
  mcp_servers: z.record(z.string().trim().min(1).max(160), z.unknown()).nullable().optional(),
  connection_bindings: ConnectionBindingsSchema.nullable().optional(),
  model: z.string().trim().min(1).max(120).nullable().optional(),
  executor: z.enum(EXECUTOR_NAMES).nullable().optional(),
  provider: z.object({
    base_url: z.string().trim().url().max(1_024),
    api_key: z.string().trim().max(512).optional(),
  }).strict().nullable().optional(),
  codex_sandbox: z.enum(['read-only', 'workspace-write', 'danger-full-access']).nullable().optional(),
  permission_mode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk']).nullable().optional(),
  notification: z.record(z.string(), z.unknown()).nullable().optional(),
  interaction: z.record(z.string(), z.unknown()).nullable().optional(),
  conversation: ConversationConfigSchema.nullable().optional(),
  telemetry: AgentTelemetrySchema.nullable().optional(),
  watch: z.array(z.object({
    path: z.string().trim().min(1).max(1_024),
    glob: z.string().trim().min(1).max(500).optional(),
  }).strict()).max(32).nullable().optional(),
  on_complete: TriggerListSchema.nullable().optional(),
  on_failure: TriggerListSchema.nullable().optional(),
  network_access: z.boolean().optional(),
}).strict().refine((changes) => Object.keys(changes).length > 0, 'At least one change is required');

export type ConfigurationChanges = z.infer<typeof ConfigurationChangesSchema>;

export const ConfigurationPatchSchema = z.object({
  schema_version: z.literal(1),
  agent_id: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  expected_content_hash: ContentHashSchema,
  source: z.enum(['creation', 'debugger', 'security_analyzer', 'user']),
  reason: z.string().trim().min(1).max(1_000),
  changes: ConfigurationChangesSchema,
  confirmation: z.object({
    approved: z.literal(true),
    preview_content_hash: ContentHashSchema,
  }).strict().optional(),
}).strict();

export type ConfigurationPatch = z.infer<typeof ConfigurationPatchSchema>;

export type PatchPreview = {
  patch: ConfigurationPatch;
  original_content_hash: string;
  result_content_hash: string;
  result_content: string;
  changes: Array<{ field: string; summary: string }>;
  risk: 'low' | 'high';
  risk_reasons: string[];
  requires_confirmation: boolean;
  can_apply: boolean;
};

export type PatchApplyResult = PatchPreview & { rollback_token: string };

export interface AgentContentRepository {
  read(agentId: string): Promise<string>;
  replaceIfHashMatches(agentId: string, expectedHash: string, content: string): Promise<void>;
}

export class PatchConflictError extends Error {}
export class PatchPolicyError extends Error {}

type RollbackRecord = { agentId: string; previous: string; currentHash: string };

const FIELD_SUMMARIES: Record<string, string> = {
  name: 'Change the agent name', description: 'Change the description', prompt: 'Update the agent instructions',
  schedule: 'Change when the agent runs', timezone: 'Change the schedule time zone', enabled: 'Change whether the agent is enabled',
  working_directory: 'Change the working folder', tools: 'Change allowed actions', disallowed_tools: 'Change blocked actions',
  permissions: 'Change detailed action permissions', mcp_servers: 'Change connected apps and services',
  connection_bindings: 'Use saved connections', model: 'Change the model',
  executor: 'Change the local runtime', provider: 'Change the model service', codex_sandbox: 'Change file access limits',
  permission_mode: 'Change approval behavior', notification: 'Change notifications', interaction: 'Change reply handling',
  watch: 'Change watched folders', on_complete: 'Change follow-up agents', on_failure: 'Change failure handling',
  max_turns: 'Change the run step limit', timeout: 'Change the run time limit',
  conversation: 'Change conversation memory', telemetry: 'Change progress reporting',
  file_access: 'Change file or folder access', calendar_access: 'Change Calendar access',
  native_services: 'Change access to Mac apps',
  network_access: 'Change internet access',
};

const COMMAND_PATTERN = /^(?:Bash|bash|shell|terminal|command)(?:$|[_:*])/i;
const WRITE_PATTERN = /^(?:Write|Edit|MultiEdit|NotebookEdit)(?:$|[_:*])/i;
const DESTRUCTIVE_INSTRUCTION_PATTERN = /\b(?:delete|erase|destroy|remove)\b.{0,80}\b(?:all|every)\b.{0,40}\b(?:files?|folders?|records?|emails?)\b/i;
const LITERAL_CREDENTIAL_PATTERN = /\b(?:sk-(?:ant|live|test)?[-_a-z0-9]{12,}|xox[baprs]-[a-z0-9-]{12,})\b|\bBearer\s+(?!\$\{)[a-z0-9._~+/=-]{12,}|\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*(?!\$\{)\S{12,}/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalPath(path: string): string {
  const normalized = resolve(path);
  try {
    return realpathSync(normalized);
  } catch {
    // A new path cannot be resolved yet. The normalized absolute path is still checked.
    return normalized;
  }
}

export function isUnsafeAutomatedFilePath(path: string, homeDirectory = homedir()): boolean {
  const expanded = path === '~'
    ? homeDirectory
    : path.startsWith('~/') ? resolve(homeDirectory, path.slice(2)) : path;
  const canonical = canonicalPath(expanded);
  const canonicalHome = canonicalPath(homeDirectory);
  return canonical === '/' || canonical === '/Users'
    || canonical === canonicalHome
    || /^\/Users\/[^/]+\/?$/.test(canonical);
}

function classifyPatchRisk(
  changes: ConfigurationChanges,
  currentContent: string,
): { risk: 'low' | 'high'; reasons: string[]; canApply: boolean } {
  const current = parseAgentFile(currentContent);
  const reasons: string[] = [];
  if (changes.permission_mode === 'bypassPermissions') {
    throw new PatchPolicyError('Automated patches cannot bypass approval checks');
  }
  if (changes.permission_mode === 'acceptEdits' || changes.permission_mode === 'dontAsk') {
    reasons.push('Changes approval behavior');
  }
  if (changes.codex_sandbox === 'danger-full-access') {
    throw new PatchPolicyError('Automated patches cannot grant unrestricted file access');
  }
  if (changes.codex_sandbox === 'workspace-write' && current.codex_sandbox !== 'workspace-write') {
    reasons.push('Allows changes inside the working folder');
  }
  if (changes.working_directory && isUnsafeAutomatedFilePath(changes.working_directory)) {
    throw new PatchPolicyError('Automated patches cannot grant broad file access');
  }
  if (changes.file_access?.some((grant) => isUnsafeAutomatedFilePath(grant.path))) {
    throw new PatchPolicyError('Automated patches cannot grant broad file access');
  }
  if (changes.file_access !== undefined) reasons.push('Changes file or folder access');
  if (changes.calendar_access !== undefined) reasons.push('Changes Calendar access');
  if (changes.native_services !== undefined) {
    reasons.push(changes.native_services?.contacts
      ? 'Changes access to personal information'
      : 'Changes access to Mac apps');
  }
  if (changes.network_access === true) reasons.push('Enables internet access');
  if (changes.tools?.length === 0 || changes.tools?.includes('*')) {
    throw new PatchPolicyError('Automated patches cannot grant every available action');
  }
  const granted = [...(changes.tools ?? []), ...(changes.permissions?.allow ?? [])];
  if (granted.some((tool) => COMMAND_PATTERN.test(tool))) {
    throw new PatchPolicyError('Automated patches cannot grant arbitrary command execution');
  }
  if (granted.some((tool) => tool === '*' || /^mcp__\*$/.test(tool))) {
    throw new PatchPolicyError('Automated patches cannot grant every available action');
  }
  if (granted.some((tool) => WRITE_PATTERN.test(tool))) reasons.push('Allows file changes');
  if (granted.some((tool) => tool.startsWith('mcp__'))) reasons.push('Allows a connected app or service');
  if (changes.permissions === null && current.permissions) reasons.push('Removes an existing action allowlist');
  if (changes.disallowed_tools
    && current.disallowed_tools.some((tool) => !changes.disallowed_tools?.includes(tool))) {
    reasons.push('Removes one or more blocked actions');
  }
  if (changes.provider && changes.provider.base_url !== current.provider?.base_url) {
    reasons.push('Changes the model service');
  }
  const currentServers = current.mcp_servers ?? {};
  const proposedServers = changes.mcp_servers === undefined ? currentServers : changes.mcp_servers ?? {};
  const changedServices = Object.entries(proposedServers).filter(([name, server]) => {
    const previous = currentServers[name];
    return previous === undefined || JSON.stringify(previous) !== JSON.stringify(server);
  });
  const startsShell = changedServices.some(([, server]) => isRecord(server)
    && typeof server.command === 'string'
    && (COMMAND_PATTERN.test(server.command.split('/').at(-1) ?? '')
      || (Array.isArray(server.args) && server.args.includes('-c'))));
  if (startsShell) throw new PatchPolicyError('Automated patches cannot add a shell-based connected service');
  if (changedServices.length > 0) reasons.push('Adds or changes a connected service');
  if (changes.connection_bindings !== undefined) reasons.push('Changes saved connections');
  if (changes.notification) reasons.push('Changes external notifications');
  if (changes.schedule || (changes.watch && changes.watch.length > 0)) reasons.push('Changes automatic execution');
  if ((changes.on_complete?.length ?? 0) > 0 || (changes.on_failure?.length ?? 0) > 0) {
    reasons.push('Changes agent chaining');
  }
  if (changes.prompt && DESTRUCTIVE_INSTRUCTION_PATTERN.test(changes.prompt)) {
    throw new PatchPolicyError('Automated patches cannot add destructive instructions');
  }
  const containsCredential = LITERAL_CREDENTIAL_PATTERN.test(JSON.stringify(changes));
  if (containsCredential) reasons.push('Contains a literal credential');
  return {
    risk: reasons.length > 0 ? 'high' : 'low',
    reasons,
    canApply: !containsCredential,
  };
}

function assertSchedule(schedule: string | null | undefined): void {
  if (!schedule) return;
  try {
    CronExpressionParser.parse(schedule);
  } catch {
    throw new Error('Choose a valid schedule before applying this change');
  }
}

function networkWrites(changes: ConfigurationChanges, current: string[]): string[] | undefined {
  if (changes.network_access !== false) return undefined;
  return [...new Set([...current, ...NETWORK_TOOLS])];
}

function renderPatchedContent(content: string, changes: ConfigurationChanges): string {
  const agent = parseAgentFile(content);
  const writes: Record<string, unknown> = { ...changes };
  delete writes.network_access;
  const denied = networkWrites(changes, changes.disallowed_tools ?? agent.disallowed_tools);
  if (denied) writes.disallowed_tools = denied;
  if (changes.network_access === false && (changes.permissions ?? agent.permissions)) {
    const permissions = changes.permissions ?? agent.permissions;
    if (permissions) {
      writes.permissions = {
        allow: permissions.allow,
        deny: [...new Set([...permissions.deny, ...NETWORK_TOOLS])],
      };
    }
  }
  if (changes.network_access === true) {
    const networkTools: string[] = [...NETWORK_TOOLS];
    writes.disallowed_tools = (changes.disallowed_tools ?? agent.disallowed_tools)
      .filter((tool) => !networkTools.includes(tool));
    const permissions = changes.permissions ?? agent.permissions;
    if (permissions) {
      writes.permissions = {
        allow: [...new Set([...permissions.allow, ...networkTools])],
        deny: permissions.deny.filter((tool) => !networkTools.includes(tool)),
      };
    } else {
      writes.tools = [...new Set([...(changes.tools ?? agent.tools), ...networkTools])];
    }
  }

  const fieldWrites = new Map(
    Object.entries(writes).filter(([key]) => key !== 'prompt'),
  );
  return renderLosslessAgentPatch(content, fieldWrites, changes.prompt);
}

export class StructuredPatchService {
  private readonly rollbacks = new Map<string, RollbackRecord>();

  constructor(private readonly repository: AgentContentRepository) {}

  async preview(input: ConfigurationPatch): Promise<PatchPreview> {
    const patch = ConfigurationPatchSchema.parse(input);
    assertSchedule(patch.changes.schedule);
    const original = await this.repository.read(patch.agent_id);
    const classification = classifyPatchRisk(patch.changes, original);
    const originalHash = computeAgentContentHash(original);
    if (originalHash !== patch.expected_content_hash) throw new PatchConflictError('The agent changed. Review the fix again.');
    const result = renderPatchedContent(original, patch.changes);
    const parsed = parseAgentFile(result);
    if (parsed.id !== patch.agent_id) throw new Error('A patch cannot change the agent identity');
    return {
      patch,
      original_content_hash: originalHash,
      result_content_hash: computeAgentContentHash(result),
      result_content: result,
      changes: Object.keys(patch.changes).map((field) => ({ field, summary: FIELD_SUMMARIES[field] ?? `Change ${field}` })),
      risk: classification.risk,
      risk_reasons: classification.reasons,
      requires_confirmation: classification.risk === 'high',
      can_apply: classification.canApply,
    };
  }

  async apply(input: ConfigurationPatch): Promise<PatchApplyResult> {
    const preview = await this.preview(input);
    if (!preview.can_apply) {
      throw new PatchPolicyError('Literal credentials must be moved to secure connection settings');
    }
    if (preview.requires_confirmation
      && preview.patch.confirmation?.preview_content_hash !== preview.result_content_hash) {
      throw new PatchPolicyError('Review and confirm this high-risk change before applying it');
    }
    const original = await this.repository.read(preview.patch.agent_id);
    await this.repository.replaceIfHashMatches(
      preview.patch.agent_id,
      preview.original_content_hash,
      preview.result_content,
    );
    const rollbackToken = randomUUID();
    this.rollbacks.set(rollbackToken, {
      agentId: preview.patch.agent_id,
      previous: original,
      currentHash: preview.result_content_hash,
    });
    if (this.rollbacks.size > 50) {
      const oldest = this.rollbacks.keys().next().value;
      if (oldest) this.rollbacks.delete(oldest);
    }
    return { ...preview, rollback_token: rollbackToken };
  }

  async rollback(token: string): Promise<void> {
    const record = this.rollbacks.get(token);
    if (!record) throw new Error('Rollback token is not available');
    const current = await this.repository.read(record.agentId);
    if (computeAgentContentHash(current) !== record.currentHash) {
      throw new PatchConflictError('The agent changed after the fix and cannot be rolled back automatically');
    }
    await this.repository.replaceIfHashMatches(record.agentId, record.currentHash, record.previous);
    this.rollbacks.delete(token);
  }
}

export class InMemoryAgentContentRepository implements AgentContentRepository {
  private readonly contents: Map<string, string>;

  constructor(contents: Record<string, string>) {
    this.contents = new Map(Object.entries(contents));
  }

  async read(agentId: string): Promise<string> {
    const content = this.contents.get(agentId);
    if (content === undefined) throw new Error(`Agent not found: ${agentId}`);
    return content;
  }

  async writeAtomic(agentId: string, content: string): Promise<void> {
    if (!this.contents.has(agentId)) throw new Error(`Agent not found: ${agentId}`);
    this.contents.set(agentId, content);
  }

  async replaceIfHashMatches(agentId: string, expectedHash: string, content: string): Promise<void> {
    const current = await this.read(agentId);
    if (computeAgentContentHash(current) !== expectedHash) {
      throw new PatchConflictError('The agent changed. Review the fix again.');
    }
    await this.writeAtomic(agentId, content);
  }
}
