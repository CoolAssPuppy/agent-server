import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { discoverAgents } from './discovery.js';

function createTempDir(): string {
  const dir = join(tmpdir(), `agent-server-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeAgent(dir: string, filename: string, content: string): void {
  writeFileSync(join(dir, filename), content, 'utf-8');
}

const VALID_AGENT = `
id: hello
name: Hello World
schedule: "* * * * *"
prompt: Say hello.
`;

const SECOND_AGENT = `
id: reviewer
name: Code Reviewer
schedule: "0 8 * * *"
prompt: Review code.
max_turns: 30
`;

const DISABLED_AGENT = `
id: disabled
name: Disabled Agent
schedule: "* * * * *"
prompt: Never runs.
enabled: false
`;

const INVALID_YAML = `
id: broken
name: 123
`;

describe('discoverAgents', () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempDir();
  });

  it('returns empty array for empty directory', async () => {
    const agents = await discoverAgents(dir);
    expect(agents).toEqual([]);
  });

  it('returns empty array for non-existent directory', async () => {
    const agents = await discoverAgents('/tmp/does-not-exist-ever');
    expect(agents).toEqual([]);
  });

  it('discovers a single agent YAML file', async () => {
    writeAgent(dir, 'hello.yaml', VALID_AGENT);
    const agents = await discoverAgents(dir);
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('hello');
    expect(agents[0].name).toBe('Hello World');
  });

  it('discovers multiple agents sorted by id', async () => {
    writeAgent(dir, 'reviewer.yaml', SECOND_AGENT);
    writeAgent(dir, 'hello.yaml', VALID_AGENT);
    const agents = await discoverAgents(dir);
    expect(agents).toHaveLength(2);
    expect(agents[0].id).toBe('hello');
    expect(agents[1].id).toBe('reviewer');
  });

  it('includes disabled agents in discovery', async () => {
    writeAgent(dir, 'disabled.yaml', DISABLED_AGENT);
    const agents = await discoverAgents(dir);
    expect(agents).toHaveLength(1);
    expect(agents[0].enabled).toBe(false);
  });

  it('skips invalid YAML files without throwing', async () => {
    writeAgent(dir, 'valid.yaml', VALID_AGENT);
    writeAgent(dir, 'broken.yaml', INVALID_YAML);
    const agents = await discoverAgents(dir);
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('hello');
  });

  it('ignores non-yaml files', async () => {
    writeAgent(dir, 'hello.yaml', VALID_AGENT);
    writeAgent(dir, 'readme.md', '# Readme');
    writeAgent(dir, 'notes.txt', 'some notes');
    const agents = await discoverAgents(dir);
    expect(agents).toHaveLength(1);
  });

  it('handles both .yaml and .yml extensions', async () => {
    writeAgent(dir, 'hello.yaml', VALID_AGENT);
    writeAgent(dir, 'reviewer.yml', SECOND_AGENT);
    const agents = await discoverAgents(dir);
    expect(agents).toHaveLength(2);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
});
