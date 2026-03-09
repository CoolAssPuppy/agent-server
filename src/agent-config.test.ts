import { describe, it, expect } from 'vitest';
import { parseAgentYaml, AgentConfigSchema } from './agent-config.js';

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
