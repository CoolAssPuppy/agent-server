import { describe, it, expect } from 'vitest';
import { parseAgentYaml, parseAgentFile, AgentConfigSchema } from './config.js';

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

  it('applies a custom default max_turns when omitted', () => {
    const config = parseAgentYaml(MINIMAL_YAML, { defaultMaxTurns: 50 });
    expect(config.max_turns).toBe(50);
  });

  it('does not override explicit max_turns when a custom default is provided', () => {
    const config = parseAgentYaml(FULL_YAML, { defaultMaxTurns: 50 });
    expect(config.max_turns).toBe(30);
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

describe('parseAgentFile', () => {
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

  it('applies custom default max_turns for frontmatter agents when omitted', () => {
    const config = parseAgentFile(FRONTMATTER_MINIMAL, { defaultMaxTurns: 50 });
    expect(config.max_turns).toBe(50);
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
