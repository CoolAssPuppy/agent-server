import { mkdir, mkdtemp, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { createAnalysisRuntime } from './runtime.js';

describe('analysis runtime', () => {
  it('wires file-backed analysis and closes its private review database cleanly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'analysis-runtime-'));
    const agentsDir = join(root, 'agents');
    const reviewDbPath = join(root, 'security-reviews.db');
    try {
      await mkdir(agentsDir);
      await writeFile(join(agentsDir, 'reader.md'), `---
id: reader
name: Reader
tools: [Read]
codex_sandbox: read-only
---
Review notes without changing them.
`, 'utf8');
      const runtime = createAnalysisRuntime({ agentsDir, reviewDbPath, homeDir: '/Users/example' });

      const response = await runtime.api.request('/security/agents/reader');
      expect(response.status).toBe(200);
      expect((await response.json()).agent_id).toBe('reader');
      expect((await stat(reviewDbPath)).mode & 0o777).toBe(0o600);
      runtime.close();
      expect(() => runtime.close()).not.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
