import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ConnectionProfile } from './profile.js';

const OperationNameSchema = z.string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);

export const ConnectionOperationEffectSchema = z.enum([
  'read',
  'create',
  'update',
  'delete',
  'send',
  'execute',
  'unknown',
]);

export const ConnectionCapabilityOperationSchema = z.object({
  id: z.string().min(1).max(160),
  runtime_name: OperationNameSchema,
  effects: z.array(ConnectionOperationEffectSchema).min(1).max(7).superRefine((effects, context) => {
    if (new Set(effects).size !== effects.length) {
      context.addIssue({ code: 'custom', message: 'Operation effects must be unique' });
    }
  }),
  classification: z.enum(['curated', 'unknown']),
}).strict();

export const ConnectionCapabilitySnapshotSchema = z.object({
  schema_version: z.literal(1),
  connection_id: z.uuid(),
  source: z.literal('stored_profile'),
  adapter: z.object({
    id: z.string().min(1).max(120),
    version: z.number().int().positive(),
  }).strict(),
  operations: z.array(ConnectionCapabilityOperationSchema).max(512),
  capability_version: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  classification_version: z.literal('stored-mcp-v1'),
  captured_at: z.string().datetime(),
}).strict().superRefine((snapshot, context) => {
  const ids = snapshot.operations.map(({ id }) => id);
  const runtimeNames = snapshot.operations.map(({ runtime_name: runtimeName }) => runtimeName);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', path: ['operations'], message: 'Operation IDs must be unique' });
  }
  if (new Set(runtimeNames).size !== runtimeNames.length) {
    context.addIssue({ code: 'custom', path: ['operations'], message: 'Runtime operation names must be unique' });
  }
});

export type ConnectionOperationEffect = z.infer<typeof ConnectionOperationEffectSchema>;
export type ConnectionCapabilityOperation = z.infer<typeof ConnectionCapabilityOperationSchema>;
export type ConnectionCapabilitySnapshot = z.infer<typeof ConnectionCapabilitySnapshotSchema>;

const NOTION_REST_TOOL_EFFECTS: Readonly<Record<
  string,
  Exclude<ConnectionOperationEffect, 'unknown'>
>> = {
  'API-create-a-comment': 'create',
  'API-create-a-data-source': 'create',
  'API-delete-a-block': 'delete',
  'API-get-block-children': 'read',
  'API-get-self': 'read',
  'API-get-user': 'read',
  'API-get-users': 'read',
  'API-list-data-source-templates': 'read',
  'API-move-page': 'update',
  'API-patch-block-children': 'update',
  'API-patch-page': 'update',
  'API-post-page': 'create',
  'API-post-search': 'read',
  'API-query-data-source': 'read',
  'API-retrieve-a-block': 'read',
  'API-retrieve-a-comment': 'read',
  'API-retrieve-a-data-source': 'read',
  'API-retrieve-a-database': 'read',
  'API-retrieve-a-page': 'read',
  'API-retrieve-a-page-property': 'read',
  'API-retrieve-page-markdown': 'read',
  'API-update-a-block': 'update',
  'API-update-a-data-source': 'update',
  'API-update-page-markdown': 'update',
};

export type StoredMcpCapabilityOptions = {
  capturedAt: string;
  operationNames?: readonly string[];
};

function isCurrentNotionRestProfile(profile: ConnectionProfile): boolean {
  return profile.transport.kind === 'mcp_stdio'
    && profile.transport.command === 'npx'
    && profile.transport.args.length === 2
    && profile.transport.args[0] === '-y'
    && profile.transport.args[1] === '@notionhq/notion-mcp-server';
}

function operation(
  runtimeName: string,
  effect: ConnectionOperationEffect,
  classification: ConnectionCapabilityOperation['classification'],
): ConnectionCapabilityOperation {
  return ConnectionCapabilityOperationSchema.parse({
    id: `mcp:${runtimeName}`,
    runtime_name: runtimeName,
    effects: [effect],
    classification,
  });
}

function normalizedOperationNames(operationNames: readonly string[]): string[] {
  return [...new Set(operationNames.map((name) => OperationNameSchema.parse(name)))].sort();
}

function notionRestOperations(operationNames?: readonly string[]): ConnectionCapabilityOperation[] {
  const names = normalizedOperationNames(operationNames ?? Object.keys(NOTION_REST_TOOL_EFFECTS));
  return names.map((runtimeName) => {
    const effect = NOTION_REST_TOOL_EFFECTS[runtimeName];
    return effect
      ? operation(runtimeName, effect, 'curated')
      : operation(runtimeName, 'unknown', 'unknown');
  });
}

function unknownOperations(operationNames: readonly string[]): ConnectionCapabilityOperation[] {
  return normalizedOperationNames(operationNames)
    .map((runtimeName) => operation(runtimeName, 'unknown', 'unknown'));
}

function capabilityVersion(
  adapter: ConnectionProfile['adapter'],
  operations: readonly ConnectionCapabilityOperation[],
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({
      adapter,
      classification_version: 'stored-mcp-v1',
      operations,
    }))
    .digest('hex');
  return `sha256:${digest}`;
}

/**
 * Builds a deterministic capability snapshot for a stored MCP connection.
 * Curated behavior comes from exact adapter or transport identity. User labels
 * never participate. Operations without a trusted profile stay unknown.
 */
export function classifyStoredMcpCapabilities(
  profile: ConnectionProfile,
  options: StoredMcpCapabilityOptions,
): ConnectionCapabilitySnapshot {
  const operations = isCurrentNotionRestProfile(profile)
    ? notionRestOperations(options.operationNames)
    : unknownOperations(options.operationNames ?? []);

  return ConnectionCapabilitySnapshotSchema.parse({
    schema_version: 1,
    connection_id: profile.id,
    source: 'stored_profile',
    adapter: profile.adapter,
    operations,
    capability_version: capabilityVersion(profile.adapter, operations),
    classification_version: 'stored-mcp-v1',
    captured_at: options.capturedAt,
  });
}
