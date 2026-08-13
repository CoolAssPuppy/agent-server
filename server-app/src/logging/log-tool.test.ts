import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentLogStore } from './log-store.js';
import { AGENT_LOG_TOOL_NAME, writeAgentLog } from './log-tool.js';

function createContext(overrides: { maxBytes?: number } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'log-tool-'));
  const store = new AgentLogStore({
    root, machineId: 'machine-uuid', hostname: 'test-mac', ...overrides,
  });
  return { root, store, context: { store, agentId: 'daily-focus', runId: 'run-1' } };
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((entry) => entry.text ?? '').join('\n');
}

describe('agent log tool', () => {
  it('is named so an allowlist can refer to it', () => {
    expect(AGENT_LOG_TOOL_NAME).toBe('mcp__agent_log__write_log');
  });

  it('records what the agent logged against its own run', async () => {
    const { store, context } = createContext();

    const result = await writeAgentLog(context, { message: 'Notion write failed', level: 'error' });

    expect(result.isError).toBeFalsy();
    expect(store.readRun({ agentId: 'daily-focus', runId: 'run-1' })).toMatchObject([
      { message: 'Notion write failed', level: 'error', run_id: 'run-1' },
    ]);
  });

  it('keeps an undeliverable document as the entry body', async () => {
    const { store, context } = createContext();

    await writeAgentLog(context, { message: 'Unsent page', body: '# Report\n' });

    expect(store.readRun({ agentId: 'daily-focus', runId: 'run-1' })[0].body).toBe('# Report\n');
  });

  it('reports the size limit back to the agent instead of throwing', async () => {
    const { context } = createContext({ maxBytes: 64 });

    const result = await writeAgentLog(context, { message: 'big', body: 'x'.repeat(200) });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('shorter');
  });

  it('refuses an empty message rather than writing a blank entry', async () => {
    const { store, context } = createContext();

    const result = await writeAgentLog(context, { message: '   ' });

    expect(result.isError).toBe(true);
    expect(store.readRun({ agentId: 'daily-focus', runId: 'run-1' })).toEqual([]);
  });
});
