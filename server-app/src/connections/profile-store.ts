import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  ConnectionProfileRegistrySchema,
  ConnectionProfileDraftSchema,
  ConnectionProfileSchema,
  type ConnectionProfile,
  type ConnectionProfileDraft,
  type ConnectionTransport,
  type CredentialReference,
} from './profile.js';

export type { ConnectionProfileDraft } from './profile.js';

const EMPTY_REGISTRY: { schema_version: 1; connections: ConnectionProfile[] } = {
  schema_version: 1,
  connections: [],
};

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

export class ConnectionProfileStore {
  private pendingMutation: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {}

  async list(): Promise<ConnectionProfile[]> {
    return (await this.readRegistry()).connections;
  }

  async create(input: unknown): Promise<ConnectionProfile> {
    return this.mutate(async (connections) => {
      const draft = ConnectionProfileDraftSchema.parse(input);
      const credentials = draft.credentials.map((credential) => ({ ...credential, id: randomUUID() }));
      const now = new Date().toISOString();
      const id = randomUUID();
      const connection = ConnectionProfileSchema.parse({
        schema_version: 1,
        id,
        label: draft.label,
        adapter: draft.adapter,
        runtime_name: draft.runtime_name ?? `connection_${id.replaceAll('-', '')}`,
        credentials,
        transport: this.materializeTransport(draft.transport, credentials),
        created_at: now,
        updated_at: now,
      });
      connections.push(connection);
      return connection;
    });
  }

  async rename(id: string, label: string): Promise<ConnectionProfile> {
    return this.mutate(async (connections) => {
      const index = connections.findIndex((connection) => connection.id === id);
      if (index === -1) throw new Error(`Connection ${id} was not found`);
      const renamed = ConnectionProfileSchema.parse({
        ...connections[index],
        label,
        updated_at: new Date().toISOString(),
      });
      connections[index] = renamed;
      return renamed;
    });
  }

  async duplicate(id: string, label: string): Promise<ConnectionProfile> {
    return this.mutate(async (connections) => {
      const original = connections.find((connection) => connection.id === id);
      if (!original) throw new Error(`Connection ${id} was not found`);

      const credentialIDs = new Map<string, string>();
      const credentials = original.credentials.map((credential) => {
        const newID = randomUUID();
        credentialIDs.set(credential.id, newID);
        return { ...credential, id: newID };
      });
      const newID = randomUUID();
      const now = new Date().toISOString();
      const duplicate = ConnectionProfileSchema.parse({
        ...original,
        id: newID,
        label,
        runtime_name: `connection_${newID.replaceAll('-', '')}`,
        credentials,
        transport: this.remapTransportCredentials(original.transport, credentialIDs),
        created_at: now,
        updated_at: now,
      });
      connections.push(duplicate);
      return duplicate;
    });
  }

  async remove(id: string): Promise<void> {
    return this.mutate(async (connections) => {
      const index = connections.findIndex((connection) => connection.id === id);
      if (index === -1) throw new Error(`Connection ${id} was not found`);
      connections.splice(index, 1);
    });
  }

  private remapTransportCredentials(
    transport: ConnectionTransport,
    credentialIDs: ReadonlyMap<string, string>,
  ): ConnectionTransport {
    if (transport.kind === 'mcp_stdio') {
      return {
        ...transport,
        environment: Object.fromEntries(Object.entries(transport.environment).map(([name, id]) => (
          [name, credentialIDs.get(id) ?? id]
        ))),
      };
    }
    return {
      ...transport,
      headers: transport.headers.map((header) => ({
        ...header,
        credential_id: credentialIDs.get(header.credential_id) ?? header.credential_id,
      })),
    };
  }

  private materializeTransport(
    transport: ConnectionProfileDraft['transport'],
    credentials: CredentialReference[],
  ): ConnectionTransport {
    if (transport.kind === 'mcp_stdio') {
      return {
        ...transport,
        environment: Object.fromEntries(Object.entries(transport.environment).map(([name, index]) => (
          [name, this.credentialId(credentials, index)]
        ))),
      };
    }
    return {
      kind: transport.kind,
      url: transport.url,
      headers: transport.headers.map(({ name, credential_index: index, prefix = '' }) => ({
        name,
        prefix,
        credential_id: this.credentialId(credentials, index),
      })),
    };
  }

  private credentialId(credentials: CredentialReference[], index: number): string {
    const credential = credentials[index];
    if (!credential) throw new Error(`Credential index ${index} is unavailable`);
    return credential.id;
  }

  private async mutate<T>(change: (connections: ConnectionProfile[]) => Promise<T>): Promise<T> {
    const operation = this.pendingMutation.then(async () => {
      const registry = await this.readRegistry();
      const result = await change(registry.connections);
      await this.writeRegistry(registry.connections);
      return result;
    });
    this.pendingMutation = operation.catch(() => undefined);
    return operation;
  }

  private async readRegistry() {
    try {
      return ConnectionProfileRegistrySchema.parse(JSON.parse(await readFile(this.path, 'utf8')));
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return { ...EMPTY_REGISTRY, connections: [] };
      throw error;
    }
  }

  private async writeRegistry(connections: ConnectionProfile[]): Promise<void> {
    const registry = ConnectionProfileRegistrySchema.parse({ schema_version: 1, connections });
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.path);
    await chmod(this.path, 0o600);
  }
}
