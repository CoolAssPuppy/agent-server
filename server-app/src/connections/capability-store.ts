import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import {
  ConnectionCapabilitySnapshotSchema,
  type ConnectionCapabilitySnapshot,
} from './capability-snapshot.js';

const CapabilityRegistrySchema = z.object({
  schema_version: z.literal(1),
  connections: z.record(z.uuid(), ConnectionCapabilitySnapshotSchema),
}).strict().superRefine((registry, context) => {
  for (const [connectionId, snapshot] of Object.entries(registry.connections)) {
    if (snapshot.connection_id !== connectionId) {
      context.addIssue({
        code: 'custom',
        path: ['connections', connectionId],
        message: 'Capability snapshot connection ID must match its registry key',
      });
    }
  }
});

type CapabilityRegistry = z.infer<typeof CapabilityRegistrySchema>;

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

/** Stores the last verified concrete tool inventory for each saved connection. */
export class ConnectionCapabilityStore {
  private pendingMutation: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {}

  async get(connectionId: string): Promise<ConnectionCapabilitySnapshot | undefined> {
    return (await this.readRegistry()).connections[connectionId];
  }

  async put(snapshot: ConnectionCapabilitySnapshot): Promise<void> {
    await this.mutate((registry) => {
      registry.connections[snapshot.connection_id] = ConnectionCapabilitySnapshotSchema.parse(snapshot);
    });
  }

  async remove(connectionId: string): Promise<void> {
    await this.mutate((registry) => {
      delete registry.connections[connectionId];
    });
  }

  private async mutate(change: (registry: CapabilityRegistry) => void): Promise<void> {
    const operation = this.pendingMutation.then(async () => {
      const registry = await this.readRegistry();
      change(registry);
      await this.writeRegistry(registry);
    });
    this.pendingMutation = operation.catch(() => undefined);
    await operation;
  }

  private async readRegistry(): Promise<CapabilityRegistry> {
    try {
      return CapabilityRegistrySchema.parse(JSON.parse(await readFile(this.path, 'utf8')));
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return { schema_version: 1, connections: {} };
      throw error;
    }
  }

  private async writeRegistry(registry: CapabilityRegistry): Promise<void> {
    const parsed = CapabilityRegistrySchema.parse(registry);
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.path);
    await chmod(this.path, 0o600);
  }
}
