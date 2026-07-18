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

  it('uses the injected local structured model for semantic checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'analysis-runtime-'));
    const agentsDir = join(root, 'agents');
    try {
      await mkdir(agentsDir);
      await writeFile(join(agentsDir, 'reader.md'), `---
id: reader
name: Reader
tools: [Read]
---
Review notes.
`, 'utf8');
      let calls = 0;
      const runtime = createAnalysisRuntime({
        agentsDir,
        reviewDbPath: ':memory:',
        homeDir: '/Users/example',
        model: {
          handlesRetries: true,
          generate: async () => {
            calls += 1;
            return { schema_version: 1, findings: [] };
          },
        },
      });
      const response = await runtime.api.request('/security/agents/reader');
      expect((await response.json()).model_status).toBe('completed');
      expect(calls).toBe(1);
      runtime.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps consumer review state across analysis runtime restarts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'analysis-runtime-'));
    const agentsDir = join(root, 'agents');
    const reviewDbPath = join(root, 'security-reviews.db');
    try {
      await mkdir(agentsDir);
      await writeFile(join(agentsDir, 'reader.md'), `---
id: reader
name: Reader
tools: [Read]
---
Review notes.
`, 'utf8');
      const first = createAnalysisRuntime({ agentsDir, reviewDbPath, homeDir: '/Users/example' });
      const analysis = await (await first.api.request('/security/agents/reader')).json();
      const review = await first.api.request('/security/agents/reader/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content_hash: analysis.content_hash,
          acknowledged_finding_ids: analysis.findings.map((finding: { id: string }) => finding.id),
        }),
      });
      expect((await review.json()).review_state.is_reviewed).toBe(true);
      first.close();

      const second = createAnalysisRuntime({ agentsDir, reviewDbPath, homeDir: '/Users/example' });
      const restored = await (await second.api.request('/security/agents/reader')).json();
      expect(restored.review_state).toMatchObject({
        is_reviewed: true,
        is_stale: false,
        acknowledged_finding_ids: analysis.findings.map((finding: { id: string }) => finding.id),
      });
      expect(restored.review_state.reviewed_at).toEqual(expect.any(String));
      second.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
