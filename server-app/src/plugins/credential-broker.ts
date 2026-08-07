import { randomUUID } from 'node:crypto';
import { chmod, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';

export type CredentialBrokerPlan = {
  socketPath: string;
  grants: Record<string, Record<string, string>>;
};

export function credentialBrokerSocketPath(): string {
  return join('/tmp', `as-mcp-${process.pid}-${randomUUID().slice(0, 12)}.sock`);
}

/** Starts a one-use local credential broker for MCP launchers. */
export async function startCredentialBroker(
  plan: CredentialBrokerPlan | undefined,
): Promise<() => Promise<void>> {
  if (!plan) return async () => undefined;
  const remaining = new Map(Object.entries(plan.grants));
  const server = createServer((socket) => {
    let request = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      request += chunk;
      if (request.length > 512) socket.destroy();
      if (!request.includes('\n')) return;
      const grant = request.slice(0, request.indexOf('\n'));
      const credentials = remaining.get(grant);
      if (!credentials) {
        socket.end(JSON.stringify({ error: 'invalid_or_consumed_grant' }));
        return;
      }
      remaining.delete(grant);
      socket.end(JSON.stringify({ credentials }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(plan.socketPath, resolve);
  });
  await chmod(plan.socketPath, 0o600);
  return async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await unlink(plan.socketPath).catch(() => undefined);
  };
}
