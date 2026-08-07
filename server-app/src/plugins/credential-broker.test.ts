import { createConnection } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  credentialBrokerSocketPath,
  startCredentialBroker,
} from './credential-broker.js';

function request(socketPath: string, grant: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let response = '';
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.end(`${grant}\n`));
    socket.on('data', (chunk: string) => { response += chunk; });
    socket.once('error', reject);
    socket.once('end', () => resolve(response));
  });
}

describe('credential broker', () => {
  it('returns a credential grant once and refuses replay', async () => {
    const socketPath = credentialBrokerSocketPath();
    const close = await startCredentialBroker({
      socketPath,
      grants: { 'one-time-grant': { TOKEN: 'secret-value' } },
    });
    try {
      expect(JSON.parse(await request(socketPath, 'one-time-grant'))).toEqual({
        credentials: { TOKEN: 'secret-value' },
      });
      expect(JSON.parse(await request(socketPath, 'one-time-grant'))).toEqual({
        error: 'invalid_or_consumed_grant',
      });
    } finally {
      await close();
    }
  });
});
