import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initAgentServer } from './init.js';

function createTempPath(): string {
  return join(tmpdir(), `init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe('initAgentServer', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('creates agents, locks, and logs directories', () => {
    const base = createTempPath();
    dirs.push(base);

    initAgentServer(base);

    expect(existsSync(join(base, 'agents'))).toBe(true);
    expect(existsSync(join(base, 'locks'))).toBe(true);
    expect(existsSync(join(base, 'logs'))).toBe(true);
  });

  it('creates a sample hello-world agent', () => {
    const base = createTempPath();
    dirs.push(base);

    initAgentServer(base);

    const samplePath = join(base, 'agents', 'hello-world.yaml');
    expect(existsSync(samplePath)).toBe(true);

    const content = readFileSync(samplePath, 'utf-8');
    expect(content).toContain('id: hello-world');
    expect(content).toContain('schedule:');
    expect(content).toContain('prompt:');
  });

  it('does not overwrite existing sample agent', () => {
    const base = createTempPath();
    dirs.push(base);

    initAgentServer(base);
    const samplePath = join(base, 'agents', 'hello-world.yaml');
    const originalContent = readFileSync(samplePath, 'utf-8');

    // Run init again
    initAgentServer(base);
    const afterContent = readFileSync(samplePath, 'utf-8');
    expect(afterContent).toBe(originalContent);
  });

  it('does not re-seed sample agents after the user deletes them', () => {
    const base = createTempPath();
    dirs.push(base);

    initAgentServer(base);
    const helloPath = join(base, 'agents', 'hello-world.yaml');
    const pulsePath = join(base, 'agents', 'pulse.md');
    expect(existsSync(helloPath)).toBe(true);
    expect(existsSync(pulsePath)).toBe(true);

    // User deletes the samples
    unlinkSync(helloPath);
    unlinkSync(pulsePath);

    // Next launch should respect the deletion
    initAgentServer(base);
    expect(existsSync(helloPath)).toBe(false);
    expect(existsSync(pulsePath)).toBe(false);
  });

  it('does not seed samples when the agents folder already has user agents', () => {
    const base = createTempPath();
    dirs.push(base);

    // Simulate a user who brought their own agent before first launch
    const agentsDir = join(base, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'my-agent.yaml'), 'id: my-agent\nname: Mine\n');

    initAgentServer(base);

    expect(existsSync(join(agentsDir, 'hello-world.yaml'))).toBe(false);
    expect(existsSync(join(agentsDir, 'pulse.md'))).toBe(false);
    expect(existsSync(join(agentsDir, 'my-agent.yaml'))).toBe(true);
  });
});
