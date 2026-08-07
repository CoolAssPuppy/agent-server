import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

const AgentIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const SlotKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const OperationIdSchema = z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/);

const ResourceBindingSchema = z.object({
  id: z.string().trim().min(1).max(2_048),
  operation_ids: z.record(
    OperationIdSchema,
    z.string().trim().min(1).max(2_048),
  ).optional(),
}).strict();

const SkillBindingSchema = z.object({
  path: z.string().trim().min(1).max(2_048).refine((value) => !value.includes('\0')),
}).strict();

export const AgentSkillBindingsInputSchema = z.record(SlotKeySchema, SkillBindingSchema);

export const AgentConnectionBindingSchema = z.object({
  connection_id: z.uuid(),
  resources: z.record(SlotKeySchema, ResourceBindingSchema).default({}),
}).strict();

export const AgentConnectionBindingsInputSchema = z.record(
  SlotKeySchema,
  AgentConnectionBindingSchema,
);

const AgentBindingSetSchema = z.object({
  revision: z.number().int().nonnegative(),
  connections: AgentConnectionBindingsInputSchema,
  skills: AgentSkillBindingsInputSchema.optional(),
}).strict();

const AgentBindingRegistrySchema = z.object({
  schema_version: z.literal(1),
  agents: z.record(AgentIdSchema, AgentBindingSetSchema),
}).strict();

export type AgentConnectionBinding = z.infer<typeof AgentConnectionBindingSchema>;
export type AgentBindingSet = z.infer<typeof AgentBindingSetSchema>;

const EMPTY_BINDINGS: AgentBindingSet = { revision: 0, connections: {}, skills: {} };

export class AgentBindingConflictError extends Error {
  constructor() {
    super('Agent connection bindings changed before this update was saved.');
    this.name = 'AgentBindingConflictError';
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

/** Stores machine-local connection and resource choices for shareable agents. */
export class AgentBindingStore {
  private pendingMutation: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {}

  async get(agentId: string): Promise<AgentBindingSet> {
    AgentIdSchema.parse(agentId);
    const binding = (await this.readRegistry()).agents[agentId] ?? EMPTY_BINDINGS;
    return AgentBindingSetSchema.parse(binding);
  }

  async replace(
    agentId: string,
    connections: Record<string, AgentConnectionBinding>,
    expectedRevision: number,
    skills?: AgentBindingSet['skills'],
  ): Promise<AgentBindingSet> {
    AgentIdSchema.parse(agentId);
    const parsedConnections = AgentConnectionBindingsInputSchema.parse(connections);
    const operation = this.pendingMutation.then(async () => {
      const registry = await this.readRegistry();
      const current = registry.agents[agentId] ?? EMPTY_BINDINGS;
      if (current.revision !== expectedRevision) throw new AgentBindingConflictError();
      const selectedSkills = skills ?? current.skills;
      const next = AgentBindingSetSchema.parse({
        revision: current.revision + 1,
        connections: parsedConnections,
        ...(selectedSkills && Object.keys(selectedSkills).length > 0
          ? { skills: selectedSkills }
          : {}),
      });
      registry.agents[agentId] = next;
      await this.writeRegistry(registry);
      return AgentBindingSetSchema.parse(next);
    });
    this.pendingMutation = operation.catch(() => undefined);
    return operation;
  }

  async remove(agentId: string, expectedRevision: number): Promise<boolean> {
    AgentIdSchema.parse(agentId);
    const operation = this.pendingMutation.then(async () => {
      const registry = await this.readRegistry();
      const current = registry.agents[agentId];
      if (!current) {
        if (expectedRevision !== 0) throw new AgentBindingConflictError();
        return false;
      }
      if (current.revision !== expectedRevision) throw new AgentBindingConflictError();
      delete registry.agents[agentId];
      await this.writeRegistry(registry);
      return true;
    });
    this.pendingMutation = operation.catch(() => undefined);
    return operation;
  }

  private async readRegistry(): Promise<z.infer<typeof AgentBindingRegistrySchema>> {
    try {
      return AgentBindingRegistrySchema.parse(JSON.parse(await readFile(this.path, 'utf8')));
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return { schema_version: 1, agents: {} };
      throw error;
    }
  }

  private async writeRegistry(registry: z.infer<typeof AgentBindingRegistrySchema>): Promise<void> {
    const parsed = AgentBindingRegistrySchema.parse(registry);
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.path);
    await chmod(this.path, 0o600);
  }
}
