import { z } from 'zod';

const EnvironmentVariableSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
const AdapterIdentifierSchema = z.string().regex(/^[a-z][a-z0-9._-]*$/).max(120);

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
  args: z.array(z.string().max(2_000)).max(64).default([]),
  environment: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.uuid()).default({}),
}).strict();

const McpRemoteTransportSchema = z.object({
  kind: z.enum(['mcp_http', 'mcp_sse']),
  url: z.url().max(2_048),
  headers: z.array(CredentialHeaderSchema).max(64).default([]),
}).strict();

export const ConnectionTransportSchema = z.discriminatedUnion('kind', [
  McpStdioTransportSchema,
  McpRemoteTransportSchema,
]);

export const ConnectionProfileSchema = z.object({
  schema_version: z.literal(1),
  id: z.uuid(),
  label: z.string().trim().min(1).max(120),
  adapter: z.object({
    id: AdapterIdentifierSchema,
    version: z.number().int().positive(),
  }).strict(),
  credentials: z.array(CredentialReferenceSchema).max(64),
  transport: ConnectionTransportSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).strict().superRefine((profile, context) => {
  const credentialIds = new Set(profile.credentials.map(({ id }) => id));
  const referencedIds = profile.transport.kind === 'mcp_stdio'
    ? Object.values(profile.transport.environment)
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
});

export type ConnectionProfile = z.infer<typeof ConnectionProfileSchema>;
export type CredentialReference = z.infer<typeof CredentialReferenceSchema>;
export type ConnectionTransport = z.infer<typeof ConnectionTransportSchema>;
