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

  it('discovers .md files with frontmatter', async () => {
    const mdAgent = `---
id: standup
name: Standup Agent
schedule: "0 9 * * 1-5"
---

Generate a standup summary.
`;
    writeAgent(dir, 'standup.md', mdAgent);
    const agents = await discoverAgents(dir);
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('standup');
    expect(agents[0].prompt).toBe('Generate a standup summary.');
  });

  it('discovers .md and .yaml files together', async () => {
    const mdAgent = `---
id: alpha
name: Alpha Agent
schedule: "0 0 * * *"
---

Do alpha things.
`;
    writeAgent(dir, 'alpha.md', mdAgent);
    writeAgent(dir, 'bravo.yaml', VALID_AGENT);
    const agents = await discoverAgents(dir);
    expect(agents).toHaveLength(2);
    expect(agents[0].id).toBe('alpha');
    expect(agents[1].id).toBe('hello');
  });

  it('skips .md files without valid frontmatter', async () => {
    writeAgent(dir, 'readme.md', '# Just a readme\n\nNo agent here.');
    writeAgent(dir, 'valid.yaml', VALID_AGENT);
    const agents = await discoverAgents(dir);
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('hello');
  });


  it('skips duplicate agent IDs', async () => {
    writeAgent(dir, 'a.yaml', VALID_AGENT);
    writeAgent(dir, 'b.yaml', `
id: hello
name: Duplicate
prompt: Duplicate
`);

    const agents = await discoverAgents(dir);
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('hello');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
});
