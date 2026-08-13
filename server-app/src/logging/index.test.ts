import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentLogger } from './index.js';

const MACHINE_ID = '33333333-3333-4333-8333-333333333333';

type FetchStub = { urls: string[]; fetchImpl: typeof globalThis.fetch };

function createFetchStub(): FetchStub {
  const urls: string[] = [];
  const fetchImpl: typeof globalThis.fetch = async (input) => {
    urls.push(typeof input === 'string' ? input : String(input));
    return new Response(JSON.stringify({ ok: true, inserted: 1 }), { status: 200 });
  };
  return { urls, fetchImpl };
}

function createLogsDir(): string {
  return mkdtempSync(join(tmpdir(), 'agent-logger-factory-'));
}

describe('createAgentLogger', () => {
  it('sends entries on to Agent Panel once the machine is paired', async () => {
    const panel = createFetchStub();
    const logger = createAgentLogger({
      logsDir: createLogsDir(),
      machineId: MACHINE_ID,
      panelUrl: 'https://panel.example.com',
      panelApiKey: 'machine-credential',
      fetchImpl: panel.fetchImpl,
    });

    logger.append({ agentId: 'weekly-report', runId: 'run-1', message: 'Wrote the report' });
    await logger.shutdown();

    expect(panel.urls).toEqual(['https://panel.example.com/api/runs/run-1/logs']);
  });

  it('keeps entries local when the panel is not configured', async () => {
    const panel = createFetchStub();
    const logger = createAgentLogger({
      logsDir: createLogsDir(),
      machineId: MACHINE_ID,
      fetchImpl: panel.fetchImpl,
    });

    logger.append({ agentId: 'weekly-report', runId: 'run-1', message: 'Wrote the report' });
    await logger.shutdown();

    expect(panel.urls).toEqual([]);
  });

  it('keeps entries local until the machine is paired, because logs are addressed by machine', async () => {
    const panel = createFetchStub();
    const logger = createAgentLogger({
      logsDir: createLogsDir(),
      panelUrl: 'https://panel.example.com',
      panelApiKey: 'organization-key',
      fetchImpl: panel.fetchImpl,
    });

    logger.append({ agentId: 'weekly-report', runId: 'run-1', message: 'Wrote the report' });
    await logger.shutdown();

    expect(panel.urls).toEqual([]);
  });

  it('reads back what it just wrote, whatever the panel is doing', async () => {
    const logger = createAgentLogger({
      logsDir: createLogsDir(),
      machineId: MACHINE_ID,
      panelUrl: 'https://panel.example.com',
      panelApiKey: 'machine-credential',
      fetchImpl: async () => new Response('nope', { status: 500 }),
    });

    logger.append({ agentId: 'weekly-report', runId: 'run-1', message: 'Wrote the report' });

    expect(logger.readRun({ agentId: 'weekly-report', runId: 'run-1' }).map((e) => e.message))
      .toEqual(['Wrote the report']);
    await logger.shutdown();
  });
});
