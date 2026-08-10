import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { createApi } from './api.js';
import { RunStore } from '../reporting/store.js';
import { makeAgent, makeStoredRun } from '../test-factories.js';
import { createAnalysisApi } from '../analysis/security-api.js';
import { SecurityAnalysisService } from '../analysis/security-service.js';
import { SqliteSecurityReviewStore } from '../analysis/review-store.js';
import { InMemoryAgentContentRepository, StructuredPatchService } from '../analysis/patch.js';
import { parseAgentFile } from '../agents/config.js';

/**
 * The wire contract between this server and the macOS app.
 *
 * Each fixture in contracts/ is the JSON one route really answers. This test
 * proves the server still answers that shape; the Swift side proves the app's
 * models still read it (ContractFixtureTests). A field rename on either side
 * fails CI instead of failing on somebody's Mac as "The data couldn't be
 * read" -- which is how the pairing confirmation shipped broken.
 *
 * Values are free to differ; the contract is the key structure. To update
 * after an intentional change: UPDATE_CONTRACTS=1 pnpm test -- contract
 */

const CONTRACTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../contracts');
const UPDATE = process.env.UPDATE_CONTRACTS === '1';

const API_KEY = 'contract-test-key-1234567890';

/** Recursive key-and-type structure; values are erased. */
function shapeOf(value: unknown): unknown {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    // The first element speaks for the array. Fixtures keep arrays non-empty
    // so there is always an element to speak.
    return value.length === 0 ? ['empty'] : [shapeOf(value[0])];
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, shapeOf(entry)]),
    );
  }
  return typeof value;
}

function checkAgainstFixture(name: string, actual: unknown): void {
  const path = join(CONTRACTS_DIR, `${name}.json`);
  if (UPDATE || !existsSync(path)) {
    mkdirSync(CONTRACTS_DIR, { recursive: true });
    writeFileSync(path, `${JSON.stringify(actual, null, 2)}\n`);
    return;
  }
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  expect(shapeOf(actual), `contracts/${name}.json no longer matches the route`)
    .toEqual(shapeOf(fixture));
}

async function authed(app: Hono, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('x-agent-server-key', API_KEY);
  return app.request(path, { ...init, headers });
}

function createSeededApp(): Hono {
  const store = new RunStore();
  // Every optional field populated, so the fixture carries the full shape.
  store.add(makeStoredRun({
    runId: 'run-contract',
    agentId: 'test-agent',
    status: 'completed',
    completedAt: new Date('2026-08-10T06:05:00.000Z'),
    summary: 'Did the thing.',
    error: 'A recoverable warning.',
    code: 'example_code',
    toolsUsed: ['Read'],
    filesRead: ['/tmp/read.txt'],
    filesWritten: ['/tmp/wrote.txt'],
    commandsRun: ['echo hello'],
    progressMessages: ['Working'],
    trigger: 'schedule',
    model: 'claude-opus-5',
    inputTokens: 100,
    outputTokens: 50,
    estimatedCostUsd: 0.01,
    durationMs: 300_000,
    conversationId: 'c0ffee00-0000-4000-8000-000000000001',
  }));

  return createApi({
    apiKey: API_KEY,
    getAgents: async () => [makeAgent()],
    store,
    triggerRun: async () => 'run-contract',
    cancelRun: () => false,
    cleanupFn: async () => 2,
    machineId: '9f1f3c2a-0000-4000-8000-9f1f3c2a0002',
    startedAt: '2026-08-10T06:00:00.000Z',
    panelHealth: () => ({
      state: 'failing',
      last_success_at: '2026-08-10T06:00:00.000Z',
      last_failure_at: '2026-08-10T06:09:00.000Z',
      last_failure: 'HTTP 401',
      consecutive_failures: 3,
    }),
    getPairing: () => ({
      credential: 'ap_live_contract_fixture_only',
      orgId: '9f1f3c2a-0000-4000-8000-9f1f3c2a0001',
      machineId: '9f1f3c2a-0000-4000-8000-9f1f3c2a0002',
      displayName: 'Contract Mac',
      pairedAt: '2026-08-10T06:11:20.322Z',
      heartbeatIntervalSeconds: 60,
    }),
    pairedCredentialInUse: true,
    pairWithPanel: async () => ({ ok: true, displayName: 'Contract Mac' }),
  });
}

describe('wire contract fixtures', () => {
  it('GET /health answers the health contract', async () => {
    const body = await (await createSeededApp().request('/health')).json();
    checkAgainstFixture('health', body);
  });

  it('GET /machine answers the machine contract', async () => {
    const body = await (await authed(createSeededApp(), '/machine')).json();
    checkAgainstFixture('machine', body);
  });

  it('GET /pair answers the pairing status contract', async () => {
    const body = await (await authed(createSeededApp(), '/pair')).json();
    checkAgainstFixture('pair-status', body);
    // The one field that must never appear, whatever else changes.
    expect(JSON.stringify(body)).not.toContain('ap_live');
  });

  it('POST /pair answers the redeem contract', async () => {
    const body = await (await authed(createSeededApp(), '/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ABCDEFGH' }),
    })).json();
    checkAgainstFixture('pair-redeem', body);
  });

  it('POST /agents/:id/run answers the trigger contract', async () => {
    const body = await (await authed(createSeededApp(), '/agents/test-agent/run', {
      method: 'POST',
    })).json();
    checkAgainstFixture('trigger-run', body);
  });

  it('POST /cleanup answers the cleanup contract', async () => {
    const body = await (await authed(createSeededApp(), '/cleanup', { method: 'POST' })).json();
    checkAgainstFixture('cleanup', body);
  });

  it('GET /runs/:id answers the run contract', async () => {
    const body = await (await authed(createSeededApp(), '/runs/run-contract')).json();
    checkAgainstFixture('run', body);
  });

  it('GET /security/agents/:id answers the security analysis contract', async () => {
    const content = `---
id: reader
name: Reader
tools: [Read, Bash]
codex_sandbox: workspace-write
---
Review notes with a local command.
`;
    const repository = new InMemoryAgentContentRepository({ reader: content });
    const reviewStore = new SqliteSecurityReviewStore({ path: ':memory:' });
    const security = new SecurityAnalysisService({ reviewStore, homeDir: '/Users/example' });
    const app = new Hono();
    app.route('/', createAnalysisApi({
      security,
      patches: new StructuredPatchService(repository),
      content: {
        get: async (id) => ({
          content: await repository.read(id),
          agent: parseAgentFile(await repository.read(id)),
        }),
        list: async () => [],
      },
    }));

    const body = await (await app.request('/security/agents/reader')).json();
    checkAgainstFixture('security-analysis', body);
    reviewStore.close();
  });
});
