import { createServer, request, type Server as HttpServer } from 'http';
import { mkdirSync, rmSync } from 'fs';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../platform/config.js';
import { RunStore } from '../reporting/store.js';
import { createTempDir } from '../test-factories.js';
import { startServer, type ServerInstance } from './server.js';

vi.mock('../plugins/claude-code.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../plugins/claude-code.js')>();
  return {
    ...original,
    probeMcpServers: vi.fn().mockResolvedValue([]),
  };
});

const API_KEY = 'start-server-test-key-32-characters';

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Failed to reserve a loopback port');
  }
  await closeServer(server);
  return address.port;
}

function closeServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function listenOnPort(port: number): Promise<HttpServer> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function websocketUpgradeStatus(port: number, apiKey?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const upgradeRequest = request({
      host: '127.0.0.1',
      port,
      path: '/ws',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        'Sec-WebSocket-Version': '13',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    });
    upgradeRequest.once('upgrade', (response, socket) => {
      socket.destroy();
      resolve(response.statusCode ?? 101);
    });
    upgradeRequest.once('response', (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    upgradeRequest.once('error', reject);
    upgradeRequest.end();
  });
}

describe('startServer production composition', () => {
  it('rejects readiness and remains safely stoppable when the listener cannot bind', async () => {
    const home = createTempDir('failed-start-server');
    const port = await reservePort();
    const blocker = await listenOnPort(port);
    mkdirSync(join(home, 'agents'), { recursive: true });
    const config = loadConfig({
      AGENT_SERVER_HOME: home,
      AGENT_SERVER_API_KEY: API_KEY,
      AGENT_SERVER_PORT: String(port),
      AGENT_SERVER_CHECK_INTERVAL_MS: '600000',
    });
    const server = startServer(config, { store: new RunStore() });

    try {
      await expect(server.ready).rejects.toMatchObject({ code: 'EADDRINUSE' });
      await expect(server.stop()).resolves.toBeUndefined();
    } finally {
      await closeServer(blocker);
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('becomes ready with authenticated HTTP and WebSocket transports wired', async () => {
    const home = createTempDir('start-server');
    const port = await reservePort();
    mkdirSync(join(home, 'agents'), { recursive: true });
    const config = loadConfig({
      AGENT_SERVER_HOME: home,
      AGENT_SERVER_API_KEY: API_KEY,
      AGENT_SERVER_PORT: String(port),
      AGENT_SERVER_CHECK_INTERVAL_MS: '600000',
    });
    let server: ServerInstance | undefined;

    try {
      server = startServer(config, { store: new RunStore() });
      await server.ready;

      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toMatchObject({ status: 'ok' });

      const unauthorized = await fetch(`http://127.0.0.1:${port}/agents`);
      expect(unauthorized.status).toBe(401);

      const authorized = await fetch(`http://127.0.0.1:${port}/agents`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
      expect(authorized.status).toBe(200);
      await expect(authorized.json()).resolves.toEqual([]);

      await expect(websocketUpgradeStatus(port)).resolves.toBe(401);
      await expect(websocketUpgradeStatus(port, API_KEY)).resolves.toBe(101);
    } finally {
      await server?.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('awaits one idempotent shutdown before releasing the listener', async () => {
    const home = createTempDir('stop-server');
    const port = await reservePort();
    mkdirSync(join(home, 'agents'), { recursive: true });
    const config = loadConfig({
      AGENT_SERVER_HOME: home,
      AGENT_SERVER_API_KEY: API_KEY,
      AGENT_SERVER_PORT: String(port),
      AGENT_SERVER_CHECK_INTERVAL_MS: '600000',
    });
    const store = new RunStore();
    const closeSpy = vi.spyOn(store, 'close');
    const server = startServer(config, { store });

    try {
      await server.ready;
      await Promise.all([server.stop(), server.stop()]);

      expect(closeSpy).toHaveBeenCalledOnce();
      const replacement = await listenOnPort(port);
      await closeServer(replacement);
    } finally {
      await server.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
