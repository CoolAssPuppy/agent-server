import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  agent as createAcpAgent,
  methods,
  PROTOCOL_VERSION,
  type RequestPermissionResponse,
  type Stream,
} from '@agentclientprotocol/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prepareSafeTestAgent } from '../creation/safe-test.js';
import type { Reporter } from '../execution/runner.js';
import { createTempDir, makeAgent } from '../test-factories.js';
import { executeAgent } from './claude-code.js';
import { runKimiAcpSession } from './kimi-code.js';

const setMcpServers = vi.fn();
const query = vi.fn();

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => query(...args),
}));

function reporter(): Reporter {
  return {
    start: vi.fn(),
    progress: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    stop: vi.fn(),
  };
}

function claudeStream() {
  const stream = (async function* () {
    yield {
      type: 'result' as const,
      subtype: 'success' as const,
      duration_ms: 1,
      duration_api_ms: 1,
      is_error: false,
      num_turns: 1,
      result: 'Reviewed',
      stop_reason: 'end_turn',
      total_cost_usd: 0,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        server_tool_use_input_tokens: 0,
      },
      modelUsage: {},
      permission_denials: [],
      uuid: '00000000-0000-0000-0000-000000000001' as `${string}-${string}-${string}-${string}-${string}`,
      session_id: 'safe-test',
    };
  })();
  return Object.assign(stream, {
    mcpServerStatus: vi.fn().mockResolvedValue([]),
    reconnectMcpServer: vi.fn(),
    setMcpServers,
    interrupt: vi.fn(),
    close: vi.fn(),
  });
}

function createStreamPair(): [Stream, Stream] {
  const clientToAgent = new TransformStream();
  const agentToClient = new TransformStream();
  return [
    { writable: clientToAgent.writable, readable: agentToClient.readable },
    { writable: agentToClient.writable, readable: clientToAgent.readable },
  ];
}

beforeEach(() => {
  query.mockReset();
  setMcpServers.mockReset();
  setMcpServers.mockResolvedValue({ added: [], removed: [], errors: {} });
});

describe('safe-test executor conformance', () => {
  it('composes Claude Code with read-only files and no command, web, or MCP effects', async () => {
    const previousEventKit = process.env.AGENT_SERVER_EVENTKIT_BIN;
    process.env.AGENT_SERVER_EVENTKIT_BIN = '/Applications/Agent Server.app/eventkit';
    query.mockReturnValue(claudeStream());
    try {
      const safeAgent = prepareSafeTestAgent(makeAgent({
        executor: 'claude-code',
        tools: ['Read', 'Write', 'Bash', 'WebFetch', 'mcp__notes__create_page'],
        permissions: {
          allow: ['Read', 'Write', 'Bash', 'WebFetch', 'mcp__notes__create_page'],
          deny: [],
        },
        file_access: [{ path: '/tmp', kind: 'folder', access: 'read_write' }],
        mcp_servers: { notes: { command: '/usr/bin/notes-mcp' } },
        native_services: {
          reminders: { resources: [{ id: 'tasks', name: 'Tasks', actions: ['read', 'create'] }] },
        },
      }));

      await executeAgent(safeAgent, reporter(), { disableMcpServers: true });

      const options = query.mock.calls[0][0].options;
      const canUseTool = options.canUseTool;
      const toolOptions = { signal: new AbortController().signal, toolUseID: 'safe-test' };
      expect(options.allowedTools).toEqual(['Read']);
      expect(options.permissionMode).toBe('dontAsk');
      expect(setMcpServers).toHaveBeenLastCalledWith({});
      await expect(canUseTool('Read', { file_path: '/tmp/reference.md' }, toolOptions))
        .resolves.toEqual({ behavior: 'allow' });
      for (const [tool, input] of [
        ['Write', { file_path: '/tmp/output.md' }],
        ['Bash', { command: 'touch /tmp/output.md' }],
        ['WebFetch', { url: 'https://example.com' }],
        ['mcp__notes__create_page', {}],
      ] as const) {
        await expect(canUseTool(tool, input, toolOptions)).resolves.toMatchObject({ behavior: 'deny' });
      }
    } finally {
      if (previousEventKit === undefined) delete process.env.AGENT_SERVER_EVENTKIT_BIN;
      else process.env.AGENT_SERVER_EVENTKIT_BIN = previousEventKit;
    }
  });

  it('composes Kimi Code with no write, command, web, or MCP effects', async () => {
    const root = createTempDir('kimi-safe-test');
    const reference = join(root, 'reference.md');
    const output = join(root, 'output.md');
    writeFileSync(reference, 'reference');
    const [clientStream, agentStream] = createStreamPair();
    const outcomes: RequestPermissionResponse[] = [];
    let configuredMcpCount = -1;
    const fakeAgent = createAcpAgent({ name: 'fake-kimi' })
      .onRequest(methods.agent.initialize, () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
      }))
      .onRequest(methods.agent.session.new, ({ params }) => {
        configuredMcpCount = params.mcpServers.length;
        return { sessionId: 'session-1' };
      })
      .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
        expect((await client.request(methods.client.fs.readTextFile, {
          sessionId: params.sessionId,
          path: reference,
        })).content).toBe('reference');
        try {
          await client.request(methods.client.fs.writeTextFile, {
            sessionId: params.sessionId,
            path: output,
            content: 'changed',
          });
        } catch {
          // Rejection is asserted by the unchanged filesystem below.
        }
        for (const toolCall of [
          { toolCallId: 'write-1', title: 'Write output', kind: 'edit' as const },
          { toolCallId: 'bash-1', title: 'Run command', kind: 'execute' as const },
          { toolCallId: 'web-1', title: 'Fetch page', kind: 'fetch' as const },
          { toolCallId: 'mcp-1', title: 'mcp__notes__create_page' },
        ]) {
          outcomes.push(await client.request(methods.client.session.requestPermission, {
            sessionId: params.sessionId,
            toolCall,
            options: [
              { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
              { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
            ],
          }));
        }
        return { stopReason: 'end_turn' };
      });
    const connection = fakeAgent.connect(agentStream);
    const safeAgent = prepareSafeTestAgent(makeAgent({
      executor: 'kimi-code',
      tools: ['Read', 'Write', 'Bash', 'WebFetch', 'mcp__notes__create_page'],
      permissions: {
        allow: ['Read', 'Write', 'Bash', 'WebFetch', 'mcp__notes__create_page'],
        deny: [],
      },
      file_access: [{ path: root, kind: 'folder', access: 'read_write' }],
      mcp_servers: { notes: { command: '/usr/bin/notes-mcp' } },
    }));

    await runKimiAcpSession(safeAgent, reporter(), clientStream, { disableMcpServers: true });
    connection.close();

    expect(configuredMcpCount).toBe(0);
    expect(outcomes).toEqual(Array.from({ length: 4 }, () => ({
      outcome: { outcome: 'selected', optionId: 'reject' },
    })));
    expect(existsSync(output)).toBe(false);
  });
});
