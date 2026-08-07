import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';

type LauncherPayload = {
  command: string;
  args: string[];
  credential_broker: string;
  credential_grant: string;
};

function parsePayload(raw: string | undefined): LauncherPayload {
  if (!raw) throw new Error('Missing MCP launcher payload');
  const value = JSON.parse(raw) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid MCP launcher payload');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.command !== 'string' || !Array.isArray(record.args)
    || record.args.some((entry) => typeof entry !== 'string')
    || typeof record.credential_broker !== 'string'
    || typeof record.credential_grant !== 'string') {
    throw new Error('Invalid MCP launcher payload');
  }
  return {
    command: record.command,
    args: record.args as string[],
    credential_broker: record.credential_broker,
    credential_grant: record.credential_grant,
  };
}

async function fetchCredentials(socketPath: string, grant: string): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let response = '';
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.end(`${grant}\n`));
    socket.on('data', (chunk: string) => {
      response += chunk;
      if (response.length > 64 * 1024) socket.destroy(new Error('Credential response is too large'));
    });
    socket.once('error', reject);
    socket.once('end', () => {
      try {
        const parsed = JSON.parse(response) as { credentials?: Record<string, string>; error?: string };
        if (!parsed.credentials || parsed.error) throw new Error('Credential grant was refused');
        resolve(parsed.credentials);
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function main(): Promise<void> {
  const payload = parsePayload(process.argv[2]);
  const credentials = await fetchCredentials(
    payload.credential_broker,
    payload.credential_grant,
  );
  const environment = { ...process.env, ...credentials };
  const child = spawn(payload.command, payload.args, {
    env: environment,
    stdio: 'inherit',
  });
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    },
  );
  if (result.signal) process.kill(process.pid, result.signal);
  process.exitCode = result.code ?? 1;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'MCP credential launcher failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
