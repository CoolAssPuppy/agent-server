import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentLogStore } from './log-store.js';
import { AGENT_LOG_READ_TOOL_NAME, readAgentLog } from './log-read-tool.js';

function createContext() {
  const root = mkdtempSync(join(tmpdir(), 'log-read-'));
  const store = new AgentLogStore({ root, machineId: 'machine-uuid', hostname: 'test-mac' });
  return { store, context: { store, agentId: 'daily-manuscript-review', runId: 'run-2' } };
}

function parse(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown>[] {
  return JSON.parse(result.content.map((entry) => entry.text ?? '').join('')) as Record<string, unknown>[];
}

describe('agent log read tool', () => {
  it('is named so an allowlist can refer to it', () => {
    expect(AGENT_LOG_READ_TOOL_NAME).toBe('mcp__agent_log__read_log');
  });

  it('returns this agent entries newest first so a run can find its last state', async () => {
    const { store, context } = createContext();
    store.append({
      agentId: 'daily-manuscript-review', runId: 'run-1', message: 'Manuscript hash', data: { hash: 'aaa' },
    });
    store.append({
      agentId: 'daily-manuscript-review', runId: 'run-2', message: 'Manuscript hash', data: { hash: 'bbb' },
    });

    const entries = parse(await readAgentLog(context, {}));

    expect(entries.map((entry) => entry.hash)).toEqual(['bbb', 'aaa']);
  });

  it('matches entries by message so an agent can ask for one kind of record', async () => {
    const { store, context } = createContext();
    store.append({ agentId: 'daily-manuscript-review', runId: 'run-1', message: 'Manuscript hash', data: { hash: 'aaa' } });
    store.append({ agentId: 'daily-manuscript-review', runId: 'run-1', message: 'Run completed', source: 'server' });

    const entries = parse(await readAgentLog(context, { messageContains: 'hash' }));

    expect(entries).toHaveLength(1);
    expect(entries[0].hash).toBe('aaa');
  });

  it('honors a limit and caps how much a run can pull back', async () => {
    const { store, context } = createContext();
    for (let index = 0; index < 10; index += 1) {
      store.append({ agentId: 'daily-manuscript-review', runId: 'run-1', message: `entry ${index}` });
    }

    expect(parse(await readAgentLog(context, { limit: 3 }))).toHaveLength(3);
  });

  it('never returns another agent entries', async () => {
    const { store, context } = createContext();
    store.append({ agentId: 'other-agent', runId: 'run-9', message: 'not yours' });

    expect(parse(await readAgentLog(context, {}))).toEqual([]);
  });

  it('leaves out the long body unless it is asked for', async () => {
    const { store, context } = createContext();
    store.append({
      agentId: 'daily-manuscript-review', runId: 'run-1', message: 'Unsent page', body: '# Long draft',
    });

    expect(parse(await readAgentLog(context, {}))[0].body).toBeUndefined();
    expect(parse(await readAgentLog(context, { includeBody: true }))[0].body).toBe('# Long draft');
  });
});
