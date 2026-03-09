import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'fs';
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
});
