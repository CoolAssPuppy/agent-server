import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { discoverAgents } from '../agents/discovery.js';
import { RunStore } from './store.js';
import { createApi } from '../server/api.js';
import { buildAgentSyncPayload } from './sync-schedule.js';

describe('watch-only agent catalog lifecycle', () => {
  const directory = join(tmpdir(), `agent-catalog-${process.pid}`);

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('remains visible after enable, reload, panel sync, and app restart', async () => {
    mkdirSync(directory, { recursive: true });
    const definitionPath = join(directory, 'manuscript-analysis.md');
    writeFileSync(definitionPath, [
      '---',
      'id: manuscript-analysis',
      'name: Age of the Astronomer manuscript analysis',
      'enabled: false',
      'watch:',
      '- path: /path/to/manuscript.docx',
      '---',
      'Prompt text',
    ].join('\n'));

    const source = readFileSync(definitionPath, 'utf8');
    writeFileSync(definitionPath, source.replace('enabled: false', 'enabled: true'));

    const reloaded = await discoverAgents(directory);
    const syncPayload = buildAgentSyncPayload(reloaded, new Date('2026-07-13T00:00:00Z'));
    expect(syncPayload.agents).toEqual([
      expect.objectContaining({ slug: 'manuscript-analysis' }),
    ]);
    expect(syncPayload.agents[0].cron_expression).toBeUndefined();
    expect(syncPayload.agents[0].next_run_at).toBeUndefined();

    const loadCatalogAfterAppStart = async (): Promise<string[]> => {
      const app = createApi({
        getAgents: () => discoverAgents(directory),
        store: new RunStore(),
        triggerRun: vi.fn().mockResolvedValue('run-id'),
      });
      const response = await app.request('/agents');
      const agents = await response.json() as Array<{ id: string }>;
      return agents.map((agent) => agent.id);
    };

    expect(await loadCatalogAfterAppStart()).toContain('manuscript-analysis');
    expect(await loadCatalogAfterAppStart()).toContain('manuscript-analysis');
  });
});
