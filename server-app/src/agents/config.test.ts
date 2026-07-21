import { describe, it, expect } from 'vitest';
import { parseAgentYaml, parseAgentFile, AgentConfigSchema, resolveEnvString, resolveEnvVars } from './config.js';

const VALID_YAML = `
id: hello-world
name: Hello World
schedule: "* * * * *"
prompt: |
  You are a test agent. Say hello.
`;

const FULL_YAML = `
id: book-awareness
name: Fiction book awareness agent
description: Monitors literary communities
schedule: "0 8 * * *"
timezone: Europe/Lisbon
prompt: |
  Search for conversations about fiction.
  Draft replies.
tools:
  - web_search
  - filesystem
max_turns: 30
working_directory: ~/writing
enabled: true
`;

const MINIMAL_YAML = `
id: minimal
name: Minimal Agent
schedule: "0 0 * * *"
prompt: Do something.
`;

describe('AgentConfigSchema', () => {
  it('accepts an explicit policy for skipping a completed local calendar day', () => {
    const result = AgentConfigSchema.parse({
      id: 'daily-focus',
      name: 'Daily focus',
      prompt: 'Create the daily focus report.',
      timezone: 'Europe/Lisbon',
      rerun_policy: 'skip_if_completed_today',
    });

    expect(result.rerun_policy).toBe('skip_if_completed_today');
  });

  it('accepts a reviewed required output contract while preserving current output guidance', () => {
    const result = AgentConfigSchema.parse({
      id: 'daily-report',
      name: 'Daily report',
      prompt: 'Create the daily report.',
      output: {
        primary: {
          description: 'Create one report in the selected database',
          tool: 'mcp__notion__create_page',
          target: 'My selected report database',
          required: true,
          successful_calls: { min: 1, max: 1 },
          target_match: { field: 'data_source_id', equals: 'destination-id' },
          update_tool: 'mcp__notion__update_page',
        },
        notification: { description: 'Send a completion notice', tool: 'notification' },
        on_failure: { action: 'save_locally', logfile: '~/.agent-server/logs/failure.md' },
      },
    });

    expect(result.output?.primary.required).toBe(true);
    expect(result.output?.primary.successful_calls).toEqual({ min: 1, max: 1 });
    expect(result.output?.on_failure?.action).toBe('save_locally');
  });

  it('rejects an impossible required output call range', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'daily-report',
      name: 'Daily report',
      prompt: 'Create the daily report.',
      output: {
        primary: {
          description: 'Create reports',
          tool: 'mcp__notion__create_page',
          required: true,
          successful_calls: { min: 2, max: 1 },
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects unknown required output fields that would not be enforced', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'daily-report',
      name: 'Daily report',
      prompt: 'Create the daily report.',
      output: {
        primary: {
          description: 'Create the report',
          tool: 'mcp__notion__create_page',
          required: true,
          destination_id: 'not-an-enforced-field',
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it.each(['', '   '])('rejects an empty required output target value (%j)', (equals) => {
    const result = AgentConfigSchema.safeParse({
      id: 'daily-report',
      name: 'Daily report',
      prompt: 'Create the daily report.',
      output: {
        primary: {
          description: 'Create the report',
          tool: 'mcp__notion__create_page',
          required: true,
          target_match: { field: 'data_source_id', equals },
        },
      },
    });

    expect(result.success).toBe(false);
  });
  it('validates a minimal config', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'test',
      name: 'Test',
      schedule: '* * * * *',
      prompt: 'Do something.',
    });
    expect(result.success).toBe(true);
  });

  it('applies defaults for optional fields', () => {
    const result = AgentConfigSchema.parse({
      id: 'test',
      name: 'Test',
      schedule: '* * * * *',
      prompt: 'Do something.',
    });
    expect(result.max_turns).toBe(20);
    expect(result.enabled).toBe(true);
    expect(result.tools).toEqual([]);
    expect(result.timezone).toBeUndefined();
    expect(result.working_directory).toBeUndefined();
    expect(result.description).toBeUndefined();
  });

  it('keeps multiple file grants with independent access', () => {
    const result = AgentConfigSchema.parse({
      id: 'manuscript-review',
      name: 'Manuscript review',
      prompt: 'Review the manuscript.',
      file_access: [
        { path: '~/Books/manuscript.docx', kind: 'file', access: 'read_only' },
        { path: '~/Books/Notes', kind: 'folder', access: 'read_write' },
      ],
    });

    expect(result.file_access).toEqual([
      { path: '~/Books/manuscript.docx', kind: 'file', access: 'read_only' },
      { path: '~/Books/Notes', kind: 'folder', access: 'read_write' },
    ]);
  });

  it('rejects missing required fields', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'test',
      name: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty id', () => {
    const result = AgentConfigSchema.safeParse({
      id: '',
      name: 'Test',
      schedule: '* * * * *',
      prompt: 'Do something.',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty prompt', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'test',
      name: 'Test',
      schedule: '* * * * *',
      prompt: '',
    });
    expect(result.success).toBe(false);
  });

  it('accepts config without a schedule (on-demand agent)', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'on-demand',
      name: 'On Demand Agent',
      prompt: 'Do something on demand.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schedule).toBeUndefined();
    }
  });

  it('rejects empty schedule string', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'test',
      name: 'Test',
      schedule: '',
      prompt: 'Do something.',
    });
    expect(result.success).toBe(false);
  });

  it('accepts config with interaction block', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'interactive',
      name: 'Interactive Agent',
      prompt: 'Do something interactive.',
      interaction: {
        channel: 'telegram',
        on_reply: 'follow-up-agent',
        timeout: '1h',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.interaction?.channel).toBe('telegram');
      expect(result.data.interaction?.on_reply).toBe('follow-up-agent');
      expect(result.data.interaction?.timeout).toBe('1h');
    }
  });

  it('accepts config with notification block', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'reporter',
      name: 'Reporter Agent',
      schedule: '0 9 * * 1',
      prompt: 'Generate weekly report.',
      notification: {
        channel: 'telegram',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notification?.channel).toBe('telegram');
      expect(result.data.notification?.on_complete).toBe(true);
      expect(result.data.notification?.on_failure).toBe(true);
    }
  });

  it('allows notification with failure-only', () => {
    const result = AgentConfigSchema.parse({
      id: 'silent',
      name: 'Silent Agent',
      prompt: 'Do something quietly.',
      notification: {
        channel: 'telegram',
        on_complete: false,
      },
    });
    expect(result.notification?.on_complete).toBe(false);
    expect(result.notification?.on_failure).toBe(true);
  });

  it('accepts config with telemetry block', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'chatty',
      name: 'Chatty Agent',
      prompt: 'Lots of progress updates.',
      telemetry: {
        progress_mode: 'batched',
        progress_sample_ms: 10_000,
        progress_max_entries: 20,
        progress_include_metadata: true,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.telemetry?.progress_mode).toBe('batched');
      expect(result.data.telemetry?.progress_sample_ms).toBe(10_000);
      expect(result.data.telemetry?.progress_max_entries).toBe(20);
      expect(result.data.telemetry?.progress_include_metadata).toBe(true);
    }
  });

  it('accepts a partial telemetry block', () => {
    const result = AgentConfigSchema.parse({
      id: 'partial',
      name: 'Partial Telemetry',
      prompt: 'Only set the mode.',
      telemetry: { progress_mode: 'live' },
    });
    expect(result.telemetry?.progress_mode).toBe('live');
    expect(result.telemetry?.progress_sample_ms).toBeUndefined();
  });

  it('rejects invalid telemetry mode', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'bad',
      name: 'Bad Telemetry',
      prompt: 'Wrong mode.',
      telemetry: { progress_mode: 'streamed' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts the supported executor names and Codex settings', () => {
    const result = AgentConfigSchema.parse({
      id: 'codex-agent',
      name: 'Codex Agent',
      prompt: 'Run with Codex.',
      executor: 'codex',
      model: 'gpt-5.4',
      codex_sandbox: 'read-only',
    });

    expect(result.executor).toBe('codex');
    expect(result.model).toBe('gpt-5.4');
    expect(result.codex_sandbox).toBe('read-only');
  });

  it('accepts Kimi Code as an installed executor', () => {
    const result = AgentConfigSchema.parse({
      id: 'kimi-code-agent',
      name: 'Kimi Code Agent',
      prompt: 'Run with the installed Kimi Code runtime.',
      executor: 'kimi-code',
    });

    expect(result.executor).toBe('kimi-code');
  });

  it('rejects unknown executors during agent discovery', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'unknown-provider',
      name: 'Unknown Provider',
      prompt: 'Do something.',
      executor: 'other-provider',
    });

    expect(result.success).toBe(false);
  });

  it('accepts a custom provider block with a ${VAR} api key', () => {
    const result = AgentConfigSchema.parse({
      id: 'kimi-agent',
      name: 'Kimi Agent',
      prompt: 'Run with Kimi K3.',
      executor: 'codex',
      model: 'kimi-k3',
      provider: {
        base_url: 'https://api.moonshot.ai/v1',
        api_key: '${MOONSHOT_API_KEY}',
      },
    });

    expect(result.provider?.base_url).toBe('https://api.moonshot.ai/v1');
    expect(result.provider?.api_key).toBe('${MOONSHOT_API_KEY}');
  });

  it('accepts a provider without an api key (public or env-configured endpoint)', () => {
    const result = AgentConfigSchema.parse({
      id: 'local-model',
      name: 'Local Model',
      prompt: 'Run against a local endpoint.',
      executor: 'codex',
      provider: { base_url: 'http://localhost:11434/v1' },
    });

    expect(result.provider?.base_url).toBe('http://localhost:11434/v1');
    expect(result.provider?.api_key).toBeUndefined();
  });

  it('accepts HTTP provider endpoints only on the local machine', () => {
    for (const base_url of [
      'http://localhost:11434/v1',
      'http://127.0.0.1:11434/v1',
      'http://[::1]:11434/v1',
    ]) {
      const result = AgentConfigSchema.safeParse({
        id: 'local-model',
        name: 'Local Model',
        prompt: 'Run against a local endpoint.',
        provider: { base_url },
      });
      expect(result.success, base_url).toBe(true);
    }
  });

  it('rejects insecure remote provider endpoints and URL credentials', () => {
    for (const base_url of [
      'http://api.example.com/v1',
      'ftp://api.example.com/v1',
      'https://user:password@api.example.com/v1',
    ]) {
      const result = AgentConfigSchema.safeParse({
        id: 'unsafe-provider',
        name: 'Unsafe Provider',
        prompt: 'Do something.',
        provider: { base_url },
      });
      expect(result.success, base_url).toBe(false);
    }
  });

  it('requires provider api_key to be one exact environment reference', () => {
    for (const api_key of ['literal-secret', 'Bearer ${MOONSHOT_API_KEY}', '${ONE}${TWO}']) {
      const result = AgentConfigSchema.safeParse({
        id: 'unsafe-provider-key',
        name: 'Unsafe Provider Key',
        prompt: 'Do something.',
        provider: { base_url: 'https://api.example.com/v1', api_key },
      });
      expect(result.success, api_key).toBe(false);
    }
  });

  it('rejects provider references to Agent Server secrets', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'server-secret-provider',
      name: 'Server Secret Provider',
      prompt: 'Do something.',
      provider: {
        base_url: 'https://api.example.com/v1',
        api_key: '${AGENT_SERVER_PANEL_API_KEY}',
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects provider references to secrets unrelated to the endpoint', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'unrelated-provider-secret',
      name: 'Unrelated Provider Secret',
      prompt: 'Do something.',
      provider: {
        base_url: 'https://api.moonshot.ai/v1',
        api_key: '${DATABASE_URL}',
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects a provider whose base_url is not a URL', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'bad-provider',
      name: 'Bad Provider',
      prompt: 'Do something.',
      provider: { base_url: 'not-a-url' },
    });

    expect(result.success).toBe(false);
  });

  it('accepts config with permissions block', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'restricted',
      name: 'Restricted Agent',
      prompt: 'Read only.',
      permissions: {
        allow: ['Read', 'Glob', 'Grep', 'mcp__claude_ai_Linear__list_*'],
        deny: ['Bash', 'mcp__*__create_*'],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.permissions?.allow).toEqual(['Read', 'Glob', 'Grep', 'mcp__claude_ai_Linear__list_*']);
      expect(result.data.permissions?.deny).toEqual(['Bash', 'mcp__*__create_*']);
    }
  });

  it('accepts permissions with only allow rules', () => {
    const result = AgentConfigSchema.parse({
      id: 'test',
      name: 'Test',
      prompt: 'Do something.',
      permissions: {
        allow: ['Read', 'Write'],
      },
    });
    expect(result.permissions?.allow).toEqual(['Read', 'Write']);
    expect(result.permissions?.deny).toEqual([]);
  });

  it('accepts permissions with only deny rules', () => {
    const result = AgentConfigSchema.parse({
      id: 'test',
      name: 'Test',
      prompt: 'Do something.',
      permissions: {
        deny: ['Bash'],
      },
    });
    expect(result.permissions?.allow).toEqual([]);
    expect(result.permissions?.deny).toEqual(['Bash']);
  });

  it('defaults permissions to undefined when not specified', () => {
    const result = AgentConfigSchema.parse({
      id: 'test',
      name: 'Test',
      prompt: 'Do something.',
    });
    expect(result.permissions).toBeUndefined();
  });

  it('rejects empty strings in permissions allow list', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'test',
      name: 'Test',
      prompt: 'Do something.',
      permissions: { allow: [''] },
    });
    expect(result.success).toBe(false);
  });

  it('accepts config with disallowed_tools', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'safe-agent',
      name: 'Safe Agent',
      prompt: 'Read files only.',
      disallowed_tools: ['Bash', 'Write', 'Edit'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.disallowed_tools).toEqual(['Bash', 'Write', 'Edit']);
    }
  });

  it('defaults disallowed_tools to empty array', () => {
    const result = AgentConfigSchema.parse({
      id: 'test',
      name: 'Test',
      prompt: 'Do something.',
    });
    expect(result.disallowed_tools).toEqual([]);
  });

  it('accepts config with permission_mode', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'careful-agent',
      name: 'Careful Agent',
      prompt: 'Do careful work.',
      permission_mode: 'acceptEdits',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.permission_mode).toBe('acceptEdits');
    }
  });

  it('rejects invalid permission_mode', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'bad-agent',
      name: 'Bad Agent',
      prompt: 'Do something.',
      permission_mode: 'invalidMode',
    });
    expect(result.success).toBe(false);
  });

  it('defaults permission_mode to undefined', () => {
    const result = AgentConfigSchema.parse({
      id: 'test',
      name: 'Test',
      prompt: 'Do something.',
    });
    expect(result.permission_mode).toBeUndefined();
  });

  it('applies default timeout for interaction config', () => {
    const result = AgentConfigSchema.parse({
      id: 'interactive',
      name: 'Interactive Agent',
      prompt: 'Do something.',
      interaction: {
        channel: 'telegram',
        on_reply: 'next-agent',
      },
    });
    expect(result.interaction?.timeout).toBe('30m');
  });
});

describe('parseAgentYaml', () => {
  it('parses valid YAML into AgentConfig', () => {
    const config = parseAgentYaml(VALID_YAML);
    expect(config.id).toBe('hello-world');
    expect(config.name).toBe('Hello World');
    expect(config.schedule).toBe('* * * * *');
    expect(config.prompt).toContain('test agent');
  });

  it('parses a full config with all fields', () => {
    const config = parseAgentYaml(FULL_YAML);
    expect(config.id).toBe('book-awareness');
    expect(config.name).toBe('Fiction book awareness agent');
    expect(config.description).toBe('Monitors literary communities');
    expect(config.schedule).toBe('0 8 * * *');
    expect(config.timezone).toBe('Europe/Lisbon');
    expect(config.tools).toEqual(['web_search', 'filesystem']);
    expect(config.max_turns).toBe(30);
    expect(config.working_directory).toBe('~/writing');
    expect(config.enabled).toBe(true);
  });

  it('parses minimal YAML with defaults', () => {
    const config = parseAgentYaml(MINIMAL_YAML);
    expect(config.id).toBe('minimal');
    expect(config.max_turns).toBe(20);
    expect(config.enabled).toBe(true);
    expect(config.tools).toEqual([]);
  });

  it('throws on invalid YAML syntax', () => {
    expect(() => parseAgentYaml('{')).toThrow();
  });

  it('throws on missing required fields', () => {
    expect(() => parseAgentYaml('id: test\nname: Test\n')).toThrow();
  });

  it('preserves extra fields in passthrough', () => {
    const yaml = `
id: test
name: Test
schedule: "* * * * *"
prompt: Do it.
notifications:
  on_complete: telegram
`;
    const config = parseAgentYaml(yaml);
    expect(config.notifications).toEqual({ on_complete: 'telegram' });
  });
});

const FRONTMATTER_AGENT = `---
id: daily-standup
name: Daily Standup Summary
schedule: "0 9 * * 1-5"
timezone: America/Los_Angeles
tools:
  - Read
  - Write
max_turns: 15
---

# Daily standup

Generate a daily standup summary for today.

- Check Slack channels
- Check Linear for issues
- Check git commits
`;

const FRONTMATTER_MINIMAL = `---
id: minimal-md
name: Minimal Markdown Agent
schedule: "0 0 * * *"
---

Do something simple.
`;

const FRONTMATTER_WITH_YAML_PROMPT = `---
id: both-prompts
name: Both Prompts
schedule: "* * * * *"
prompt: This prompt is in YAML.
---

This prompt is in the body.
`;

const FRONTMATTER_EMPTY_BODY = `---
id: no-body
name: No Body
schedule: "* * * * *"
---
`;

const FRONTMATTER_NO_CLOSE = `---
id: broken
name: Broken
schedule: "* * * * *"
`;

describe('mcp_servers config', () => {
  it('accepts opaque saved connection bindings without changing MCP transport validation', () => {
    const result = AgentConfigSchema.parse({
      id: 'bound-agent',
      name: 'Bound agent',
      prompt: 'Use the saved connection.',
      connection_bindings: {
        'notion-personal': '11111111-1111-4111-8111-111111111111',
      },
    });

    expect(result.connection_bindings).toEqual({
      'notion-personal': '11111111-1111-4111-8111-111111111111',
    });
  });

  it('accepts custom credential references only when a saved binding owns that runtime transport', () => {
    const custom = {
      id: 'bound-agent',
      name: 'Bound agent',
      prompt: 'Use the saved connection.',
      mcp_servers: {
        notes: {
          type: 'http' as const,
          url: 'https://notes.example.test/mcp',
          headers: { Authorization: 'Bearer ${MY_NOTES_TOKEN}' },
        },
      },
    };

    expect(() => AgentConfigSchema.parse(custom)).toThrow(/not approved/i);
    expect(AgentConfigSchema.parse({
      ...custom,
      connection_bindings: { notes: '11111111-1111-4111-8111-111111111111' },
    }).mcp_servers?.notes).toEqual(custom.mcp_servers.notes);
  });

  it('rejects invalid runtime names and non-UUID saved connection bindings', () => {
    const base = { id: 'bound-agent', name: 'Bound agent', prompt: 'Use it.' };

    expect(() => AgentConfigSchema.parse({
      ...base,
      connection_bindings: { 'has spaces': '11111111-1111-4111-8111-111111111111' },
    })).toThrow();
    expect(() => AgentConfigSchema.parse({
      ...base,
      connection_bindings: { notion: 'personal' },
    })).toThrow();
  });

  it('accepts config with stdio mcp server', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'mcp-agent',
      name: 'MCP Agent',
      prompt: 'Do something.',
      mcp_servers: {
        'notion-personal': {
          command: 'npx',
          args: ['-y', '@notionhq/notion-mcp-server'],
          env: { NOTION_API_KEY: 'test-key' },
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const server = result.data.mcp_servers?.['notion-personal'];
      expect(server).toBeDefined();
      expect(server?.command).toBe('npx');
      expect(server?.args).toEqual(['-y', '@notionhq/notion-mcp-server']);
      expect(server?.env).toEqual({ NOTION_API_KEY: 'test-key' });
    }
  });

  it('accepts config with sse mcp server', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'mcp-agent',
      name: 'MCP Agent',
      prompt: 'Do something.',
      mcp_servers: {
        'remote-server': {
          type: 'sse',
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer token' },
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const server = result.data.mcp_servers?.['remote-server'];
      expect(server?.type).toBe('sse');
      expect(server?.url).toBe('https://example.com/mcp');
    }
  });

  it('accepts config with http mcp server', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'mcp-agent',
      name: 'MCP Agent',
      prompt: 'Do something.',
      mcp_servers: {
        'http-server': {
          type: 'http',
          url: 'https://example.com/mcp',
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts config with multiple mcp servers', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'mcp-agent',
      name: 'MCP Agent',
      prompt: 'Do something.',
      mcp_servers: {
        'notion-personal': {
          command: 'npx',
          args: ['-y', '@notionhq/notion-mcp-server'],
        },
        'notion-work': {
          command: 'npx',
          args: ['-y', '@notionhq/notion-mcp-server'],
          env: { NOTION_API_KEY: 'other-key' },
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data.mcp_servers ?? {})).toHaveLength(2);
    }
  });

  it('defaults mcp_servers to undefined when not specified', () => {
    const result = AgentConfigSchema.parse({
      id: 'test',
      name: 'Test',
      prompt: 'Do something.',
    });
    expect(result.mcp_servers).toBeUndefined();
  });

  it('rejects stdio server without command', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'bad',
      name: 'Bad',
      prompt: 'Do something.',
      mcp_servers: {
        broken: { args: ['foo'] },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects sse server without url', () => {
    const result = AgentConfigSchema.safeParse({
      id: 'bad',
      name: 'Bad',
      prompt: 'Do something.',
      mcp_servers: {
        broken: { type: 'sse' },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects Agent Server and unrelated secret references in MCP configuration', () => {
    for (const value of ['${AGENT_SERVER_API_KEY}', '${DATABASE_URL}']) {
      const result = AgentConfigSchema.safeParse({
        id: 'unsafe-mcp-agent',
        name: 'Unsafe MCP Agent',
        prompt: 'Do something.',
        mcp_servers: {
          notion: {
            command: 'npx',
            env: { NOTION_TOKEN: value },
          },
        },
      });
      expect(result.success, value).toBe(false);
    }
  });
});

describe('resolveEnvVars', () => {
  it('replaces ${VAR} with process.env values', () => {
    const env = { API_KEY: '${TEST_VAR}' };
    const resolved = resolveEnvVars(env, { TEST_VAR: 'secret123' });
    expect(resolved).toEqual({ API_KEY: 'secret123' });
  });

  it('leaves literal strings unchanged', () => {
    const env = { API_KEY: 'literal-value' };
    const resolved = resolveEnvVars(env, {});
    expect(resolved).toEqual({ API_KEY: 'literal-value' });
  });

  it('replaces multiple vars in different keys', () => {
    const env = { KEY_A: '${VAR_A}', KEY_B: '${VAR_B}' };
    const resolved = resolveEnvVars(env, { VAR_A: 'aaa', VAR_B: 'bbb' });
    expect(resolved).toEqual({ KEY_A: 'aaa', KEY_B: 'bbb' });
  });

  it('replaces undefined env vars with empty string', () => {
    const env = { API_KEY: '${MISSING_VAR}' };
    const resolved = resolveEnvVars(env, {});
    expect(resolved).toEqual({ API_KEY: '' });
  });

  it('handles mixed literal and variable values', () => {
    const env = { PREFIX: '${HOST}:8080' };
    const resolved = resolveEnvVars(env, { HOST: 'localhost' });
    expect(resolved).toEqual({ PREFIX: 'localhost:8080' });
  });

  it('returns empty object for empty input', () => {
    const resolved = resolveEnvVars({}, {});
    expect(resolved).toEqual({});
  });

  it('refuses to substitute Agent Server control-plane secrets', () => {
    expect(() => resolveEnvString(
      '${AGENT_SERVER_PANEL_API_KEY}',
      { AGENT_SERVER_PANEL_API_KEY: 'panel-secret' },
    )).toThrow(/not available to agents/i);
    expect(() => resolveEnvVars(
      { TOKEN: 'Bearer ${AGENT_SERVER_API_KEY}' },
      { AGENT_SERVER_API_KEY: 'local-api-secret' },
    )).toThrow(/not available to agents/i);
  });
});

describe('parseAgentFile', () => {
  it('selects Codex from Markdown frontmatter', () => {
    const config = parseAgentFile(`---
id: codex-markdown
name: Codex Markdown
executor: codex
---

Run this prompt with my ChatGPT subscription.
`);

    expect(config.executor).toBe('codex');
    expect(config.prompt).toBe('Run this prompt with my ChatGPT subscription.');
  });

  it('parses pure YAML when no frontmatter delimiters present', () => {
    const config = parseAgentFile(VALID_YAML);
    expect(config.id).toBe('hello-world');
    expect(config.prompt).toContain('test agent');
  });

  it('parses frontmatter + markdown body into AgentConfig', () => {
    const config = parseAgentFile(FRONTMATTER_AGENT);
    expect(config.id).toBe('daily-standup');
    expect(config.name).toBe('Daily Standup Summary');
    expect(config.schedule).toBe('0 9 * * 1-5');
    expect(config.timezone).toBe('America/Los_Angeles');
    expect(config.tools).toEqual(['Read', 'Write']);
    expect(config.max_turns).toBe(15);
  });

  it('uses markdown body as the prompt', () => {
    const config = parseAgentFile(FRONTMATTER_AGENT);
    expect(config.prompt).toContain('# Daily standup');
    expect(config.prompt).toContain('Check Slack channels');
  });

  it('trims whitespace from the markdown body prompt', () => {
    const config = parseAgentFile(FRONTMATTER_MINIMAL);
    expect(config.prompt).toBe('Do something simple.');
  });

  it('uses body over YAML prompt when both exist', () => {
    const config = parseAgentFile(FRONTMATTER_WITH_YAML_PROMPT);
    expect(config.prompt).toBe('This prompt is in the body.');
  });

  it('throws when frontmatter has no body and no YAML prompt', () => {
    expect(() => parseAgentFile(FRONTMATTER_EMPTY_BODY)).toThrow();
  });

  it('throws when frontmatter opening has no closing delimiter', () => {
    expect(() => parseAgentFile(FRONTMATTER_NO_CLOSE)).toThrow();
  });

  it('applies schema defaults for frontmatter format', () => {
    const config = parseAgentFile(FRONTMATTER_MINIMAL);
    expect(config.max_turns).toBe(20);
    expect(config.enabled).toBe(true);
    expect(config.tools).toEqual([]);
  });

  it('parses on-demand agent without schedule', () => {
    const content = `---
id: on-demand
name: On Demand Agent
tools:
  - Bash
---

Do something when triggered manually.
`;
    const config = parseAgentFile(content);
    expect(config.id).toBe('on-demand');
    expect(config.schedule).toBeUndefined();
    expect(config.prompt).toBe('Do something when triggered manually.');
  });
});
