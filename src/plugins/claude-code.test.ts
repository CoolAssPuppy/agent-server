import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Reporter } from '../execution/runner.js';
import type { AgentConfig } from '../agents/config.js';

function createMockReporter(): Reporter {
  return {
    start: vi.fn(),
    progress: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    stop: vi.fn(),
  };
}

function createAgentConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    description: 'A test agent',
    schedule: '*/5 * * * *',
    prompt: 'Do something useful',
    tools: [],
    max_turns: 10,
    enabled: true,
    ...overrides,
  };
}

const mockQuery = vi.fn();

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

beforeEach(() => {
  mockQuery.mockReset();
});

describe('executeAgent with Agent SDK', () => {
  it('returns execution result from a successful SDK run', async () => {
    const { executeAgent } = await import('./claude-code.js');

    mockQuery.mockReturnValue(createAsyncGenerator([
      createAssistantMessage('I completed the task.'),
      createResultSuccess({ result: 'Task done', num_turns: 3 }),
    ]));

    const reporter = createMockReporter();
    const result = await executeAgent(createAgentConfig(), reporter);

    expect(result.summary).toBe('Task done');
    expect(result.turnCount).toBe(3);
  });

  it('passes prompt and options to the SDK query function', async () => {
    const { executeAgent } = await import('./claude-code.js');

    mockQuery.mockReturnValue(createAsyncGenerator([
      createResultSuccess({ result: 'Done', num_turns: 1 }),
    ]));

    const reporter = createMockReporter();
    const agent = createAgentConfig({
      prompt: 'Write tests',
      max_turns: 5,
      tools: ['Read', 'Write', 'Bash'],
      working_directory: '/tmp/test-dir',
    });

    await executeAgent(agent, reporter);

    expect(mockQuery).toHaveBeenCalledWith({
      prompt: 'Write tests',
      options: expect.objectContaining({
        maxTurns: 5,
        allowedTools: ['Read', 'Write', 'Bash'],
        cwd: '/tmp/test-dir',
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      }),
    });
  });

  it('does not pass allowedTools when tools array is empty', async () => {
    const { executeAgent } = await import('./claude-code.js');

    mockQuery.mockReturnValue(createAsyncGenerator([
      createResultSuccess({ result: 'Done', num_turns: 1 }),
    ]));

    const reporter = createMockReporter();
    await executeAgent(createAgentConfig({ tools: [] }), reporter);

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options.allowedTools).toBeUndefined();
  });

  it('extracts tool metadata from assistant messages', async () => {
    const { executeAgent } = await import('./claude-code.js');

    mockQuery.mockReturnValue(createAsyncGenerator([
      createAssistantMessageWithTools([
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/src/index.ts' } },
        { type: 'tool_use', id: 't2', name: 'Write', input: { file_path: '/src/output.ts' } },
      ]),
      createAssistantMessageWithTools([
        { type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'npm test' } },
      ]),
      createResultSuccess({ result: 'All done', num_turns: 2 }),
    ]));

    const reporter = createMockReporter();
    const result = await executeAgent(createAgentConfig(), reporter);

    expect(result.toolsUsed).toEqual(expect.arrayContaining(['Read', 'Write', 'Bash']));
    expect(result.filesRead).toContain('/src/index.ts');
    expect(result.filesWritten).toContain('/src/output.ts');
    expect(result.commandsRun).toContain('npm test');
  });

  it('reports progress for each assistant turn', async () => {
    const { executeAgent } = await import('./claude-code.js');

    mockQuery.mockReturnValue(createAsyncGenerator([
      createAssistantMessage('Working on step 1'),
      createAssistantMessage('Working on step 2'),
      createResultSuccess({ result: 'Done', num_turns: 2 }),
    ]));

    const reporter = createMockReporter();
    await executeAgent(createAgentConfig(), reporter);

    expect(reporter.progress).toHaveBeenCalledTimes(2);
    expect(reporter.progress).toHaveBeenCalledWith(
      'Working on step 1',
      expect.objectContaining({ turns_completed: 1 }),
    );
    expect(reporter.progress).toHaveBeenCalledWith(
      'Working on step 2',
      expect.objectContaining({ turns_completed: 2 }),
    );
  });

  it('throws on SDK error result', async () => {
    const { executeAgent } = await import('./claude-code.js');

    mockQuery.mockReturnValue(createAsyncGenerator([
      createResultError({
        subtype: 'error_during_execution',
        errors: ['Something went wrong'],
        num_turns: 1,
      }),
    ]));

    const reporter = createMockReporter();
    await expect(executeAgent(createAgentConfig(), reporter))
      .rejects.toThrow('Something went wrong');
  });

  it('parses interaction blocks from final assistant text', async () => {
    const { executeAgent } = await import('./claude-code.js');

    const interactionJson = JSON.stringify({
      message: 'Should I proceed?',
      options: [
        { label: 'Yes', value: 'yes' },
        { label: 'No', value: 'no' },
      ],
    });

    mockQuery.mockReturnValue(createAsyncGenerator([
      createAssistantMessage(`Here is the result.\n\n\`\`\`interaction\n${interactionJson}\n\`\`\``),
      createResultSuccess({ result: 'Done', num_turns: 1 }),
    ]));

    const reporter = createMockReporter();
    const result = await executeAgent(createAgentConfig(), reporter);

    expect(result.interaction).toBeDefined();
    expect(result.interaction?.message).toBe('Should I proceed?');
    expect(result.interaction?.options).toHaveLength(2);
  });

  it('expands ~ in working_directory', async () => {
    const { executeAgent } = await import('./claude-code.js');

    mockQuery.mockReturnValue(createAsyncGenerator([
      createResultSuccess({ result: 'Done', num_turns: 1 }),
    ]));

    const reporter = createMockReporter();
    const agent = createAgentConfig({ working_directory: '~/projects/test' });

    await executeAgent(agent, reporter);

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options.cwd).not.toContain('~');
    expect(callArgs.options.cwd).toMatch(/\/projects\/test$/);
  });

  it('passes disallowed_tools to SDK options', async () => {
    const { executeAgent } = await import('./claude-code.js');

    mockQuery.mockReturnValue(createAsyncGenerator([
      createResultSuccess({ result: 'Done', num_turns: 1 }),
    ]));

    const reporter = createMockReporter();
    const agent = createAgentConfig({ disallowed_tools: ['Bash', 'Write'] });

    await executeAgent(agent, reporter);

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options.disallowedTools).toEqual(['Bash', 'Write']);
  });

  it('does not pass disallowedTools when array is empty', async () => {
    const { executeAgent } = await import('./claude-code.js');

    mockQuery.mockReturnValue(createAsyncGenerator([
      createResultSuccess({ result: 'Done', num_turns: 1 }),
    ]));

    const reporter = createMockReporter();
    const agent = createAgentConfig({ disallowed_tools: [] });

    await executeAgent(agent, reporter);

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options.disallowedTools).toBeUndefined();
  });

  it('uses custom permission_mode when specified', async () => {
    const { executeAgent } = await import('./claude-code.js');

    mockQuery.mockReturnValue(createAsyncGenerator([
      createResultSuccess({ result: 'Done', num_turns: 1 }),
    ]));

    const reporter = createMockReporter();
    const agent = createAgentConfig({ permission_mode: 'acceptEdits' });

    await executeAgent(agent, reporter);

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options.permissionMode).toBe('acceptEdits');
    expect(callArgs.options.allowDangerouslySkipPermissions).toBeUndefined();
  });

  it('defaults cwd to HOME when no working_directory specified', async () => {
    const { executeAgent } = await import('./claude-code.js');

    mockQuery.mockReturnValue(createAsyncGenerator([
      createResultSuccess({ result: 'Done', num_turns: 1 }),
    ]));

    const reporter = createMockReporter();
    await executeAgent(createAgentConfig(), reporter);

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options.cwd).toBe(process.env.HOME ?? process.cwd());
  });

  it('returns default summary when result text is empty', async () => {
    const { executeAgent } = await import('./claude-code.js');

    mockQuery.mockReturnValue(createAsyncGenerator([
      createResultSuccess({ result: '', num_turns: 1 }),
    ]));

    const reporter = createMockReporter();
    const result = await executeAgent(createAgentConfig(), reporter);

    expect(result.summary).toBe('Agent completed');
  });
});

function createAsyncGenerator<T>(items: T[]): AsyncGenerator<T, void> {
  return (async function* () {
    for (const item of items) {
      yield item;
    }
  })() as AsyncGenerator<T, void>;
}

function createAssistantMessage(text: string) {
  return {
    type: 'assistant' as const,
    message: {
      content: [{ type: 'text' as const, text }],
    },
    parent_tool_use_id: null,
    uuid: '00000000-0000-0000-0000-000000000001' as `${string}-${string}-${string}-${string}-${string}`,
    session_id: 'session-1',
  };
}

function createAssistantMessageWithTools(
  blocks: Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string }>,
) {
  return {
    type: 'assistant' as const,
    message: {
      content: blocks,
    },
    parent_tool_use_id: null,
    uuid: '00000000-0000-0000-0000-000000000002' as `${string}-${string}-${string}-${string}-${string}`,
    session_id: 'session-1',
  };
}

function createResultSuccess(overrides: {
  result: string;
  num_turns: number;
}) {
  return {
    type: 'result' as const,
    subtype: 'success' as const,
    duration_ms: 1000,
    duration_api_ms: 800,
    is_error: false,
    num_turns: overrides.num_turns,
    result: overrides.result,
    stop_reason: 'end_turn',
    total_cost_usd: 0.05,
    usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use_input_tokens: 0 },
    modelUsage: {},
    permission_denials: [],
    uuid: '00000000-0000-0000-0000-000000000003' as `${string}-${string}-${string}-${string}-${string}`,
    session_id: 'session-1',
  };
}

function createResultError(overrides: {
  subtype: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries';
  errors: string[];
  num_turns: number;
}) {
  return {
    type: 'result' as const,
    subtype: overrides.subtype,
    duration_ms: 1000,
    duration_api_ms: 800,
    is_error: true,
    num_turns: overrides.num_turns,
    stop_reason: null,
    total_cost_usd: 0.02,
    usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use_input_tokens: 0 },
    modelUsage: {},
    permission_denials: [],
    errors: overrides.errors,
    uuid: '00000000-0000-0000-0000-000000000004' as `${string}-${string}-${string}-${string}-${string}`,
    session_id: 'session-1',
  };
}
