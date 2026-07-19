import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { InteractionConfigSchema, NotificationConfigSchema } from '../interaction/schema.js';
import { ConversationConfigSchema } from '../conversation/schema.js';
import { areApprovedMcpReferences, isApprovedProviderReference, mcpCredentialOwner } from './environment-policy.js';
import { NativeServicesSchema } from './native-services.js';
export { NativeServicesSchema } from './native-services.js';

const TriggerRefSchema = z.object({
  agent: z.string().min(1),
});

export type TriggerRef = z.infer<typeof TriggerRefSchema>;

const FileWatchSchema = z.object({
  path: z.string().min(1),
  glob: z.string().optional(),
});

export const CalendarAccessSchema = z.object({
  id: z.string().trim().min(1).max(512),
  name: z.string().trim().min(1).max(160),
  account: z.string().trim().min(1).max(160).optional(),
  access: z.enum(['read_only', 'read_write']),
});

export type FileWatch = z.infer<typeof FileWatchSchema>;

export const PermissionsSchema = z.object({
  allow: z.array(z.string().min(1)).default([]),
  deny: z.array(z.string().min(1)).default([]),
});

export type Permissions = z.infer<typeof PermissionsSchema>;

/**
 * Per-agent telemetry overrides. Any field set here wins over the equivalent
 * server config (env-var) value. Omitted fields fall through to the env-var
 * default, then to the hard-coded default in `TelemetryReporter`.
 */
export const AgentTelemetrySchema = z.object({
  progress_mode: z.enum(['live', 'batched']).optional(),
  progress_sample_ms: z.number().int().positive().optional(),
  progress_max_entries: z.number().int().positive().optional(),
  progress_include_metadata: z.boolean().optional(),
});

export type AgentTelemetry = z.infer<typeof AgentTelemetrySchema>;

const ENV_REFERENCE_PATTERN = /\$\{([A-Z][A-Z0-9_]*)}/g;
const EXACT_ENV_REFERENCE_PATTERN = /^\$\{([A-Z][A-Z0-9_]*)}$/;

function isProtectedAgentEnvName(name: string): boolean {
  return name.startsWith('AGENT_SERVER_')
    || name === 'ANTHROPIC_API_KEY'
    || name === 'OPENAI_API_KEY';
}

function validateAgentEnvReferences(value: string, ctx: z.RefinementCtx): void {
  for (const match of value.matchAll(ENV_REFERENCE_PATTERN)) {
    if (isProtectedAgentEnvName(match[1])) {
      ctx.addIssue({
        code: 'custom',
        message: `Environment variable ${match[1]} is not available to agents`,
      });
    }
  }
}

const AgentEnvValueSchema = z.string().superRefine(validateAgentEnvReferences);

const McpStdioServerSchema = z.object({
  type: z.literal('stdio').optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), AgentEnvValueSchema).optional(),
});

const McpSseServerSchema = z.object({
  type: z.literal('sse'),
  url: z.string().url(),
  headers: z.record(z.string(), AgentEnvValueSchema).optional(),
});

const McpHttpServerSchema = z.object({
  type: z.literal('http'),
  url: z.string().url(),
  headers: z.record(z.string(), AgentEnvValueSchema).optional(),
});

const McpServerConfigSchema = z.union([
  McpSseServerSchema,
  McpHttpServerSchema,
  McpStdioServerSchema,
]);

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

const ConnectionRuntimeNameSchema = z.string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
  .max(120);

export const ConnectionBindingsSchema = z.record(
  ConnectionRuntimeNameSchema,
  z.uuid(),
).refine((bindings) => Object.keys(bindings).length <= 64, 'At most 64 saved connections may be used');

export type ConnectionBindings = z.infer<typeof ConnectionBindingsSchema>;

export const FileAccessSchema = z.object({
  path: z.string().trim().min(1).max(1_024)
    .refine((value) => !value.includes('\0'), 'File path cannot contain a null byte')
    .refine((value) => value.startsWith('/') || value.startsWith('~/'), 'File path must be absolute'),
  kind: z.enum(['file', 'folder']),
  access: z.enum(['read_only', 'read_write']),
}).strict();

/** Resolve `${VAR}` references in a single string from `source` (undefined -> ''). */
export function resolveEnvString(
  value: string,
  source: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): string {
  return value.replace(ENV_REFERENCE_PATTERN, (_match, varName: string) => {
    if (isProtectedAgentEnvName(varName)) {
      throw new Error(`Environment variable ${varName} is not available to agents`);
    }
    return source[varName] ?? '';
  });
}

export function resolveEnvVars(
  env: Record<string, string>,
  source: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = resolveEnvString(value, source);
  }
  return resolved;
}

/**
 * A custom model provider for an agent — an OpenAI-compatible endpoint for the
 * Codex runtime (e.g. Moonshot / Kimi K2) or an Anthropic-compatible endpoint
 * for the Claude runtime. `base_url` is a literal URL; `api_key` holds a
 * `${VAR}` reference resolved from `.env` at run time, never a literal secret.
 */
const ProviderBaseUrlSchema = z.string().trim().url().max(1024).superRefine((value, ctx) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return;
  }
  const isLoopback = url.hostname === 'localhost'
    || url.hostname === '127.0.0.1'
    || url.hostname === '[::1]';
  if (url.username || url.password) {
    ctx.addIssue({ code: 'custom', message: 'Provider URLs cannot contain credentials' });
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Provider URLs must use HTTPS, except for local loopback endpoints',
    });
  }
});

const ProviderApiKeySchema = z.string().trim().max(512).superRefine((value, ctx) => {
  const match = EXACT_ENV_REFERENCE_PATTERN.exec(value);
  if (!match) {
    ctx.addIssue({ code: 'custom', message: 'Provider api_key must be one ${VAR} reference' });
    return;
  }
  if (isProtectedAgentEnvName(match[1])) {
    ctx.addIssue({
      code: 'custom',
      message: `Environment variable ${match[1]} is not available to agents`,
    });
  }
});

export const ProviderConfigSchema = z.object({
  base_url: ProviderBaseUrlSchema,
  api_key: ProviderApiKeySchema.optional(),
}).superRefine((provider, ctx) => {
  if (provider.api_key && !isApprovedProviderReference(provider)) {
    ctx.addIssue({ code: 'custom', path: ['api_key'], message: 'Provider credential is not approved for this endpoint' });
  }
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const AgentConfigSchema = z
  .object({
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    name: z.string().trim().min(1).max(120),
    description: z.string().max(500).optional(),
    schedule: z.string().trim().min(1).max(120).optional(),
    timezone: z.string().trim().max(120).optional(),
    prompt: z.string().trim().min(1).max(40_000),
    tools: z.array(z.string().trim().min(1).max(120)).max(128).default([]),
    disallowed_tools: z.array(z.string().trim().min(1).max(120)).max(128).default([]),
    max_turns: z.number().int().positive().default(20),
    timeout: z.string().trim().max(16).optional(),
    working_directory: z.string().max(1024).refine((v) => !v.includes('\0')).optional(),
    file_access: z.array(FileAccessSchema).max(32).optional(),
    permission_mode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk']).optional(),
    enabled: z.boolean().default(true),
    on_complete: z.array(TriggerRefSchema).optional(),
    on_failure: z.array(TriggerRefSchema).optional(),
    watch: z.array(FileWatchSchema).max(32).optional(),
    calendar_access: z.array(CalendarAccessSchema).max(128).optional(),
    native_services: NativeServicesSchema.optional(),
    executor: z.enum(['claude-code', 'codex']).optional(),
    model: z.string().trim().min(1).max(120).optional(),
    provider: ProviderConfigSchema.optional(),
    codex_sandbox: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
    permissions: PermissionsSchema.optional(),
    mcp_servers: z.record(z.string().min(1), McpServerConfigSchema).optional(),
    connection_bindings: ConnectionBindingsSchema.optional(),
    interaction: InteractionConfigSchema.optional(),
    notification: NotificationConfigSchema.optional(),
    conversation: ConversationConfigSchema.optional(),
    telemetry: AgentTelemetrySchema.optional(),
  })
  .passthrough()
  .superRefine((agent, ctx) => {
    if (agent.calendar_access && agent.native_services?.calendar) {
      ctx.addIssue({
        code: 'custom',
        path: ['native_services', 'calendar'],
        message: 'Use either legacy calendar access or native Calendar grants, not both',
      });
    }
    if ((agent.native_services || agent.calendar_access) && agent.mcp_servers?.eventkit) {
      ctx.addIssue({
        code: 'custom',
        path: ['mcp_servers', 'eventkit'],
        message: 'Native service grants require the verified bundled EventKit helper',
      });
    }
    for (const [serverName, server] of Object.entries(agent.mcp_servers ?? {})) {
      // A saved binding replaces this inline transport before execution. Its
      // reviewed profile owns the credential references, so the fixed catalog
      // allowlist does not apply to the inert, human-readable snapshot.
      if (agent.connection_bindings?.[serverName]) continue;
      const values = 'command' in server ? server.env : server.headers;
      const owner = mcpCredentialOwner(serverName, server);
      if (values && !areApprovedMcpReferences(owner, values)) {
        ctx.addIssue({
          code: 'custom',
          path: ['mcp_servers', serverName],
          message: 'Connection credential is not approved for this service',
        });
      }
    }
  });

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export function parseAgentYaml(yaml: string): AgentConfig {
  const raw = parseYaml(yaml);
  return AgentConfigSchema.parse(raw);
}

const FRONTMATTER_OPEN = /^---\r?\n/;
const FRONTMATTER_CLOSE = /\r?\n---\s*(?:\r?\n|$)/;

export function hasFrontmatter(content: string): boolean {
  return FRONTMATTER_OPEN.test(content);
}

export function splitFrontmatter(content: string): { yaml: string; body: string } {
  const afterOpener = content.slice(content.indexOf('\n') + 1);
  const closeMatch = FRONTMATTER_CLOSE.exec(afterOpener);
  if (!closeMatch) {
    throw new Error('Frontmatter opening delimiter has no closing ---');
  }
  const yaml = afterOpener.slice(0, closeMatch.index);
  const body = afterOpener.slice(closeMatch.index + closeMatch[0].length).trim();
  return { yaml, body };
}

export function parseAgentFile(content: string): AgentConfig {
  if (!hasFrontmatter(content)) {
    return parseAgentYaml(content);
  }

  const { yaml, body } = splitFrontmatter(content);
  const raw = parseYaml(yaml);

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Frontmatter must be a YAML mapping');
  }

  const config = body.length > 0
    ? { ...(raw as Record<string, unknown>), prompt: body }
    : raw;

  return AgentConfigSchema.parse(config);
}
