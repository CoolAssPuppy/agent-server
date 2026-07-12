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

  it('surfaces a failed turn', async () => {
    const { executeCodexAgent } = await import('./codex.js');
    runStreamed.mockResolvedValue({ events: streamEvents([
      { type: 'turn.failed', error: { message: 'Authentication required. Run codex login.' } },
    ]) });

    await expect(executeCodexAgent(makeAgent(), createMockReporter()))
      .rejects.toThrow('Authentication required. Run codex login.');
  });
});
