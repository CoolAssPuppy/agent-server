import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { Reporter } from '../execution/runner.js';
import type { AgentConfig } from '../agents/config.js';
import type { SseEventBus } from '../execution/decision-handler.js';

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

const mockMcpServerStatus = vi.fn();
const mockReconnectMcpServer = vi.fn();
const mockQuery = vi.fn();

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

beforeEach(() => {
  mockQuery.mockReset();
  mockMcpServerStatus.mockReset();
  mockReconnectMcpServer.mockReset();
  mockMcpServerStatus.mockResolvedValue([]);
  mockReconnectMcpServer.mockResolvedValue(undefined);
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

  it('passes canUseTool callback when permissions are defined', async () => {
    const { executeAgent } = await import('./claude-code.js');

    mockQuery.mockReturnValue(createAsyncGenerator([
      createResultSuccess({ result: 'Done', num_turns: 1 }),
    ]));

    const reporter = createMockReporter();
    const agent = createAgentConfig({
      permissions: { allow: ['Read', 'Glob'], deny: ['Bash'] },
    });

    await executeAgent(agent, reporter);

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options.canUseTool).toBeTypeOf('function');
  });

  it('does not set canUseTool when permissions are undefined', async () => {
    const { executeAgent } = await import('./claude-code.js');

    mockQuery.mockReturnValue(createAsyncGenerator([
      createResultSuccess({ result: 'Done', num_turns: 1 }),
    ]));

    const reporter = createMockReporter();
    await executeAgent(createAgentConfig(), reporter);

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options.canUseTool).toBeUndefined();
  });

  it('canUseTool callback allows permitted tools and denies others', async () => {
    const { executeAgent } = await import('./claude-code.js');

    mockQuery.mockReturnValue(createAsyncGenerator([
      createResultSuccess({ result: 'Done', num_turns: 1 }),
    ]));

    const reporter = createMockReporter();
    const agent = createAgentConfig({
      permissions: { allow: ['Read', 'Write'], deny: ['Bash'] },
    });

    await executeAgent(agent, reporter);

    const canUseTool = mockQuery.mock.calls[0][0].options.canUseTool;
    const opts = { signal: new AbortController().signal, toolUseID: 't1' };

    const allowed = await canUseTool('Read', {}, opts);
    expect(allowed.behavior).toBe('allow');

    const denied = await canUseTool('Bash', {}, opts);
    expect(denied.behavior).toBe('deny');

    const unlisted = await canUseTool('Edit', {}, opts);
    expect(unlisted.behavior).toBe('deny');
  });

  it('pauses and resumes when assistant emits a decision block', async () => {
    const { executeAgent } = await import('./claude-code.js');
    const bus = new EventEmitter() as SseEventBus;

    const decisionJson = JSON.stringify({
      type: 'approve',
      title: 'Approve?',
      approve_label: 'Yes',
    });

    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ decision_id: 'dec-xyz' }),
    });

    let queryCallCount = 0;
    mockQuery.mockImplementation(() => {
      queryCallCount++;
      if (queryCallCount === 1) {
        return createAsyncGenerator([
          createAssistantMessage(`I need approval.\n\n\`\`\`decision\n${decisionJson}\n\`\`\``),
        ]);
      }
      return createAsyncGenerator([
        createAssistantMessage('Proceeding with purchase.'),
        createResultSuccess({ result: 'Done', num_turns: 2 }),
      ]);
    });

    const reporter = createMockReporter();
    const resultPromise = executeAgent(createAgentConfig(), reporter, {
      decisionContext: {
        runId: 'run-abc',
        panelUrl: 'https://panel.example',
        panelApiKey: 'k',
        eventBus: bus,
        fetch: fetchFn,
      },
    });

    // Resolve the decision after the first turn is observed.
    setTimeout(() => {
      bus.emit('decision_resolved', {
        id: 1,
        type: 'decision_resolved',
        decision_id: 'dec-xyz',
        task_run_id: 'run-abc',
        resolution: { action_id: 'approve' },
      });
    }, 20);

    const result = await resultPromise;
    expect(result.summary).toBe('Done');
    expect(fetchFn).toHaveBeenCalledOnce();
    const postBody = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(postBody.state).toBe('input_required');
    expect(postBody.decision.title).toBe('Approve?');
    expect(queryCallCount).toBe(2);

    const resumedPrompt = mockQuery.mock.calls[1][0].prompt as string;
    expect(resumedPrompt).toContain('User approved: Yes.');
  });

  it('fails the run when a decision times out', async () => {
    const { executeAgent } = await import('./claude-code.js');
    const bus = new EventEmitter() as SseEventBus;

    const decisionJson = JSON.stringify({
      type: 'approve',
      title: 'Approve?',
      due_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    });

    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ decision_id: 'dec-t' }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    mockQuery.mockReturnValue(createAsyncGenerator([
      createAssistantMessage(`Need approval.\n\n\`\`\`decision\n${decisionJson}\n\`\`\``),
    ]));

    const reporter = createMockReporter();

    await expect(
      executeAgent(createAgentConfig(), reporter, {
        decisionContext: {
          runId: 'run-t',
          panelUrl: 'https://p',
          panelApiKey: 'k',
          eventBus: bus,
          fetch: fetchFn,
        },
      }),
    ).rejects.toThrow('Decision timed out');

    expect(fetchFn).toHaveBeenCalledTimes(2);
    const failedBody = JSON.parse(fetchFn.mock.calls[1][1].body);
    expect(failedBody.state).toBe('failed');
  });

  it('ignores decision blocks when no decisionContext is provided (backward compat)', async () => {
    const { executeAgent } = await import('./claude-code.js');

    const decisionJson = JSON.stringify({
      type: 'approve',
      title: 'Approve?',
    });

    mockQuery.mockReturnValue(createAsyncGenerator([
      createAssistantMessage(`With decision block.\n\n\`\`\`decision\n${decisionJson}\n\`\`\``),
      createResultSuccess({ result: 'Done', num_turns: 1 }),
    ]));

    const reporter = createMockReporter();
    const result = await executeAgent(createAgentConfig(), reporter);
    expect(result.summary).toBe('Done');
  });

  it('captures final usage, cost, model, stop_reason, and durations from the result message', async () => {
    const { executeAgent } = await import('./claude-code.js');

    mockQuery.mockReturnValue(createAsyncGenerator([
      createAssistantMessageFull({
        text: 'working',
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }),
      createResultSuccess({
        result: 'All done',
        num_turns: 2,
        stop_reason: 'end_turn',
        total_cost_usd: 0.0123,
        usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 3, cache_read_input_tokens: 7, server_tool_use_input_tokens: 0 },
        modelUsage: { 'claude-sonnet-4-6': { inputTokens: 100, outputTokens: 50 } },
        duration_ms: 1234,
        duration_api_ms: 900,
      }),
    ]));

    const reporter = createMockReporter();
    const result = await executeAgent(createAgentConfig(), reporter);

    expect(result.usage.input_tokens).toBe(100);
    expect(result.usage.output_tokens).toBe(50);
    expect(result.usage.total_tokens).toBe(150);
    expect(result.usage.estimated_cost_usd).toBeCloseTo(0.0123, 6);
    expect(result.usage.cache_read_input_tokens).toBe(7);
    expect(result.usage.cache_creation_input_tokens).toBe(3);
    expect(result.usage.stop_reason).toBe('end_turn');
    expect(result.usage.duration_ms).toBe(1234);
    expect(result.usage.duration_api_ms).toBe(900);
    expect(result.model).toBe('claude-sonnet-4-6');
  });

  it('sums usage across multiple decision-resume segments', async () => {
    const { executeAgent } = await import('./claude-code.js');
    const bus = new EventEmitter() as SseEventBus;

    const decisionJson = JSON.stringify({
      type: 'approve',
      title: 'Go ahead?',
      approve_label: 'Yes',
    });

    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ decision_id: 'dec-xyz' }),
    });

    let queryCallCount = 0;
    mockQuery.mockImplementation(() => {
      queryCallCount++;
      if (queryCallCount === 1) {
        return createAsyncGenerator([
          createAssistantMessageFull({
            text: `Need decision.\n\n\`\`\`decision\n${decisionJson}\n\`\`\``,
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 30, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          }),
        ]);
      }
      return createAsyncGenerator([
        createAssistantMessage('Continuing'),
        createResultSuccess({
          result: 'Final',
          num_turns: 3,
          usage: { input_tokens: 70, output_tokens: 40, cache_creation_input_tokens: 5, cache_read_input_tokens: 11, server_tool_use_input_tokens: 0 },
          total_cost_usd: 0.04,
          modelUsage: { 'claude-sonnet-4-6': { inputTokens: 70, outputTokens: 40 } },
        }),
      ]);
    });

    const reporter = createMockReporter();
    const resultPromise = executeAgent(createAgentConfig(), reporter, {
      decisionContext: {
        runId: 'run-resume',
        panelUrl: 'https://p',
        panelApiKey: 'k',
        eventBus: bus,
        fetch: fetchFn,
      },
    });

    setTimeout(() => {
      bus.emit('decision_resolved', {
        id: 1,
        type: 'decision_resolved',
        decision_id: 'dec-xyz',
        task_run_id: 'run-resume',
        resolution: { action_id: 'approve' },
      });
    }, 20);

    const result = await resultPromise;
    expect(result.usage.input_tokens).toBe(100);
    expect(result.usage.output_tokens).toBe(60);
    expect(result.usage.total_tokens).toBe(160);
    expect(result.usage.cache_read_input_tokens).toBe(11);
    expect(result.usage.cache_creation_input_tokens).toBe(5);
    expect(result.usage.estimated_cost_usd).toBeCloseTo(0.04, 6);
    expect(result.turnCount).toBe(4);
  });

  it('emits per-turn tokens_delta and model in progress metadata', async () => {
    const { executeAgent } = await import('./claude-code.js');

    mockQuery.mockReturnValue(createAsyncGenerator([
      createAssistantMessageFull({
        text: 'Step 1',
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }),
      createResultSuccess({ result: 'Done', num_turns: 1 }),
    ]));

    const reporter = createMockReporter();
    await executeAgent(createAgentConfig(), reporter);

    expect(reporter.progress).toHaveBeenCalledWith(
      'Step 1',
      expect.objectContaining({
        tokens_delta: { input: 10, output: 5 },
        model: 'claude-sonnet-4-6',
      }),
    );
  });

  it('tracks per-tool-call duration via tool_use + tool_result pairing', async () => {
    const { executeAgent } = await import('./claude-code.js');

    mockQuery.mockReturnValue(createAsyncGenerator([
      createAssistantMessageWithTools([
        { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } },
      ]),
      createUserMessageWithToolResult('tool-1', 'total 0'),
      createAssistantMessage('done looking'),
      createResultSuccess({ result: 'done', num_turns: 2 }),
    ]));

    const reporter = createMockReporter();
    const result = await executeAgent(createAgentConfig(), reporter);

    expect(result.toolCalls).toBeDefined();
    const call = result.toolCalls!.find((c) => c.name === 'Bash');
    expect(call).toBeDefined();
    expect(call?.duration_ms).toBeGreaterThanOrEqual(0);
    expect(call?.input).toEqual({ command: 'ls' });
    expect(call?.output).toBe('total 0');
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

describe('MCP server status handling', () => {
  it('includes MCP server statuses in execution result when servers exist', async () => {
    const { executeAgent } = await import('./claude-code.js');

    mockMcpServerStatus.mockResolvedValue([
      { name: 'slack', status: 'connected' },
      { name: 'linear', status: 'connected' },
    ]);

    mockQuery.mockReturnValue(createAsyncGenerator([
      createResultSuccess({ result: 'Done', num_turns: 1 }),
    ]));

    const reporter = createMockReporter();
    const result = await executeAgent(createAgentConfig(), reporter);

    expect(result.mcpServers).toEqual([
      { name: 'slack', status: 'connected', error: undefined },
      { name: 'linear', status: 'connected', error: undefined },
    ]);
  });

  it('does not include mcpServers when no servers are configured', async () => {
    const { executeAgent } = await import('./claude-code.js');

    mockMcpServerStatus.mockResolvedValue([]);

    mockQuery.mockReturnValue(createAsyncGenerator([
      createResultSuccess({ result: 'Done', num_turns: 1 }),
    ]));

    const reporter = createMockReporter();
    const result = await executeAgent(createAgentConfig(), reporter);

    expect(result.mcpServers).toBeUndefined();
  });

  it('reports MCP status via reporter.progress when all connected', async () => {
    const { executeAgent } = await import('./claude-code.js');

    mockMcpServerStatus.mockResolvedValue([
      { name: 'slack', status: 'connected' },
      { name: 'linear', status: 'connected' },
    ]);

    mockQuery.mockReturnValue(createAsyncGenerator([
      createResultSuccess({ result: 'Done', num_turns: 1 }),
    ]));

    const reporter = createMockReporter();
    await executeAgent(createAgentConfig(), reporter);

    expect(reporter.progress).toHaveBeenCalledWith(
      expect.stringContaining('[mcp]'),
      expect.objectContaining({ mcp_servers: expect.any(Array) }),
    );
  });

  it('attempts to reconnect failed servers', async () => {
    vi.useFakeTimers();
    const { executeAgent } = await import('./claude-code.js');

    mockMcpServerStatus
      .mockResolvedValueOnce([
        { name: 'slack', status: 'connected' },
        { name: 'gmail', status: 'failed', error: 'timeout' },
      ])
      .mockResolvedValue([
        { name: 'slack', status: 'connected' },
        { name: 'gmail', status: 'connected' },
      ]);

    mockQuery.mockReturnValue(createAsyncGenerator([
      createResultSuccess({ result: 'Done', num_turns: 1 }),
    ]));

    const reporter = createMockReporter();
    const resultPromise = executeAgent(createAgentConfig(), reporter);

    await vi.advanceTimersByTimeAsync(10000);
    const result = await resultPromise;

    expect(mockReconnectMcpServer).toHaveBeenCalledWith('gmail');
    expect(result.mcpServers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'gmail', status: 'connected' }),
      ]),
    );
    vi.useRealTimers();
  });

  it('handles mcpServerStatus throwing gracefully', async () => {
    const { executeAgent } = await import('./claude-code.js');

    mockMcpServerStatus.mockRejectedValue(new Error('Not supported'));

    mockQuery.mockReturnValue(createAsyncGenerator([
      createResultSuccess({ result: 'Done', num_turns: 1 }),
    ]));

    const reporter = createMockReporter();
    const result = await executeAgent(createAgentConfig(), reporter);

    expect(result.mcpServers).toBeUndefined();
    expect(result.summary).toBe('Done');
  });

  it('preserves failed server error info after reconnect attempts fail', async () => {
    vi.useFakeTimers();
    const { executeAgent } = await import('./claude-code.js');

    mockMcpServerStatus.mockResolvedValue([
      { name: 'gmail', status: 'failed', error: 'auth expired' },
    ]);

    mockQuery.mockReturnValue(createAsyncGenerator([
      createResultSuccess({ result: 'Done', num_turns: 1 }),
    ]));

    const reporter = createMockReporter();
    const resultPromise = executeAgent(createAgentConfig(), reporter);

    await vi.advanceTimersByTimeAsync(10000);
    const result = await resultPromise;

    expect(result.mcpServers).toEqual([
      { name: 'gmail', status: 'failed', error: 'auth expired' },
    ]);
    vi.useRealTimers();
  });
});

describe('buildMcpServers eventkit auto-injection', () => {
  const ORIGINAL_ENV = process.env.AGENT_SERVER_EVENTKIT_BIN;

  beforeEach(() => {
    delete process.env.AGENT_SERVER_EVENTKIT_BIN;
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.AGENT_SERVER_EVENTKIT_BIN;
    } else {
      process.env.AGENT_SERVER_EVENTKIT_BIN = ORIGINAL_ENV;
    }
  });

  it('injects eventkit when env var is set and agent has no mcp_servers', async () => {
    const { buildMcpServers } = await import('./claude-code.js');
    process.env.AGENT_SERVER_EVENTKIT_BIN = '/Applications/Agent Server.app/Contents/Helpers/agent-server-eventkit';

    const servers = buildMcpServers(createAgentConfig());

    expect(servers).toBeDefined();
    expect(servers?.eventkit).toEqual({
      type: 'stdio',
      command: '/Applications/Agent Server.app/Contents/Helpers/agent-server-eventkit',
      args: [],
    });
  });

  it('injects eventkit alongside existing user-declared mcp_servers', async () => {
    const { buildMcpServers } = await import('./claude-code.js');
    process.env.AGENT_SERVER_EVENTKIT_BIN = '/path/to/helper';

    const agent = createAgentConfig({
      mcp_servers: {
        linear: {
          command: 'npx',
          args: ['-y', 'linear-mcp'],
        },
      },
    });

    const servers = buildMcpServers(agent);

    expect(servers?.linear).toBeDefined();
    expect(servers?.eventkit).toEqual({
      type: 'stdio',
      command: '/path/to/helper',
      args: [],
    });
  });

  it('does not inject eventkit when env var is unset', async () => {
    const { buildMcpServers } = await import('./claude-code.js');

    const servers = buildMcpServers(createAgentConfig());

    expect(servers).toBeUndefined();
  });

  it('does not inject eventkit when env var is unset even with other mcp_servers', async () => {
    const { buildMcpServers } = await import('./claude-code.js');

    const agent = createAgentConfig({
      mcp_servers: {
        linear: {
          command: 'npx',
          args: ['-y', 'linear-mcp'],
        },
      },
    });

    const servers = buildMcpServers(agent);

    expect(servers?.linear).toBeDefined();
    expect(servers?.eventkit).toBeUndefined();
  });

  it('does not override user-declared eventkit mcp server', async () => {
    const { buildMcpServers } = await import('./claude-code.js');
    process.env.AGENT_SERVER_EVENTKIT_BIN = '/bundled/helper';

    const agent = createAgentConfig({
      mcp_servers: {
        eventkit: {
          command: '/custom/path/to/eventkit',
          args: ['--verbose'],
        },
      },
    });

    const servers = buildMcpServers(agent);

    expect(servers?.eventkit).toMatchObject({
      command: '/custom/path/to/eventkit',
      args: ['--verbose'],
    });
  });
});

function createAsyncGenerator<T>(items: T[]) {
  const gen = (async function* () {
    for (const item of items) {
      yield item;
    }
  })();

  return Object.assign(gen, {
    mcpServerStatus: mockMcpServerStatus,
    reconnectMcpServer: mockReconnectMcpServer,
    interrupt: vi.fn().mockResolvedValue(undefined),
  });
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

function createAssistantMessageFull(options: {
  text: string;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
}) {
  return {
    type: 'assistant' as const,
    message: {
      content: [{ type: 'text' as const, text: options.text }],
      model: options.model,
      usage: options.usage,
    },
    parent_tool_use_id: null,
    uuid: '00000000-0000-0000-0000-000000000005' as `${string}-${string}-${string}-${string}-${string}`,
    session_id: 'session-1',
  };
}

function createUserMessageWithToolResult(toolUseId: string, output: string) {
  return {
    type: 'user' as const,
    message: {
      content: [{ type: 'tool_result' as const, tool_use_id: toolUseId, content: output }],
    },
    parent_tool_use_id: null,
    uuid: '00000000-0000-0000-0000-000000000006' as `${string}-${string}-${string}-${string}-${string}`,
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
  stop_reason?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    server_tool_use_input_tokens?: number;
  };
  modelUsage?: Record<string, unknown>;
}) {
  return {
    type: 'result' as const,
    subtype: 'success' as const,
    duration_ms: overrides.duration_ms ?? 1000,
    duration_api_ms: overrides.duration_api_ms ?? 800,
    is_error: false,
    num_turns: overrides.num_turns,
    result: overrides.result,
    stop_reason: overrides.stop_reason ?? 'end_turn',
    total_cost_usd: overrides.total_cost_usd ?? 0.05,
    usage: overrides.usage ?? { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use_input_tokens: 0 },
    modelUsage: overrides.modelUsage ?? {},
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
