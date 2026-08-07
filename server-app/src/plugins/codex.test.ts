import { describe, expect, it, vi } from 'vitest';
import type { ThreadEvent } from '@openai/codex-sdk';
import type { Reporter } from '../execution/runner.js';
import { makeAgent } from '../test-factories.js';

const runStreamed = vi.fn();
const isolatedEventStream = vi.fn(async function* () {
  const streamed = await runStreamed();
  yield* streamed.events;
});

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

function isolatedOptions(): {
  codexExecutablePath: string;
  scopedEventStream: typeof isolatedEventStream;
} {
  return {
    codexExecutablePath: '/usr/local/bin/codex',
    scopedEventStream: isolatedEventStream,
  };
}

function lastInvocation(): Parameters<typeof isolatedEventStream>[0] {
  const invocation = isolatedEventStream.mock.calls.at(-1)?.[0];
  if (!invocation) throw new Error('Expected an isolated Codex invocation');
  return invocation;
}

function lastInvocationText(): string {
  return lastInvocation().arguments.join('\n');
}

describe('executeCodexAgent', () => {
  it('fails clearly when the app cannot find installed Codex', async () => {
    const { executeCodexAgent } = await import('./codex.js');

    await expect(executeCodexAgent(makeAgent(), createMockReporter(), {
      codexExecutablePath: undefined,
    })).rejects.toThrow(
      'Codex is not installed. Install Codex or choose another coding agent.',
    );
  });

  it('injects the bundled calendar helper with reviewed scope', async () => {
    const original = process.env.AGENT_SERVER_EVENTKIT_BIN;
    process.env.AGENT_SERVER_EVENTKIT_BIN = '/path/to/helper';
    const { executeCodexAgent } = await import('./codex.js');
    runStreamed.mockResolvedValue({ events: streamEvents([]) });

    await executeCodexAgent(makeAgent({
      calendar_access: [{ id: 'work-id', name: 'Work', access: 'read_only' }],
    }), createMockReporter(), isolatedOptions());

    expect(lastInvocationText()).toContain('command = "/path/to/helper"');
    expect(lastInvocationText()).toContain('AGENT_SERVER_NATIVE_SERVICE_GRANTS');
    expect(lastInvocationText()).toContain('work-id');
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
    }), createMockReporter(), isolatedOptions());

    expect(lastInvocationText()).toContain('complete');
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
    }), createMockReporter(), isolatedOptions());

    expect(lastInvocationText()).toContain('birthday');
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
    }), createMockReporter(), { ...isolatedOptions(), abortController });

    expect(lastInvocation().arguments).toEqual(expect.arrayContaining([
      '--ignore-user-config',
      '--model', 'gpt-5.4',
      '--sandbox', 'read-only',
      '--cd', '/tmp/project',
      '--skip-git-repo-check',
      '--config', 'approval_policy="never"',
      '--config', 'web_search="disabled"',
      '--config', 'sandbox_workspace_write.network_access=false',
    ]));
    expect(isolatedEventStream).toHaveBeenLastCalledWith(
      expect.any(Object),
      'Summarize the repo',
      abortController.signal,
    );
  });

  it('isolates every run from user config and passes exact MCP tool filters', async () => {
    const { executeCodexAgent } = await import('./codex.js');
    runStreamed.mockResolvedValue({ events: streamEvents([]) });

    await executeCodexAgent(makeAgent({
      executor: 'codex',
      mcp_servers: { notes: { command: 'notes-helper' } },
      permissions: {
        allow: [
          'mcp__notes__search',
          'mcp__notes__create_page',
          'mcp__notes__read_*',
        ],
        deny: [
          'mcp__notes__delete_page',
          'mcp__notes__admin_*',
        ],
      },
    }), createMockReporter(), isolatedOptions());

    const invocation = lastInvocation();
    expect(invocation.arguments).toContain('--ignore-user-config');
    const argumentsText = invocation.arguments.join('\n');
    expect(argumentsText).toContain('enabled_tools = ["search", "create_page"]');
    expect(argumentsText).toContain('disabled_tools = ["delete_page"]');
    expect(argumentsText).toContain('default_tools_approval_mode = "approve"');
    expect(argumentsText).not.toContain('read_*');
    expect(argumentsText).not.toContain('admin_*');
  });

  it('enables only the reviewed tools for each prepared Codex app', async () => {
    const { executeCodexAgent } = await import('./codex.js');
    const { attachRuntimeCodexAppPolicies } = await import('../connections/runtime-policy.js');
    runStreamed.mockResolvedValue({ events: streamEvents([]) });
    const agent = makeAgent({ executor: 'codex' });
    attachRuntimeCodexAppPolicies(agent, {
      'asdk_app_notion': {
        availableTools: [
          'notion.search', 'notion.notion-create-pages', 'notion.notion-update-page',
        ],
        tools: {
          'notion.search': { effect: 'read' },
          'notion.notion-create-pages': { effect: 'write' },
        },
      },
    });

    await executeCodexAgent(agent, createMockReporter(), isolatedOptions());

    const argumentsText = lastInvocationText();
    expect(argumentsText).toContain('features={apps = true}');
    expect(argumentsText).toContain('_default = {enabled = false');
    expect(argumentsText).toContain('asdk_app_notion = {enabled = true');
    expect(argumentsText).toContain('default_tools_enabled = true');
    expect(argumentsText).toContain('"notion.search" = {enabled = true, approval_mode = "approve"}');
    expect(argumentsText).toContain('"notion.notion-create-pages" = {enabled = true, approval_mode = "approve"}');
    expect(argumentsText).toContain('"notion.notion-update-page" = {enabled = false}');
  });

  it('runs scoped file access through the exact Codex permission profile', async () => {
    const { executeCodexAgent } = await import('./codex.js');
    runStreamed.mockResolvedValue({ events: streamEvents([]) });
    const scopedEventStream = vi.fn(() => streamEvents([]));

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
      }), createMockReporter(), isolatedOptions());

      expect(lastInvocationText()).toContain('openai_base_url="https://api.moonshot.ai/v1"');
      expect(lastInvocation().environment.CODEX_API_KEY).toBe('sk-moonshot-123');
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

    await executeCodexAgent(makeAgent({ executor: 'codex' }), createMockReporter(), isolatedOptions());

    expect(lastInvocationText()).not.toContain('openai_base_url=');
    expect(lastInvocation().environment.CODEX_API_KEY).toBeUndefined();
  });

  it('explicitly disables global MCP servers for a safe test', async () => {
    const { executeCodexAgent } = await import('./codex.js');
    runStreamed.mockResolvedValue({ events: streamEvents([]) });

    await executeCodexAgent(makeAgent({ executor: 'codex' }), createMockReporter(), {
      ...isolatedOptions(),
      disableMcpServers: true,
    });

    expect(lastInvocationText()).toContain('mcp_servers={}');
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

    const result = await executeCodexAgent(makeAgent(), reporter, isolatedOptions());

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

    const result = await executeCodexAgent(makeAgent(), createMockReporter(), isolatedOptions());

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
      await executeCodexAgent(makeAgent(), createMockReporter(), isolatedOptions());
      const environment = lastInvocation().environment;
      expect(environment.OPENAI_API_KEY).toBeUndefined();
      expect(environment.DATABASE_URL).toBeUndefined();
      expect(environment.PATH).toBe(process.env.PATH);
      expect(environment.HOME).toBe(process.env.HOME);
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
      await executeCodexAgent(resolved, createMockReporter(), isolatedOptions());

      expect(lastInvocation().environment.NOTES_TOKEN).toBeUndefined();
      expect(lastInvocationText()).toContain('mcp-credential-launcher.js');
      expect(lastInvocationText()).toContain('notes-helper');
      expect(lastInvocationText()).not.toContain('local-secret');
      expect(Object.values(lastInvocation().environment)).not.toContain('local-secret');
      expect(Object.values(lastInvocation().credentialBroker?.grants ?? {}).flatMap(Object.values))
        .toContain('local-secret');
    } finally {
      if (previous === undefined) delete process.env.NOTES_TOKEN;
      else process.env.NOTES_TOKEN = previous;
    }
  });

  it('routes a portable HTTP connection through the local policy relay', async () => {
    const { executeCodexAgent } = await import('./codex.js');
    const { resolveAgentConnectionBindings } = await import('../connections/runtime-resolution.js');
    const { attachRuntimeConnectionPolicies } = await import('../connections/runtime-policy.js');
    const previous = process.env.NOTES_TOKEN;
    process.env.NOTES_TOKEN = 'http-local-secret';
    runStreamed.mockResolvedValue({ events: streamEvents([]) });
    try {
      const profile = {
        schema_version: 1 as const,
        id: '11111111-1111-4111-8111-111111111111',
        label: 'Notes',
        adapter: { id: 'notes.http-mcp', version: 1 },
        runtime_name: 'notes',
        credentials: [{
          id: '22222222-2222-4222-8222-222222222222',
          label: 'Token', environment_variable: 'NOTES_TOKEN', secret: true,
        }],
        transport: {
          kind: 'mcp_http' as const,
          url: 'https://notes.example/mcp',
          headers: [{
            name: 'Authorization',
            credential_id: '22222222-2222-4222-8222-222222222222',
            prefix: 'Bearer ',
          }],
        },
        created_at: '2026-07-19T18:00:00.000Z',
        updated_at: '2026-07-19T18:00:00.000Z',
      };
      const resolved = resolveAgentConnectionBindings(makeAgent({
        connection_bindings: { notes: profile.id },
      }), [profile]);
      attachRuntimeConnectionPolicies(resolved, {
        notes: {
          allowedTools: ['create_note'],
          argumentConstraints: { create_note: { folder_id: ['work-folder'] } },
        },
      });

      await executeCodexAgent(resolved, createMockReporter(), isolatedOptions());

      expect(lastInvocationText()).toContain('mcp-policy-relay.js');
      expect(lastInvocationText()).toContain('create_note');
      expect(lastInvocationText()).toContain('work-folder');
      expect(lastInvocationText()).not.toContain('http-local-secret');
      expect(Object.values(lastInvocation().credentialBroker?.grants ?? {}).flatMap(Object.values))
        .toContain('Bearer http-local-secret');
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

    await expect(executeCodexAgent(makeAgent(), createMockReporter(), isolatedOptions()))
      .rejects.toThrow('Authentication required. Run codex login.');
  });
});
