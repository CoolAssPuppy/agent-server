import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  RuntimeAssignmentAgentIdSchema,
  RuntimeAssignmentInputSchema,
  RuntimeAssignmentRegistrySchema,
  RuntimeAssignmentSchema,
  type RuntimeAssignment,
  type RuntimeAssignmentRegistry,
} from './runtime-assignment.js';

const EMPTY_REGISTRY: RuntimeAssignmentRegistry = {
  schema_version: 1,
  assignments: {},
};

type RuntimeAssignmentStoreOptions = Readonly<{
  now?: () => string;
}>;

type RevisionOptions = Readonly<{
  expectedRevision?: number;
}>;

export class RuntimeAssignmentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeAssignmentConflictError';
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function immutableAssignment(assignment: RuntimeAssignment): RuntimeAssignment {
  const provider = assignment.provider
    ? Object.freeze({ ...assignment.provider })
    : undefined;
  return Object.freeze({
    ...assignment,
    ...(provider ? { provider } : {}),
  });
}

/** Stores the selected coding runtime separately from an agent definition. */
export class RuntimeAssignmentStore {
  private pendingMutation: Promise<unknown> = Promise.resolve();
  private readonly now: () => string;

  constructor(
    private readonly path: string,
    options: RuntimeAssignmentStoreOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async get(agentId: string): Promise<RuntimeAssignment | undefined> {
    const parsedAgentId = RuntimeAssignmentAgentIdSchema.parse(agentId);
    const assignment = (await this.readRegistry()).assignments[parsedAgentId];
    return assignment ? immutableAssignment(assignment) : undefined;
  }

  async list(): Promise<readonly RuntimeAssignment[]> {
    const assignments = Object.values((await this.readRegistry()).assignments)
      .sort((left, right) => left.agent_id.localeCompare(right.agent_id))
      .map(immutableAssignment);
    return Object.freeze(assignments);
  }

  async set(
    agentId: string,
    input: unknown,
    options: RevisionOptions = {},
  ): Promise<RuntimeAssignment> {
    const parsedAgentId = RuntimeAssignmentAgentIdSchema.parse(agentId);
    const parsedInput = RuntimeAssignmentInputSchema.parse(input);
    return this.mutate(async (registry) => {
      const current = registry.assignments[parsedAgentId];
      this.assertSetRevision(parsedAgentId, current, options.expectedRevision);
      const assignment = RuntimeAssignmentSchema.parse({
        ...parsedInput,
        agent_id: parsedAgentId,
        revision: (current?.revision ?? 0) + 1,
        updated_at: this.now(),
      });
      registry.assignments[parsedAgentId] = assignment;
      return immutableAssignment(assignment);
    });
  }

  async remove(agentId: string, options: RevisionOptions = {}): Promise<boolean> {
    const parsedAgentId = RuntimeAssignmentAgentIdSchema.parse(agentId);
    return this.mutate(async (registry) => {
      const current = registry.assignments[parsedAgentId];
      if (!current) {
        if (options.expectedRevision !== undefined) {
          throw new RuntimeAssignmentConflictError(
            `Runtime assignment for "${parsedAgentId}" has changed. Refresh and try again.`,
          );
        }
        return false;
      }
      if (options.expectedRevision !== current.revision) {
        throw new RuntimeAssignmentConflictError(
          `Runtime assignment for "${parsedAgentId}" has changed. Refresh and try again.`,
        );
      }
      delete registry.assignments[parsedAgentId];
      return true;
    });
  }

  private assertSetRevision(
    agentId: string,
    current: RuntimeAssignment | undefined,
    expectedRevision: number | undefined,
  ): void {
    const isNewWrite = current === undefined && (expectedRevision === undefined || expectedRevision === 0);
    const isCurrentWrite = current !== undefined && expectedRevision === current.revision;
    if (isNewWrite || isCurrentWrite) return;
    throw new RuntimeAssignmentConflictError(
      `Runtime assignment for "${agentId}" has changed. Refresh and try again.`,
    );
  }

  private async mutate<T>(change: (registry: RuntimeAssignmentRegistry) => Promise<T>): Promise<T> {
    const operation = this.pendingMutation.then(async () => {
      const registry = await this.readRegistry();
      const result = await change(registry);
      await this.writeRegistry(registry);
      return result;
    });
    this.pendingMutation = operation.catch(() => undefined);
    return operation;
  }

  private async readRegistry(): Promise<RuntimeAssignmentRegistry> {
    try {
      return RuntimeAssignmentRegistrySchema.parse(JSON.parse(await readFile(this.path, 'utf8')));
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return { ...EMPTY_REGISTRY, assignments: {} };
      throw error;
    }
  }

  private async writeRegistry(registry: RuntimeAssignmentRegistry): Promise<void> {
    const parsed = RuntimeAssignmentRegistrySchema.parse(registry);
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.path);
    await chmod(this.path, 0o600);
  }
}
