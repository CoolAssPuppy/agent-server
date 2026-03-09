import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import { parseAgentFile } from './config.js';
import { AGENT_EXTENSIONS } from './discovery.js';

const sampleDir = join(import.meta.dirname, '..', '..', 'sample-agents');

describe('sample agents', () => {
  const agentFiles = readdirSync(sampleDir).filter((f) => AGENT_EXTENSIONS.has(extname(f)));

  it('has sample agent files', () => {
    expect(agentFiles.length).toBeGreaterThan(0);
  });

  for (const file of agentFiles) {
    it(`${file} parses as valid agent config`, () => {
      const content = readFileSync(join(sampleDir, file), 'utf-8');
      const agent = parseAgentFile(content);

      expect(agent.id).toBeTruthy();
      expect(agent.name).toBeTruthy();
      expect(agent.schedule).toBeTruthy();
      expect(agent.prompt).toBeTruthy();
      expect(agent.tools.length).toBeGreaterThan(0);
      expect(agent.max_turns).toBeGreaterThan(0);
    });
  }

  it('markdown-processor has file watch config', () => {
    const content = readFileSync(join(sampleDir, 'markdown-processor.yaml'), 'utf-8');
    const agent = parseAgentFile(content);

    expect(agent.watch).toBeDefined();
    expect(agent.watch).toHaveLength(1);
    expect(agent.watch![0].path).toContain('notes');
    expect(agent.watch![0].glob).toBe('*.md');
  });

  it('research-collector has on_complete trigger', () => {
    const content = readFileSync(join(sampleDir, 'research-collector.yaml'), 'utf-8');
    const agent = parseAgentFile(content);

    expect(agent.on_complete).toBeDefined();
    expect(agent.on_complete).toHaveLength(1);
    expect(agent.on_complete![0].agent).toBe('markdown-processor');
  });
});
