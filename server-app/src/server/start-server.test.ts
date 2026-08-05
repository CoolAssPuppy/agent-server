import { createServer, request, type Server as HttpServer } from 'http';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';

import { loadConfig, type ServerConfig } from '../platform/config.js';
import type { ExecutionResult } from '../execution/executor.js';
import { RunStore } from '../reporting/store.js';
import { createTempDir, makeRecordingAnalytics } from '../test-factories.js';
import { startServer, type ServerInstance } from './server.js';

const executeAgent = vi.hoisted(() => vi.fn());
const createTelegramChannel = vi.hoisted(() => vi.fn());
const createSlackChannel = vi.hoisted(() => vi.fn());
const routeMessage = vi.hoisted(() => vi.fn());

vi.mock('../plugins/claude-code.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../plugins/claude-code.js')>();
  return {
    ...original,
    executeAgent,
    probeMcpServers: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../channels/telegram.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../channels/telegram.js')>();
  return { ...original, createTelegramChannel };
});

vi.mock('../channels/slack.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../channels/slack.js')>();
  return { ...original, createSlackChannel };
});

vi.mock('../channels/router.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../channels/router.js')>();
  return { ...original, routeMessage };
});

const API_KEY = 'start-server-test-key-32-characters';
const INTEGRATION_WAIT_TIMEOUT_MS = 15_000;

function waitForIntegration(assertion: () => void | Promise<void>): Promise<void> {
  return vi.waitFor(assertion, { timeout: INTEGRATION_WAIT_TIMEOUT_MS });
}

type TestServerContext = {
  home: string;
  port: number;
  config: ServerConfig;
};

async function createTestServerContext(
  label: string,
  environment: Record<string, string | undefined> = {},
): Promise<TestServerContext> {
  const home = createTempDir(label);
  const port = await reservePort();
  mkdirSync(join(home, 'agents'), { recursive: true });
  return {
    home,
    port,
    config: loadConfig({
      AGENT_SERVER_HOME: home,
      AGENT_SERVER_API_KEY: API_KEY,
      AGENT_SERVER_PORT: String(port),
      AGENT_SERVER_CHECK_INTERVAL_MS: '600000',
      ...environment,
    }),
  };
}

function createFakeChatChannel(name: 'telegram' | 'slack', identity: number | string | undefined) {
  let currentIdentity = identity;
  let messageCallback: ((text: string) => void) | undefined;
  let replyCallback: ((reply: {
    interactionId: string;
    selectedValue?: string;
    freeText?: string;
  }) => void) | undefined;
  return {
    name,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn().mockResolvedValue(1),
    notifyText: vi.fn().mockResolvedValue(1),
    expireInteraction: vi.fn().mockResolvedValue(undefined),
    onMessage(callback: (text: string) => void) {
      messageCallback = callback;
    },
    onReply(callback: typeof replyCallback) {
      replyCallback = callback;
    },
    getChatId: () => typeof currentIdentity === 'number' ? currentIdentity : undefined,
    getChannelId: () => typeof currentIdentity === 'string' ? currentIdentity : undefined,
    getPairingStatus: vi.fn(async () => typeof currentIdentity === 'string'
      ? { state: 'ready', can_open_slack: true, can_test: true }
      : { state: 'needs_pairing', can_open_slack: false, can_test: false }),
    pair: vi.fn(async (channelId: string) => {
      currentIdentity = channelId;
    }),
    sendTestMessage: vi.fn().mockResolvedValue(undefined),
    emitMessage(text: string) {
      messageCallback?.(text);
    },
    emitReply(reply: { interactionId: string; selectedValue?: string; freeText?: string }) {
      replyCallback?.(reply);
    },
  };
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw new Error('Failed to reserve a loopback port');
  }
  await closeServer(server);
  return address.port;
}

function closeServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
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

function executionResult(
  summary: string,
  overrides: Partial<ExecutionResult> = {},
): ExecutionResult {
  return {
    summary,
    output: {},
    usage: {},
    turnCount: 1,
    toolsUsed: [],
    filesRead: [],
    filesWritten: [],
    commandsRun: [],
    ...overrides,
  };
}

function writeAgent(home: string, filename: string, yaml: string): void {
  writeFileSync(join(home, 'agents', filename), yaml, 'utf8');
}

function restrictedAgentLines(home: string): string[] {
  return [
    `working_directory: ${home}`,
    'tools: [Read, Glob, Grep]',
    'disallowed_tools: [Write, Edit, Bash, WebFetch, WebSearch]',
    'permission_mode: default',
  ];
}

async function triggerAgent(port: number, agentId: string): Promise<string> {
  const preflightResponse = await fetch(
    `http://127.0.0.1:${port}/security/agents/${agentId}/preflight`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}` },
    },
  );
  expect(preflightResponse.status).toBe(200);
  const preflight = await preflightResponse.json() as { content_hash: string };
  const response = await fetch(`http://127.0.0.1:${port}/agents/${agentId}/run`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ confirmed_content_hash: preflight.content_hash }),
  });
  const body = await response.json() as { runId: string; error?: string; code?: string };
  expect({ status: response.status, body }).toMatchObject({ status: 202 });
  return body.runId;
}

describe('startServer production composition', { timeout: 20_000 }, () => {
  it('runs an HTTP-triggered agent through the production lifecycle', async () => {
    const context = await createTestServerContext('http-run-server');
    const store = new RunStore();
    writeAgent(context.home, 'worker.yaml', [
      'id: worker',
      'name: Worker',
      'prompt: Do the work',
      ...restrictedAgentLines(context.home),
      'enabled: true',
      '',
    ].join('\n'));
    const callCountBefore = executeAgent.mock.calls.length;
    executeAgent.mockResolvedValueOnce(executionResult('Work completed'));
    const server = startServer(context.config, { store });

    try {
      await server.ready;
      const runId = await triggerAgent(context.port, 'worker');
      await waitForIntegration(() => {
        expect(store.get(runId)).toMatchObject({
          status: 'completed',
          summary: 'Work completed',
        });
      });
      expect(executeAgent).toHaveBeenCalledTimes(callCountBefore + 1);
    } finally {
      await server.stop();
      rmSync(context.home, { recursive: true, force: true });
    }
  });

  it('fires declared downstream agents through the production terminal hook', async () => {
    const context = await createTestServerContext('chained-run-server');
    const store = new RunStore();
    writeAgent(context.home, 'source.yaml', [
      'id: source',
      'name: Source',
      'prompt: Start the chain',
      ...restrictedAgentLines(context.home),
      'enabled: true',
      'on_complete:',
      '  - agent: downstream',
      '',
    ].join('\n'));
    writeAgent(context.home, 'downstream.yaml', [
      'id: downstream',
      'name: Downstream',
      'prompt: Finish the chain',
      ...restrictedAgentLines(context.home),
      'enabled: true',
      '',
    ].join('\n'));
    const callCountBefore = executeAgent.mock.calls.length;
    executeAgent
      .mockResolvedValueOnce(executionResult('Source completed'))
      .mockResolvedValueOnce(executionResult('Downstream completed'));
    const server = startServer(context.config, { store });

    try {
      await server.ready;
      await triggerAgent(context.port, 'source');
      await waitForIntegration(() => {
        expect(store.list()).toHaveLength(2);
        expect(store.list().map((run) => run.status)).toEqual(['completed', 'completed']);
      });
      expect(executeAgent).toHaveBeenCalledTimes(callCountBefore + 2);
    } finally {
      await server.stop();
      rmSync(context.home, { recursive: true, force: true });
    }
  });

  it('reconciles locally orphaned runs before serving run history', async () => {
    const context = await createTestServerContext('orphaned-run-server');
    const store = new RunStore();
    store.add({
      runId: 'orphaned-run',
      agentId: 'worker',
      agentName: 'Worker',
      status: 'running',
      startedAt: new Date('2026-01-01T00:00:00Z'),
      turnCount: 0,
      toolsUsed: [],
      filesRead: [],
      filesWritten: [],
      commandsRun: [],
      progressMessages: [],
    });
    const server = startServer(context.config, { store });

    try {
      await server.ready;
      expect(store.get('orphaned-run')).toMatchObject({
        status: 'failed',
        error: 'Server restarted while this run was in progress',
      });
    } finally {
      await server.stop();
      rmSync(context.home, { recursive: true, force: true });
    }
  });

  it('runs a due scheduled agent through the production scheduler path', async () => {
    const context = await createTestServerContext('scheduled-run-server');
    const store = new RunStore();
    writeAgent(context.home, 'scheduled.yaml', [
      'id: scheduled',
      'name: Scheduled',
      'prompt: Run on schedule',
      'schedule: "* * * * *"',
      ...restrictedAgentLines(context.home),
      'enabled: true',
      '',
    ].join('\n'));
    const callCountBefore = executeAgent.mock.calls.length;
    executeAgent.mockResolvedValueOnce(executionResult('Scheduled work completed'));
    const server = startServer(context.config, { store });

    try {
      await server.ready;
      await waitForIntegration(() => {
        expect(store.list()[0]).toMatchObject({
          agentId: 'scheduled',
          status: 'completed',
          summary: 'Scheduled work completed',
        });
      });
      expect(executeAgent).toHaveBeenCalledTimes(callCountBefore + 1);
    } finally {
      await server.stop();
      rmSync(context.home, { recursive: true, force: true });
    }
  });

  it('keeps manual and scheduled execution local with durable history when Panel is not configured', async () => {
    const context = await createTestServerContext('local-only-durable-server');
    writeAgent(context.home, 'manual.yaml', [
      'id: manual',
      'name: Manual',
      'prompt: Run manually',
      ...restrictedAgentLines(context.home),
      'enabled: true',
      '',
    ].join('\n'));
    writeAgent(context.home, 'scheduled.yaml', [
      'id: scheduled',
      'name: Scheduled',
      'prompt: Run on schedule',
      'schedule: "* * * * *"',
      ...restrictedAgentLines(context.home),
      'enabled: true',
      '',
    ].join('\n'));
    const callCountBefore = executeAgent.mock.calls.length;
    executeAgent
      .mockResolvedValueOnce(executionResult('First local run completed'))
      .mockResolvedValueOnce(executionResult('Second local run completed'));

    const localFetch = globalThis.fetch.bind(globalThis);
    const externalRequests: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string'
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);
      if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
        return localFetch(input, init);
      }
      externalRequests.push(url.href);
      return Promise.reject(new Error(`Unexpected external request: ${url.href}`));
    });

    expect(context.config.panelUrl).toBeUndefined();
    expect(context.config.panelApiKey).toBeUndefined();

    let server: ServerInstance | undefined;
    let restartedServer: ServerInstance | undefined;
    try {
      server = startServer(context.config);
      await server.ready;
      const manualRunId = await triggerAgent(context.port, 'manual');

      await waitForIntegration(async () => {
        const response = await fetch(`http://127.0.0.1:${context.port}/runs`, {
          headers: { Authorization: `Bearer ${API_KEY}` },
        });
        expect(response.status).toBe(200);
        const runs = await response.json() as Array<{
          runId: string;
          agentId: string;
          status: string;
        }>;
        expect(runs).toHaveLength(2);
        expect(runs).toEqual(expect.arrayContaining([
          expect.objectContaining({ runId: manualRunId, agentId: 'manual', status: 'completed' }),
          expect.objectContaining({ agentId: 'scheduled', status: 'completed' }),
        ]));
      });

      await server.stop();
      server = undefined;
      writeAgent(context.home, 'scheduled.yaml', [
        'id: scheduled',
        'name: Scheduled',
        'prompt: Run on schedule',
        ...restrictedAgentLines(context.home),
        'enabled: false',
        '',
      ].join('\n'));

      restartedServer = startServer(context.config);
      await restartedServer.ready;
      const historyResponse = await fetch(`http://127.0.0.1:${context.port}/runs`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
      expect(historyResponse.status).toBe(200);
      const durableRuns = await historyResponse.json() as Array<{
        runId: string;
        agentId: string;
        status: string;
      }>;
      expect(durableRuns).toHaveLength(2);
      expect(durableRuns).toEqual(expect.arrayContaining([
        expect.objectContaining({ runId: manualRunId, agentId: 'manual', status: 'completed' }),
        expect.objectContaining({ agentId: 'scheduled', status: 'completed' }),
      ]));
      expect(executeAgent).toHaveBeenCalledTimes(callCountBefore + 2);

      await restartedServer.stop();
      restartedServer = undefined;
      expect(externalRequests).toEqual([]);
    } finally {
      await restartedServer?.stop().catch(() => {});
      await server?.stop().catch(() => {});
      fetchSpy.mockRestore();
      rmSync(context.home, { recursive: true, force: true });
    }
  });

  it('runs a watched agent after its configured file changes', async () => {
    const context = await createTestServerContext('watched-run-server');
    const store = new RunStore();
    const watchedPath = join(context.home, 'watched.txt');
    writeFileSync(watchedPath, 'initial', 'utf8');
    writeAgent(context.home, 'watcher.yaml', [
      'id: watcher',
      'name: Watcher',
      'prompt: Respond to the changed file',
      ...restrictedAgentLines(context.home),
      'watch:',
      `  - path: ${watchedPath}`,
      'enabled: true',
      '',
    ].join('\n'));
    executeAgent.mockResolvedValueOnce(executionResult('Watched work completed'));
    const server = startServer(context.config, { store });

    try {
      await server.ready;
      await new Promise((resolve) => setTimeout(resolve, 100));
      writeFileSync(watchedPath, 'changed', 'utf8');
      await waitForIntegration(() => {
        expect(store.list()[0]).toMatchObject({
          agentId: 'watcher',
          status: 'completed',
          summary: 'Watched work completed',
        });
      });
    } finally {
      await server.stop();
      rmSync(context.home, { recursive: true, force: true });
    }
  });

  it('cancels an HTTP-triggered run through the production abort path', async () => {
    const context = await createTestServerContext('cancel-run-server');
    const store = new RunStore();
    writeAgent(context.home, 'worker.yaml', [
      'id: worker',
      'name: Worker',
      'prompt: Wait for cancellation',
      ...restrictedAgentLines(context.home),
      'enabled: true',
      '',
    ].join('\n'));
    executeAgent.mockImplementationOnce(
      (_agent: unknown, _reporter: unknown, extra: { abortController?: AbortController }) => (
        new Promise((_, reject) => {
          extra.abortController?.signal.addEventListener('abort', () => {
            const error = new Error('Aborted by test');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        })
      ),
    );
    const server = startServer(context.config, { store });

    try {
      await server.ready;
      const runId = await triggerAgent(context.port, 'worker');
      const response = await fetch(`http://127.0.0.1:${context.port}/runs/${runId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
      expect(response.status).toBe(200);
      await waitForIntegration(() => {
        expect(store.get(runId)).toMatchObject({ status: 'failed' });
      });
    } finally {
      await server.stop();
      rmSync(context.home, { recursive: true, force: true });
    }
  });

  it('starts and stops configured Telegram and Slack transports', async () => {
    const context = await createTestServerContext('configured-channels-server', {
      AGENT_SERVER_TELEGRAM_BOT_TOKEN: 'telegram-test-token',
      AGENT_SERVER_SLACK_BOT_TOKEN: 'slack-bot-test-token',
      AGENT_SERVER_SLACK_APP_TOKEN: 'slack-app-test-token',
    });
    const telegram = createFakeChatChannel('telegram', 42);
    const slack = createFakeChatChannel('slack', 'D123');
    createTelegramChannel.mockResolvedValueOnce(telegram);
    createSlackChannel.mockResolvedValueOnce(slack);
    const server = startServer(context.config, { store: new RunStore() });

    try {
      await server.ready;
      expect(telegram.start).toHaveBeenCalledOnce();
      expect(slack.start).toHaveBeenCalledOnce();

      const pairingResponse = await fetch(
        `http://127.0.0.1:${context.port}/channels/slack/pairing`,
        { headers: { Authorization: `Bearer ${API_KEY}` } },
      );
      expect(await pairingResponse.json()).toEqual({
        state: 'ready',
        can_open_slack: true,
        can_test: true,
      });

      const saveResponse = await fetch(
        `http://127.0.0.1:${context.port}/channels/slack/pairing`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ channel_id: 'D0BK0NF46AU' }),
        },
      );
      expect(saveResponse.status).toBe(200);
      expect(slack.pair).toHaveBeenCalledWith('D0BK0NF46AU');

      const testResponse = await fetch(
        `http://127.0.0.1:${context.port}/channels/slack/pairing/test`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${API_KEY}` },
        },
      );
      expect(testResponse.status).toBe(200);
      expect(slack.sendTestMessage).toHaveBeenCalledOnce();
    } finally {
      await server.stop();
      expect(telegram.stop).toHaveBeenCalledOnce();
      expect(slack.stop).toHaveBeenCalledOnce();
      rmSync(context.home, { recursive: true, force: true });
    }
  });

  it('answers Telegram capability and unmatched-message queries', async () => {
    const context = await createTestServerContext('telegram-routing-server', {
      AGENT_SERVER_TELEGRAM_BOT_TOKEN: 'telegram-test-token',
    });
    writeAgent(context.home, 'worker.yaml', [
      'id: worker',
      'name: Worker',
      'prompt: Do the work',
      'enabled: true',
      '',
    ].join('\n'));
    const telegram = createFakeChatChannel('telegram', 42);
    createTelegramChannel.mockResolvedValueOnce(telegram);
    routeMessage
      .mockResolvedValueOnce({ type: 'list' })
      .mockResolvedValueOnce({ type: 'none' });
    const server = startServer(context.config, { store: new RunStore() });

    try {
      await server.ready;
      telegram.emitMessage('what can you do?');
      await waitForIntegration(() => {
        expect(telegram.notifyText).toHaveBeenCalledWith(expect.stringContaining('Worker'));
      });

      telegram.emitMessage('do something unrelated');
      await waitForIntegration(() => {
        expect(telegram.notifyText).toHaveBeenCalledWith(
          'No matching agent found for your message.',
        );
      });
    } finally {
      await server.stop();
      rmSync(context.home, { recursive: true, force: true });
    }
  });

  it('continues a conversational Telegram agent without routing the second message', async () => {
    const context = await createTestServerContext('telegram-conversation-server', {
      AGENT_SERVER_TELEGRAM_BOT_TOKEN: 'telegram-test-token',
    });
    const store = new RunStore();
    writeAgent(context.home, 'conversational.yaml', [
      'id: conversational',
      'name: Conversational',
      'prompt: Continue the conversation',
      ...restrictedAgentLines(context.home),
      'conversation:',
      '  enabled: true',
      '  ttl: 1h',
      'enabled: true',
      '',
    ].join('\n'));
    const telegram = createFakeChatChannel('telegram', 42);
    createTelegramChannel.mockResolvedValueOnce(telegram);
    const routeCallsBefore = routeMessage.mock.calls.length;
    routeMessage.mockImplementationOnce(
      (_text: string, agents: Array<{ id: string }>) => {
        const agent = agents.find((candidate) => candidate.id === 'conversational');
        if (!agent) {
          throw new Error('Expected the conversational agent fixture');
        }
        return Promise.resolve({ type: 'route', agent, context: 'First message' });
      },
    );
    executeAgent
      .mockResolvedValueOnce(executionResult('First answer'))
      .mockResolvedValueOnce(executionResult('Second answer'));
    const server = startServer(context.config, { store });

    try {
      await server.ready;
      telegram.emitMessage('first message');
      await waitForIntegration(() => {
        expect(store.list()[0]).toMatchObject({ status: 'completed', summary: 'First answer' });
      });

      telegram.emitMessage('second message');
      await waitForIntegration(() => {
        expect(store.list()).toHaveLength(2);
        expect(store.list()[0]).toMatchObject({ status: 'completed', summary: 'Second answer' });
      });

      expect(routeMessage).toHaveBeenCalledTimes(routeCallsBefore + 1);
      expect(telegram.notifyText).toHaveBeenCalledWith('Running Conversational...');
      expect(telegram.notify).toHaveBeenCalledWith(expect.objectContaining({
        agentName: 'Conversational',
        status: 'completed',
      }));
    } finally {
      await server.stop();
      rmSync(context.home, { recursive: true, force: true });
    }
  });

  it('delivers configured terminal notifications through the registered channel', async () => {
    const context = await createTestServerContext('terminal-notification-server', {
      AGENT_SERVER_TELEGRAM_BOT_TOKEN: 'telegram-test-token',
    });
    const store = new RunStore();
    writeAgent(context.home, 'notifier.yaml', [
      'id: notifier',
      'name: Notifier',
      'prompt: Produce a useful result',
      ...restrictedAgentLines(context.home),
      'notification:',
      '  channel: telegram',
      '  on_complete: true',
      '  on_failure: true',
      'enabled: true',
      '',
    ].join('\n'));
    const telegram = createFakeChatChannel('telegram', 42);
    createTelegramChannel.mockResolvedValueOnce(telegram);
    executeAgent.mockResolvedValueOnce(executionResult('Useful result'));
    const server = startServer(context.config, { store });

    try {
      await server.ready;
      await triggerAgent(context.port, 'notifier');
      await waitForIntegration(() => {
        expect(telegram.notify).toHaveBeenCalledWith(expect.objectContaining({
          agentName: 'Notifier',
          status: 'completed',
          summary: 'Useful result',
        }));
      });
    } finally {
      await server.stop();
      rmSync(context.home, { recursive: true, force: true });
    }
  });

  it('routes interaction replies into the configured follow-up agent', async () => {
    const context = await createTestServerContext('interaction-reply-server', {
      AGENT_SERVER_TELEGRAM_BOT_TOKEN: 'telegram-test-token',
    });
    const store = new RunStore();
    writeAgent(context.home, 'requester.yaml', [
      'id: requester',
      'name: Requester',
      'prompt: Ask for a choice',
      ...restrictedAgentLines(context.home),
      'interaction:',
      '  channel: telegram',
      '  on_reply: responder',
      '  timeout: 1h',
      'enabled: true',
      '',
    ].join('\n'));
    writeAgent(context.home, 'responder.yaml', [
      'id: responder',
      'name: Responder',
      'prompt: Handle the choice',
      ...restrictedAgentLines(context.home),
      'enabled: true',
      '',
    ].join('\n'));
    const telegram = createFakeChatChannel('telegram', 42);
    createTelegramChannel.mockResolvedValueOnce(telegram);
    executeAgent
      .mockResolvedValueOnce(executionResult('Choose', {
        interaction: {
          message: 'Continue?',
          options: [{ label: 'Yes', value: 'Continue now' }],
          freeText: false,
        },
      }))
      .mockResolvedValueOnce(executionResult('Follow-up completed'));
    const server = startServer(context.config, { store });

    try {
      await server.ready;
      await triggerAgent(context.port, 'requester');
      await waitForIntegration(() => expect(telegram.send).toHaveBeenCalledOnce());
      const interactionId = telegram.send.mock.calls[0]?.[0];
      expect(typeof interactionId).toBe('string');
      telegram.emitReply({ interactionId, selectedValue: 'Continue now' });

      await waitForIntegration(() => {
        expect(store.list()).toHaveLength(2);
        expect(store.list()[0]).toMatchObject({
          agentId: 'responder',
          status: 'completed',
          summary: 'Follow-up completed',
        });
      });
    } finally {
      await server.stop();
      rmSync(context.home, { recursive: true, force: true });
    }
  });

  it('wires authenticated HTTP interaction responses into the local follow-up path', async () => {
    const context = await createTestServerContext('http-interaction-reply-server', {
      AGENT_SERVER_TELEGRAM_BOT_TOKEN: 'telegram-test-token',
    });
    const store = new RunStore();
    writeAgent(context.home, 'requester.yaml', [
      'id: requester',
      'name: Requester',
      'prompt: Ask for a choice',
      ...restrictedAgentLines(context.home),
      'interaction:',
      '  channel: telegram',
      '  on_reply: responder',
      '  timeout: 1h',
      'enabled: true',
      '',
    ].join('\n'));
    writeAgent(context.home, 'responder.yaml', [
      'id: responder',
      'name: Responder',
      'prompt: Handle the choice',
      ...restrictedAgentLines(context.home),
      'enabled: true',
      '',
    ].join('\n'));
    const telegram = createFakeChatChannel('telegram', 42);
    createTelegramChannel.mockResolvedValueOnce(telegram);
    executeAgent
      .mockResolvedValueOnce(executionResult('Choose', {
        interaction: {
          message: 'Continue?',
          options: [{ label: 'Yes', value: 'Continue through HTTP' }],
          freeText: false,
        },
      }))
      .mockResolvedValueOnce(executionResult('HTTP follow-up completed'));
    const server = startServer(context.config, { store });

    try {
      await server.ready;
      await triggerAgent(context.port, 'requester');
      await waitForIntegration(() => expect(telegram.send).toHaveBeenCalledOnce());
      const interactionId = telegram.send.mock.calls[0]?.[0];
      expect(typeof interactionId).toBe('string');

      const projection = await fetch(
        `http://127.0.0.1:${context.port}/interactions/${String(interactionId)}`,
        { headers: { Authorization: `Bearer ${API_KEY}` } },
      );
      expect(projection.status).toBe(200);
      await expect(projection.json()).resolves.toMatchObject({
        interaction_id: interactionId,
        options: [{ index: 0, label: 'Yes' }],
      });

      const response = await fetch(
        `http://127.0.0.1:${context.port}/interactions/${String(interactionId)}/reply`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ response: { type: 'option', optionIndex: 0 } }),
        },
      );
      expect(response.status).toBe(202);

      await waitForIntegration(() => {
        expect(store.list()).toHaveLength(2);
        expect(store.list()[0]).toMatchObject({
          agentId: 'responder',
          status: 'completed',
          summary: 'HTTP follow-up completed',
        });
      });
    } finally {
      await server.stop();
      rmSync(context.home, { recursive: true, force: true });
    }
  });

  it('rejects readiness and remains safely stoppable when the listener cannot bind', async () => {
    const context = await createTestServerContext('failed-start-server');
    const blocker = await listenOnPort(context.port);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const server = startServer(context.config, { store: new RunStore() });

    try {
      await expect(server.ready).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(log).not.toHaveBeenCalledWith(
        `Agent Server API listening on http://127.0.0.1:${context.port}`,
      );
      await expect(server.stop()).resolves.toBeUndefined();
    } finally {
      await server.stop().catch(() => {});
      try {
        await closeServer(blocker);
      } finally {
        log.mockRestore();
        rmSync(context.home, { recursive: true, force: true });
      }
    }
  });

  it('becomes ready with authenticated HTTP and WebSocket transports wired', async () => {
    const context = await createTestServerContext('start-server');
    let server: ServerInstance | undefined;

    try {
      server = startServer(context.config, { store: new RunStore() });
      await server.ready;

      const health = await fetch(`http://127.0.0.1:${context.port}/health`);
      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toMatchObject({ status: 'ok' });

      const unauthorized = await fetch(`http://127.0.0.1:${context.port}/agents`);
      expect(unauthorized.status).toBe(401);

      const authorized = await fetch(`http://127.0.0.1:${context.port}/agents`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
      expect(authorized.status).toBe(200);
      await expect(authorized.json()).resolves.toEqual([]);

      const machine = await fetch(`http://127.0.0.1:${context.port}/machine`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
      expect(machine.status).toBe(200);
      const identity = await machine.json() as { machine_id: string };
      expect(readFileSync(join(context.home, 'machine-id'), 'utf8')).toBe(`${identity.machine_id}\n`);

      await expect(websocketUpgradeStatus(context.port)).resolves.toBe(401);
      await expect(websocketUpgradeStatus(context.port, API_KEY)).resolves.toBe(101);
    } finally {
      try {
        await server?.stop();
      } finally {
        rmSync(context.home, { recursive: true, force: true });
      }
    }
  });

  it('keeps the local API ready while Panel schedule sync is unavailable', async () => {
    const panelUrl = 'https://panel-unavailable.example.com';
    const context = await createTestServerContext('panel-unavailable-server', {
      AGENT_SERVER_PANEL_URL: panelUrl,
      AGENT_SERVER_PANEL_API_KEY: 'panel-test-key',
    });
    const localFetch = globalThis.fetch.bind(globalThis);
    const panelRequests: string[] = [];
    const releaseCallbacks: Array<() => void> = [];
    let isReleased = false;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
      if (!url.startsWith(panelUrl)) return localFetch(input, init);

      panelRequests.push(url);
      if (isReleased) return Promise.resolve(new Response('{}', { status: 503 }));
      return new Promise<Response>((resolve) => {
        releaseCallbacks.push(() => resolve(new Response('{}', { status: 503 })));
      });
    });
    const server = startServer(context.config, { store: new RunStore() });

    try {
      const readiness = await Promise.race([
        server.ready.then(() => 'ready' as const),
        new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 1_000)),
      ]);
      expect(readiness).toBe('ready');

      const health = await localFetch(`http://127.0.0.1:${context.port}/health`);
      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toMatchObject({ status: 'ok' });
      await vi.waitFor(() => {
        expect(panelRequests).toContain(`${panelUrl}/api/agents/sync`);
      });
    } finally {
      isReleased = true;
      for (const release of releaseCallbacks) release();
      await server.stop().catch(() => {});
      fetchSpy.mockRestore();
      rmSync(context.home, { recursive: true, force: true });
    }
  });

  it('composes deterministic Assistant home facts into the production HTTP API', async () => {
    const context = await createTestServerContext('assistant-home-server');
    writeAgent(context.home, 'reader.yaml', [
      'id: reader',
      'name: Local Reader',
      'description: Reviews local notes.',
      'prompt: Read the notes.',
      `working_directory: ${context.home}`,
      'tools: [Read, Glob, Grep]',
      'disallowed_tools: [Write, Edit, Bash]',
      'enabled: true',
      '',
    ].join('\n'));
    const server = startServer(context.config, { store: new RunStore() });

    try {
      await server.ready;
      const response = await fetch(
        `http://127.0.0.1:${context.port}/presentation/assistants/reader`,
        { headers: { Authorization: `Bearer ${API_KEY}` } },
      );
      const body = await response.json() as {
        assistant: { localAgentId: string };
        readiness: { checks: Array<{ kind: string; state: string }> };
        permissions: Array<{ action: string; exactScopeReference: string }>;
      };

      expect(response.status).toBe(200);
      expect(body.assistant.localAgentId).toBe('reader');
      expect(body.readiness.checks).toContainEqual(expect.objectContaining({
        kind: 'file',
        state: 'pass',
      }));
      expect(body.permissions).toContainEqual(expect.objectContaining({
        action: 'read',
        exactScopeReference: context.home,
      }));
    } finally {
      await server.stop();
      rmSync(context.home, { recursive: true, force: true });
    }
  });

  it('awaits one idempotent shutdown before releasing the listener', async () => {
    const context = await createTestServerContext('stop-server');
    const store = new RunStore();
    const closeSpy = vi.spyOn(store, 'close');
    const server = startServer(context.config, { store });

    try {
      await server.ready;
      await Promise.all([server.stop(), server.stop()]);

      expect(closeSpy).toHaveBeenCalledOnce();
      const replacement = await listenOnPort(context.port);
      await closeServer(replacement);
    } finally {
      try {
        await server.stop();
      } finally {
        rmSync(context.home, { recursive: true, force: true });
      }
    }
  });

  it('closes run admission before scheduled, watched, downstream, or channel work can start', async () => {
    const context = await createTestServerContext('stop-admission-server', {
      AGENT_SERVER_TELEGRAM_BOT_TOKEN: 'telegram-test-token',
    });
    const watchedPath = join(context.home, 'watched.txt');
    writeFileSync(watchedPath, 'initial', 'utf8');
    writeAgent(context.home, 'scheduled.yaml', [
      'id: scheduled',
      'name: Scheduled',
      'prompt: Run on schedule',
      'schedule: "* * * * *"',
      ...restrictedAgentLines(context.home),
      'enabled: true',
      '',
    ].join('\n'));
    writeAgent(context.home, 'watcher.yaml', [
      'id: watcher',
      'name: Watcher',
      'prompt: Run after a file change',
      ...restrictedAgentLines(context.home),
      'watch:',
      `  - path: ${watchedPath}`,
      'enabled: true',
      '',
    ].join('\n'));
    writeAgent(context.home, 'channel.yaml', [
      'id: channel',
      'name: Channel',
      'prompt: Run from a message',
      ...restrictedAgentLines(context.home),
      'enabled: true',
      '',
    ].join('\n'));
    const telegram = createFakeChatChannel('telegram', 42);
    createTelegramChannel.mockResolvedValueOnce(telegram);
    routeMessage.mockImplementationOnce(
      (_text: string, agents: Array<{ id: string }>) => Promise.resolve({
        type: 'route',
        agent: agents.find((agent) => agent.id === 'channel'),
        context: 'Message context',
      }),
    );
    const executeCallsBefore = executeAgent.mock.calls.length;
    const routeCallsBefore = routeMessage.mock.calls.length;
    executeAgent.mockResolvedValue(executionResult('Unexpected work'));
    const server = startServer(context.config, { store: new RunStore() });

    try {
      await server.ready;
      const stopping = server.stop();
      telegram.emitMessage('run the channel agent');
      writeFileSync(watchedPath, 'changed', 'utf8');
      await stopping;
      await new Promise((resolve) => setTimeout(resolve, 600));

      expect(executeAgent).toHaveBeenCalledTimes(executeCallsBefore);
      expect(routeMessage).toHaveBeenCalledTimes(routeCallsBefore);
    } finally {
      await server.stop();
      rmSync(context.home, { recursive: true, force: true });
    }
  });

  it('drains admitted terminal work before closing the store and rejects downstream work', async () => {
    const context = await createTestServerContext('stop-drain-server');
    const store = new RunStore();
    const closeSpy = vi.spyOn(store, 'close');
    writeAgent(context.home, 'source.yaml', [
      'id: source',
      'name: Source',
      'prompt: Finish during shutdown',
      ...restrictedAgentLines(context.home),
      'on_complete:',
      '  - agent: downstream',
      'enabled: true',
      '',
    ].join('\n'));
    writeAgent(context.home, 'downstream.yaml', [
      'id: downstream',
      'name: Downstream',
      'prompt: Must not start during shutdown',
      ...restrictedAgentLines(context.home),
      'enabled: true',
      '',
    ].join('\n'));
    let finishSource: (() => void) | undefined;
    let sourceWasAborted = false;
    const executeCallsBefore = executeAgent.mock.calls.length;
    executeAgent.mockImplementationOnce(
      (_agent: unknown, _reporter: unknown, extra: { abortController?: AbortController }) => (
        new Promise<ExecutionResult>((resolve) => {
          extra.abortController?.signal.addEventListener('abort', () => {
            sourceWasAborted = true;
          }, { once: true });
          finishSource = () => resolve(executionResult('Source completed'));
        })
      ),
    );
    const server = startServer(context.config, { store });

    try {
      await server.ready;
      await triggerAgent(context.port, 'source');
      await waitForIntegration(() => expect(finishSource).toBeTypeOf('function'));

      const stopping = server.stop();
      await waitForIntegration(() => expect(sourceWasAborted).toBe(true));
      expect(closeSpy).not.toHaveBeenCalled();
      finishSource?.();
      await stopping;

      expect(executeAgent).toHaveBeenCalledTimes(executeCallsBefore + 1);
      expect(closeSpy).toHaveBeenCalledOnce();
    } finally {
      finishSource?.();
      await server.stop();
      rmSync(context.home, { recursive: true, force: true });
    }
  });
});

describe('server analytics', { timeout: 20_000 }, () => {
  it('reports what the daemon actually ran, with no user content in the payload', async () => {
    const context = await createTestServerContext('analytics-run-server');
    const store = new RunStore();
    const analytics = makeRecordingAnalytics();
    writeAgent(context.home, 'worker.yaml', [
      'id: worker',
      'name: Quarterly Board Review',
      'prompt: Summarize the board deck at /Users/sam/board.pdf',
      ...restrictedAgentLines(context.home),
      'enabled: true',
      '',
    ].join('\n'));
    executeAgent.mockResolvedValueOnce(executionResult('Reviewed the deck for Acme Corp'));
    const server = startServer(context.config, { store, analytics });

    try {
      await server.ready;
      const runId = await triggerAgent(context.port, 'worker');
      await waitForIntegration(() => {
        expect(store.get(runId)?.status).toBe('completed');
      });

      expect(analytics.names()).toContain('agent_run_dispatched');
      await waitForIntegration(() => {
        expect(analytics.find('agent_run_settled')?.properties).toMatchObject({
          agent_id: 'worker',
          status: 'completed',
        });
      });

      // The agent's name, its prompt, the path it was given, and the summary it
      // produced are all user content. None of them may appear anywhere.
      const payload = JSON.stringify(analytics.captured);
      for (const secret of ['Quarterly Board Review', 'board.pdf', 'Acme Corp', '/Users/sam']) {
        expect(payload).not.toContain(secret);
      }
    } finally {
      await server.stop();
      rmSync(context.home, { recursive: true, force: true });
    }
  });

  it('flushes buffered events inside its own shutdown drain', async () => {
    const context = await createTestServerContext('analytics-flush-server');
    const analytics = makeRecordingAnalytics();
    const server = startServer(context.config, { store: new RunStore(), analytics });

    try {
      await server.ready;
      // Runs settle during the drain, so a server that only flushed before
      // draining would lose the terminal events it just recorded.
      expect(analytics.flushCount).toBe(0);
      await server.stop();
      expect(analytics.flushCount).toBeGreaterThan(0);
    } finally {
      rmSync(context.home, { recursive: true, force: true });
    }
  });

  it('records which coding agents this machine actually has installed', async () => {
    const context = await createTestServerContext('analytics-executor-server');
    const analytics = makeRecordingAnalytics();
    const server = startServer(context.config, { store: new RunStore(), analytics });

    try {
      await server.ready;
      const executorEvents = analytics.captured.filter(
        ({ event }) => event === 'executor_resolved' || event === 'executor_unavailable',
      );
      expect(executorEvents).toHaveLength(3);
      expect(executorEvents.map(({ properties }) => properties.executor).sort())
        .toEqual(['claude', 'codex', 'kimi']);
    } finally {
      await server.stop();
      rmSync(context.home, { recursive: true, force: true });
    }
  });
});
