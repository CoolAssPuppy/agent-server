import { describe, expect, it, vi } from 'vitest';
import type { ThreadEvent } from '@openai/codex-sdk';
import type { Reporter } from '../execution/runner.js';
import { makeAgent } from '../test-factories.js';

const runStreamed = vi.fn();
const startThread = vi.fn(() => ({ runStreamed }));
const codexConstructor = vi.fn(() => ({ startThread }));

vi.mock('@openai/codex-sdk', () => ({
  Codex: function Codex(options: unknown) {
    return codexConstructor(options);
  },
}));

function createMockReporter(): Reporter {
  return {
    start: vi.fn(),
    progress: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    stop: vi.fn(),
  };
}

async function* streamEvents(events: ThreadEvent[]): AsyncGenerator<ThreadEvent> {
  for (const event of events) yield event;
}

describe('executeCodexAgent', () => {
  it('fails clearly when the app cannot find installed Codex', async () => {
    const { executeCodexAgent } = await import('./codex.js');

    await expect(executeCodexAgent(makeAgent(), createMockReporter(), {
      codexExecutablePath: undefined,
    })).rejects.toThrow(
      'Codex is not installed. Install Codex or choose another coding agent.',
    );
    expect(codexConstructor).not.toHaveBeenCalled();
  });

  it('injects the bundled calendar helper with reviewed scope', async () => {
    const original = process.env.AGENT_SERVER_EVENTKIT_BIN;
    process.env.AGENT_SERVER_EVENTKIT_BIN = '/path/to/helper';
    const { executeCodexAgent } = await import('./codex.js');
    runStreamed.mockResolvedValue({ events: streamEvents([]) });

    await executeCodexAgent(makeAgent({
      calendar_access: [{ id: 'work-id', name: 'Work', access: 'read_only' }],
    }), createMockReporter());

    expect(codexConstructor).toHaveBeenLastCalledWith(expect.objectContaining({
      config: {
        mcp_servers: {
          eventkit: expect.objectContaining({
            command: '/path/to/helper',
            env: {
              AGENT_SERVER_NATIVE_SERVICE_GRANTS: '{"version":1,"services":{"calendar":{"resources":[{"id":"work-id","name":"Work","actions":["read"]}]}}}',
            },
          }),
        },
      },
    }));
    if (original === undefined) delete process.env.AGENT_SERVER_EVENTKIT_BIN;
    else process.env.AGENT_SERVER_EVENTKIT_BIN = original;
  });

  it('injects exact Reminder list actions into the bundled helper', async () => {
    const original = process.env.AGENT_SERVER_EVENTKIT_BIN;
    process.env.AGENT_SERVER_EVENTKIT_BIN = '/path/to/helper';
    const { executeCodexAgent } = await import('./codex.js');
    runStreamed.mockResolvedValue({ events: streamEvents([]) });

    await executeCodexAgent(makeAgent({
      native_services: {
        reminders: { resources: [{ id: 'list-id', name: 'Personal', actions: ['read', 'complete'] }] },
      },
    }), createMockReporter());

    expect(codexConstructor).toHaveBeenLastCalledWith(expect.objectContaining({
      config: { mcp_servers: { eventkit: expect.objectContaining({
        env: { AGENT_SERVER_NATIVE_SERVICE_GRANTS: expect.stringContaining('"complete"') },
      }) } },
    }));
    if (original === undefined) delete process.env.AGENT_SERVER_EVENTKIT_BIN;
    else process.env.AGENT_SERVER_EVENTKIT_BIN = original;
  });

  it('injects exact Contacts fields into the bundled helper', async () => {
    const original = process.env.AGENT_SERVER_EVENTKIT_BIN;
    process.env.AGENT_SERVER_EVENTKIT_BIN = '/path/to/helper';
    const { executeCodexAgent } = await import('./codex.js');
    runStreamed.mockResolvedValue({ events: streamEvents([]) });

    await executeCodexAgent(makeAgent({
      native_services: {
        contacts: {
          resources: [{ id: 'family', name: 'Family', actions: ['read'], fields: ['name', 'birthday'] }],
        },
      },
    }), createMockReporter());

    expect(codexConstructor).toHaveBeenLastCalledWith(expect.objectContaining({
      config: { mcp_servers: { eventkit: expect.objectContaining({
        env: { AGENT_SERVER_NATIVE_SERVICE_GRANTS: expect.stringContaining('"birthday"') },
      }) } },
    }));
    if (original === undefined) delete process.env.AGENT_SERVER_EVENTKIT_BIN;
    else process.env.AGENT_SERVER_EVENTKIT_BIN = original;
  });

  it('runs a streamed Codex thread with the agent settings', async () => {
    const { executeCodexAgent } = await import('./codex.js');
    runStreamed.mockResolvedValue({ events: streamEvents([
      { type: 'thread.started', thread_id: 'thread-1' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'message-1', type: 'agent_message', text: 'Done' } },
      {
        type: 'turn.completed',
        usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 5, reasoning_output_tokens: 1 },
      },
    ]) });
    const abortController = new AbortController();

    await executeCodexAgent(makeAgent({
      prompt: 'Summarize the repo',
      working_directory: '/tmp/project',
      executor: 'codex',
      model: 'gpt-5.4',
      codex_sandbox: 'read-only',
    }), createMockReporter(), { abortController });

    expect(startThread).toHaveBeenCalledWith(expect.objectContaining({
      workingDirectory: '/tmp/project',
      skipGitRepoCheck: true,
      model: 'gpt-5.4',
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      networkAccessEnabled: false,
      webSearchMode: 'disabled',
    }));
    expect(runStreamed).toHaveBeenCalledWith('Summarize the repo', { signal: abortController.signal });
  });

  it('runs scoped file access through the exact Codex permission profile', async () => {
    const { executeCodexAgent } = await import('./codex.js');
    runStreamed.mockResolvedValue({ events: streamEvents([]) });
    const scopedEventStream = vi.fn(() => streamEvents([]));
    const sdkCallsBefore = startThread.mock.calls.length;

    await executeCodexAgent(makeAgent({
      executor: 'codex',
      working_directory: '/Users/test/Book',
      file_access: [
        { path: '/Users/test/Book/manuscript.docx', kind: 'file', access: 'read_only' },
        { path: '/Users/test/Reference', kind: 'folder', access: 'read_only' },
        { path: '/Users/test/Output', kind: 'folder', access: 'read_write' },
      ],
      codex_sandbox: 'workspace-write',
    }), createMockReporter(), {
      codexExecutablePath: '/usr/local/bin/codex',
      scopedEventStream,
    });

    expect(startThread).toHaveBeenCalledTimes(sdkCallsBefore);
    expect(scopedEventStream).toHaveBeenCalledWith(
      expect.objectContaining({
        arguments: expect.arrayContaining([
          '--ignore-user-config',
          '--config',
          expect.stringContaining('permissions.agent-server.filesystem='),
        ]),
      }),
      expect.any(String),
      undefined,
    );
  });

  it('points Codex at a custom provider, resolving the api key from env', async () => {
    const { executeCodexAgent } = await import('./codex.js');
    const previous = process.env.MOONSHOT_API_KEY;
    process.env.MOONSHOT_API_KEY = 'sk-moonshot-123';
    try {
      runStreamed.mockResolvedValue({ events: streamEvents([
        { type: 'thread.started', thread_id: 'thread-1' },
        { type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'ok' } },
        { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } },
      ]) });

      await executeCodexAgent(makeAgent({
        executor: 'codex',
        model: 'kimi-k3',
        provider: { base_url: 'https://api.moonshot.ai/v1', api_key: '${MOONSHOT_API_KEY}' },
      }), createMockReporter());

      expect(codexConstructor).toHaveBeenCalledWith(expect.objectContaining({
        baseUrl: 'https://api.moonshot.ai/v1',
        apiKey: 'sk-moonshot-123',
      }));
    } finally {
      if (previous === undefined) delete process.env.MOONSHOT_API_KEY;
      else process.env.MOONSHOT_API_KEY = previous;
    }
  });

  it('omits provider options when the agent has no provider', async () => {
    const { executeCodexAgent } = await import('./codex.js');
    runStreamed.mockResolvedValue({ events: streamEvents([
      { type: 'thread.started', thread_id: 'thread-1' },
      { type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'ok' } },
      { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } },
    ]) });

    await executeCodexAgent(makeAgent({ executor: 'codex' }), createMockReporter());

    const options = codexConstructor.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(options.baseUrl).toBeUndefined();
    expect(options.apiKey).toBeUndefined();
  });

  it('explicitly disables global MCP servers for a safe test', async () => {
    const { executeCodexAgent } = await import('./codex.js');
    runStreamed.mockResolvedValue({ events: streamEvents([]) });

    await executeCodexAgent(makeAgent({ executor: 'codex' }), createMockReporter(), {
      disableMcpServers: true,
    });

    expect(codexConstructor.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      config: { mcp_servers: {} },
    }));
  });

  it('maps Codex events into provider-neutral execution telemetry', async () => {
    const { executeCodexAgent } = await import('./codex.js');
    const reporter = createMockReporter();
    runStreamed.mockResolvedValue({ events: streamEvents([
      { type: 'thread.started', thread_id: 'thread-1' },
      { type: 'turn.started' },
      {
        type: 'item.completed',
        item: { id: 'command-1', type: 'command_execution', command: 'pnpm test', aggregated_output: '', exit_code: 0, status: 'completed' },
      },
      {
        type: 'item.completed',
        item: { id: 'file-1', type: 'file_change', changes: [{ path: 'src/index.ts', kind: 'update' }], status: 'completed' },
      },
      {
        type: 'item.completed',
        item: { id: 'mcp-1', type: 'mcp_tool_call', server: 'github', tool: 'list_issues', arguments: {}, status: 'completed' },
      },
      { type: 'item.completed', item: { id: 'message-1', type: 'agent_message', text: 'Finished' } },
      {
        type: 'turn.completed',
        usage: { input_tokens: 20, cached_input_tokens: 3, output_tokens: 7, reasoning_output_tokens: 2 },
      },
    ]) });

    const result = await executeCodexAgent(makeAgent(), reporter);

    expect(result.summary).toBe('Finished');
    expect(result.turnCount).toBe(1);
    expect(result.commandsRun).toEqual(['pnpm test']);
    expect(result.filesWritten).toEqual(['src/index.ts']);
    expect(result.toolsUsed).toEqual(expect.arrayContaining(['command_execution', 'file_change', 'mcp__github__list_issues']));
    expect(result.toolCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'command_execution', status: 'succeeded' }),
      expect.objectContaining({ name: 'mcp__github__list_issues', status: 'succeeded' }),
    ]));
    expect(result.usage).toEqual(expect.objectContaining({
      input_tokens: 20,
      output_tokens: 7,
      cache_read_input_tokens: 3,
      reasoning_output_tokens: 2,
      thread_id: 'thread-1',
      cost_source: 'subscription-not-reported',
    }));
    expect(reporter.progress).toHaveBeenCalled();
  });

  it('marks a failed Codex service call for output validation', async () => {
    const { executeCodexAgent } = await import('./codex.js');
    runStreamed.mockResolvedValue({ events: streamEvents([
      {
        type: 'item.completed',
        item: {
          id: 'mcp-1',
          type: 'mcp_tool_call',
          server: 'notion',
          tool: 'create_page',
          arguments: {},
          status: 'failed',
          error: { message: 'Request rejected' },
        },
      },
    ]) });

    const result = await executeCodexAgent(makeAgent(), createMockReporter());

    expect(result.toolCalls).toEqual([
      expect.objectContaining({ name: 'mcp__notion__create_page', status: 'failed' }),
    ]);
  });

  it('passes only safe process variables to the Codex runtime', async () => {
    const { executeCodexAgent } = await import('./codex.js');
    const previous = process.env.OPENAI_API_KEY;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.OPENAI_API_KEY = 'must-not-be-used';
    process.env.DATABASE_URL = 'postgres://secret';
    runStreamed.mockResolvedValue({ events: streamEvents([]) });

    try {
      await executeCodexAgent(makeAgent(), createMockReporter());
      const options = codexConstructor.mock.calls.at(-1)?.[0] as { env: Record<string, string> };
      expect(options.env.OPENAI_API_KEY).toBeUndefined();
      expect(options.env.DATABASE_URL).toBeUndefined();
      expect(options.env.PATH).toBe(process.env.PATH);
      expect(options.env.HOME).toBe(process.env.HOME);
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });

  it('rejects secret-bearing agent MCP configuration', async () => {
    const { executeCodexAgent } = await import('./codex.js');
    process.env.NOTION_TOKEN = 'subscription-token';
    runStreamed.mockResolvedValue({ events: streamEvents([]) });

    const execution = executeCodexAgent(makeAgent({
      mcp_servers: {
        notion: { command: 'npx', args: ['notion-mcp'], env: { TOKEN: '${NOTION_TOKEN}' } },
      },
    }), createMockReporter());

    await expect(execution).rejects.toThrow('Codex MCP server "notion" contains credentials');
    delete process.env.NOTION_TOKEN;
  });

  it('passes reviewed saved-connection credentials to Codex without inheriting them globally', async () => {
    const { executeCodexAgent } = await import('./codex.js');
    const { resolveAgentConnectionBindings } = await import('../connections/runtime-resolution.js');
    const previous = process.env.NOTES_TOKEN;
    process.env.NOTES_TOKEN = 'local-secret';
    runStreamed.mockResolvedValue({ events: streamEvents([]) });
    try {
      const profile = {
        schema_version: 1 as const,
        id: '11111111-1111-4111-8111-111111111111',
        label: 'Notes',
        adapter: { id: 'generic.mcp', version: 1 },
        runtime_name: 'notes',
        credentials: [{
          id: '22222222-2222-4222-8222-222222222222',
          label: 'Token', environment_variable: 'NOTES_TOKEN', secret: true,
        }],
        transport: {
          kind: 'mcp_stdio' as const,
          command: 'notes-helper', args: [],
          environment: { TOKEN: '22222222-2222-4222-8222-222222222222' },
        },
        created_at: '2026-07-19T18:00:00.000Z',
        updated_at: '2026-07-19T18:00:00.000Z',
      };
      const resolved = resolveAgentConnectionBindings(makeAgent({
        connection_bindings: { notes: profile.id },
      }), [profile]);
      await executeCodexAgent(resolved, createMockReporter());

      expect(codexConstructor).toHaveBeenLastCalledWith(expect.objectContaining({
        env: expect.not.objectContaining({ NOTES_TOKEN: 'local-secret' }),
        config: { mcp_servers: { notes: expect.objectContaining({
          command: 'notes-helper', env: { TOKEN: 'local-secret' },
        }) } },
      }));
    } finally {
      if (previous === undefined) delete process.env.NOTES_TOKEN;
      else process.env.NOTES_TOKEN = previous;
    }
  });

  it('surfaces a failed turn', async () => {
    const { executeCodexAgent } = await import('./codex.js');
    runStreamed.mockResolvedValue({ events: streamEvents([
      { type: 'turn.failed', error: { message: 'Authentication required. Run codex login.' } },
    ]) });

    await expect(executeCodexAgent(makeAgent(), createMockReporter()))
      .rejects.toThrow('Authentication required. Run codex login.');
  });
});
