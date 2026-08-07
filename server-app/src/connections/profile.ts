import { z } from 'zod';

function isProtectedEnvironmentVariable(name: string): boolean {
  return name.startsWith('AGENT_SERVER_')
    || name === 'ANTHROPIC_API_KEY'
    || name === 'OPENAI_API_KEY';
}

const EnvironmentVariableSchema = z.string()
  .regex(/^[A-Z][A-Z0-9_]*$/)
  .refine((name) => !isProtectedEnvironmentVariable(name), 'This environment variable is reserved');
const AdapterIdentifierSchema = z.string().regex(/^[a-z][a-z0-9._-]*$/).max(120);
const ServiceTypeSchema = z.string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
const RuntimeNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/).max(120);
const RuntimeServerNameSchema = z.string().trim().min(1).max(160);
const SENSITIVE_NAME_PATTERN = /(?:api[-_]?key|token|auth(?:orization)?|password|secret|credential)/i;

function argumentContainsCredential(value: string): boolean {
  if (value.includes('${') || /\bbearer\s+/i.test(value)) return true;
  const assignmentName = /^--?([^=:\s]+)[=:]/.exec(value)?.[1];
  if (assignmentName && SENSITIVE_NAME_PATTERN.test(assignmentName)) return true;
  try {
    const url = new URL(value);
    if (url.username || url.password) return true;
    return [...url.searchParams.keys()].some((name) => SENSITIVE_NAME_PATTERN.test(name));
  } catch {
    return false;
  }
}

const SafeTransportArgumentSchema = z.string().max(2_000).refine(
  (value) => !argumentContainsCredential(value),
  'Stdio arguments must use declared credential references instead of credential values',
);
const RemoteMcpUrlSchema = z.url().max(2_048).refine((value) => {
  const url = new URL(value);
  const isLoopback = url.hostname === 'localhost'
    || url.hostname === '127.0.0.1'
    || url.hostname === '[::1]';
  return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback);
}, 'Remote MCP endpoints must use HTTPS or loopback HTTP').refine((value) => {
  const url = new URL(value);
  return !url.username
    && !url.password
    && ![...url.searchParams.keys()].some((name) => SENSITIVE_NAME_PATTERN.test(name));
}, 'Remote MCP URLs cannot contain credentials');

export const CredentialReferenceSchema = z.object({
  id: z.uuid(),
  label: z.string().trim().min(1).max(120),
  environment_variable: EnvironmentVariableSchema,
  secret: z.boolean(),
}).strict();

const CredentialHeaderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  credential_id: z.uuid(),
  prefix: z.string().max(120).default(''),
}).strict();

const McpStdioTransportSchema = z.object({
  kind: z.literal('mcp_stdio'),
  command: z.string().trim().min(1).max(1_024),
  args: z.array(SafeTransportArgumentSchema).max(64).default([]),
  environment: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.uuid()).default({}),
}).strict();

const McpRemoteTransportSchema = z.object({
  kind: z.enum(['mcp_http', 'mcp_sse']),
  url: RemoteMcpUrlSchema,
  headers: z.array(CredentialHeaderSchema).max(64).default([]),
}).strict();

const RuntimeAccountTransportSchema = z.object({
  kind: z.literal('runtime_account'),
  executor: z.enum(['claude-code', 'codex', 'kimi-code']),
  server_name: RuntimeServerNameSchema,
}).strict();

export const ConnectionTransportSchema = z.discriminatedUnion('kind', [
  McpStdioTransportSchema,
  McpRemoteTransportSchema,
  RuntimeAccountTransportSchema,
]);

const CredentialDraftSchema = CredentialReferenceSchema.omit({ id: true });
const StdioTransportDraftSchema = McpStdioTransportSchema.omit({ environment: true }).extend({
  environment: z.record(
    z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    z.number().int().nonnegative(),
  ).default({}),
}).strict();
const RemoteTransportDraftSchema = McpRemoteTransportSchema.omit({ headers: true }).extend({
  headers: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    credential_index: z.number().int().nonnegative(),
    prefix: z.string().max(120).default(''),
  }).strict()).max(64).default([]),
}).strict();
const RuntimeAccountTransportDraftSchema = RuntimeAccountTransportSchema;

export const ConnectionProfileDraftSchema = z.object({
  label: z.string().trim().min(1).max(120),
  service_type: ServiceTypeSchema.optional(),
  adapter: z.object({
    id: AdapterIdentifierSchema,
    version: z.number().int().positive(),
  }).strict(),
  runtime_name: RuntimeNameSchema.optional(),
  credentials: z.array(CredentialDraftSchema).max(64),
  transport: z.discriminatedUnion('kind', [
    StdioTransportDraftSchema,
    RemoteTransportDraftSchema,
    RuntimeAccountTransportDraftSchema,
  ]),
}).strict().superRefine((draft, context) => {
  const indexes = draft.transport.kind === 'mcp_stdio'
    ? Object.values(draft.transport.environment)
    : draft.transport.kind === 'runtime_account'
      ? []
      : draft.transport.headers.map(({ credential_index }) => credential_index);
  for (const index of indexes) {
    if (!draft.credentials[index]) {
      context.addIssue({
        code: 'custom',
        path: ['transport'],
        message: `Transport references unavailable credential index ${index}`,
      });
    }
  }
});

export const ConnectionProfileSchema = z.object({
  schema_version: z.literal(1),
  id: z.uuid(),
  label: z.string().trim().min(1).max(120),
  service_type: ServiceTypeSchema.optional(),
  adapter: z.object({
    id: AdapterIdentifierSchema,
    version: z.number().int().positive(),
  }).strict(),
  runtime_name: RuntimeNameSchema,
  credentials: z.array(CredentialReferenceSchema).max(64),
  transport: ConnectionTransportSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).strict().superRefine((profile, context) => {
  const credentialIds = new Set(profile.credentials.map(({ id }) => id));
  const referencedIds = profile.transport.kind === 'mcp_stdio'
    ? Object.values(profile.transport.environment)
    : profile.transport.kind === 'runtime_account'
      ? []
      : profile.transport.headers.map(({ credential_id }) => credential_id);
  for (const id of referencedIds) {
    if (!credentialIds.has(id)) {
      context.addIssue({
        code: 'custom',
        path: ['transport'],
        message: `Transport references credential ${id} outside this connection`,
      });
    }
  }
});

export const ConnectionProfileRegistrySchema = z.object({
  schema_version: z.literal(1),
  connections: z.array(ConnectionProfileSchema),
}).strict().superRefine((registry, context) => {
  const ids = registry.connections.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', path: ['connections'], message: 'Connection IDs must be unique' });
  }
  const runtimeNames = registry.connections.map(({ runtime_name: runtimeName }) => runtimeName);
  if (new Set(runtimeNames).size !== runtimeNames.length) {
    context.addIssue({
      code: 'custom', path: ['connections'], message: 'Connection runtime names must be unique',
    });
  }
});

export type ConnectionProfile = z.infer<typeof ConnectionProfileSchema>;
export type ConnectionProfileDraft = z.infer<typeof ConnectionProfileDraftSchema>;
export type CredentialReference = z.infer<typeof CredentialReferenceSchema>;
export type ConnectionTransport = z.infer<typeof ConnectionTransportSchema>;

/** Portable service identity, with an adapter-prefix fallback for older profiles. */
export function connectionServiceType(profile: ConnectionProfile): string {
  return profile.service_type ?? profile.adapter.id.split('.')[0] ?? profile.adapter.id;
}
