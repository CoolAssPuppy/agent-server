import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { ConnectionCapabilitySnapshot } from './capability-snapshot.js';

const SemanticOperationSchema = z.string()
  .min(3)
  .max(160)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/);
const RuntimeOperationSchema = z.string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const ResourceTypeSchema = z.string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
const CapabilityVersionSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const ConnectionOperationBindingInputSchema = z.object({
  runtime_name: RuntimeOperationSchema,
  effect: z.enum(['read', 'write']),
  target: z.object({
    argument: RuntimeOperationSchema,
    resource_type: ResourceTypeSchema,
  }).strict().optional(),
}).strict();

export const ConnectionOperationBindingsInputSchema = z.record(
  SemanticOperationSchema,
  ConnectionOperationBindingInputSchema,
).superRefine((operations, context) => {
  if (Object.keys(operations).length > 512) {
    context.addIssue({ code: 'custom', message: 'At most 512 operation mappings may be saved' });
  }
  const runtimeNames = Object.values(operations).map(({ runtime_name: runtimeName }) => runtimeName);
  if (new Set(runtimeNames).size !== runtimeNames.length) {
    context.addIssue({ code: 'custom', message: 'Concrete tools may only be mapped once' });
  }
});

export const ConnectionOperationBindingSchema = ConnectionOperationBindingInputSchema.extend({
  effect: z.enum(['read', 'write']),
}).strict();

const StoredConnectionOperationBindingsSchema = z.object({
  revision: z.number().int().positive(),
  capability_version: CapabilityVersionSchema,
  updated_at: z.string().datetime(),
  operations: z.record(SemanticOperationSchema, ConnectionOperationBindingSchema),
}).strict();

const RegistrySchema = z.object({
  schema_version: z.literal(1),
  connections: z.record(z.uuid(), StoredConnectionOperationBindingsSchema),
}).strict();

export type ConnectionOperationBinding = z.infer<typeof ConnectionOperationBindingSchema>;
export type ConnectionOperationBindingInput = z.infer<typeof ConnectionOperationBindingInputSchema>;
export type ConnectionOperationBindings = z.infer<typeof StoredConnectionOperationBindingsSchema>;
export type EmptyConnectionOperationBindings = { revision: 0; operations: Record<string, never> };

const EMPTY_BINDINGS: EmptyConnectionOperationBindings = { revision: 0, operations: {} };

export class ConnectionOperationBindingConflictError extends Error {
  constructor() {
    super('Connection operations changed before this update was saved.');
    this.name = 'ConnectionOperationBindingConflictError';
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function reviewedEffect(
  operation: ConnectionCapabilitySnapshot['operations'][number],
  requested: ConnectionOperationBindingInput['effect'],
): ConnectionOperationBinding['effect'] {
  if (operation.classification !== 'curated') return requested;
  const derived = operation.effects.length > 0
    && operation.effects.every((effect) => effect === 'read')
    ? 'read'
    : 'write';
  if (requested !== derived) {
    throw new Error(`Tool "${operation.runtime_name}" has trusted ${derived} behavior.`);
  }
  return derived;
}

/** Stores reviewed local mappings from portable operations to checked MCP tools. */
export class ConnectionOperationBindingStore {
  private pendingMutation: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async get(
    connectionId: string,
  ): Promise<ConnectionOperationBindings | EmptyConnectionOperationBindings> {
    const bindings = (await this.readRegistry()).connections[connectionId];
    return bindings ? StoredConnectionOperationBindingsSchema.parse(bindings) : EMPTY_BINDINGS;
  }

  async replace(
    connectionId: string,
    snapshot: ConnectionCapabilitySnapshot,
    operations: Record<string, ConnectionOperationBindingInput>,
    options: { expectedRevision: number; expectedCapabilityVersion: string },
  ): Promise<ConnectionOperationBindings> {
    const parsedOperations = ConnectionOperationBindingsInputSchema.parse(operations);
    const operation = this.pendingMutation.then(async () => {
      const registry = await this.readRegistry();
      const current = registry.connections[connectionId];
      if ((current?.revision ?? 0) !== options.expectedRevision
        || snapshot.connection_id !== connectionId
        || snapshot.capability_version !== options.expectedCapabilityVersion) {
        throw new ConnectionOperationBindingConflictError();
      }
      const inventory = new Map(snapshot.operations.map((entry) => [entry.runtime_name, entry]));
      const reviewed = Object.fromEntries(Object.entries(parsedOperations).map(([semantic, input]) => {
        const available = inventory.get(input.runtime_name);
        if (!available) {
          throw new Error(`Tool "${input.runtime_name}" is not in the checked tool inventory.`);
        }
        if (input.target && !available.input_fields?.includes(input.target.argument)) {
          throw new Error(
            `Tool "${input.runtime_name}" does not declare argument "${input.target.argument}".`,
          );
        }
        return [semantic, ConnectionOperationBindingSchema.parse({
          ...input,
          effect: reviewedEffect(available, input.effect),
        })];
      }));
      const next = StoredConnectionOperationBindingsSchema.parse({
        revision: (current?.revision ?? 0) + 1,
        capability_version: snapshot.capability_version,
        updated_at: this.now(),
        operations: reviewed,
      });
      registry.connections[connectionId] = next;
      await this.writeRegistry(registry);
      return next;
    });
    this.pendingMutation = operation.catch(() => undefined);
    return operation;
  }

  async remove(connectionId: string): Promise<void> {
    const operation = this.pendingMutation.then(async () => {
      const registry = await this.readRegistry();
      delete registry.connections[connectionId];
      await this.writeRegistry(registry);
    });
    this.pendingMutation = operation.catch(() => undefined);
    await operation;
  }

  private async readRegistry(): Promise<z.infer<typeof RegistrySchema>> {
    try {
      return RegistrySchema.parse(JSON.parse(await readFile(this.path, 'utf8')));
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return { schema_version: 1, connections: {} };
      throw error;
    }
  }

  private async writeRegistry(registry: z.infer<typeof RegistrySchema>): Promise<void> {
    const parsed = RegistrySchema.parse(registry);
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.path);
    await chmod(this.path, 0o600);
  }
}
