import { describe, it, expect, vi } from 'vitest';
import { evaluateTriggers, type TriggerConfig } from './triggers.js';
import type { AgentConfig } from './agent-config.js';

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    schedule: '* * * * *',
    prompt: 'Do something.',
    tools: [],
    max_turns: 20,
    enabled: true,
    ...overrides,
  };
}

describe('evaluateTriggers', () => {
  it('returns agents triggered by on_complete of source agent', () => {
    const agents: AgentConfig[] = [
      makeAgent({ id: 'source' }),
      makeAgent({
        id: 'downstream',
        on_complete: [{ agent: 'source' }],
      }),
      makeAgent({ id: 'unrelated' }),
    ];

    const triggered = evaluateTriggers(agents, 'source', 'completed');
    expect(triggered.map((a) => a.id)).toEqual(['downstream']);
  });

  it('returns empty array when no triggers match', () => {
    const agents: AgentConfig[] = [
      makeAgent({ id: 'source' }),
      makeAgent({ id: 'other' }),
    ];

    const triggered = evaluateTriggers(agents, 'source', 'completed');
    expect(triggered).toEqual([]);
  });

  it('does not trigger on failure by default', () => {
    const agents: AgentConfig[] = [
      makeAgent({
        id: 'downstream',
        on_complete: [{ agent: 'source' }],
      }),
    ];

    const triggered = evaluateTriggers(agents, 'source', 'failed');
    expect(triggered).toEqual([]);
  });

  it('triggers on failure when on_failure is specified', () => {
    const agents: AgentConfig[] = [
      makeAgent({
        id: 'alerter',
        on_failure: [{ agent: 'source' }],
      }),
    ];

    const triggered = evaluateTriggers(agents, 'source', 'failed');
    expect(triggered.map((a) => a.id)).toEqual(['alerter']);
  });

  it('supports multiple trigger sources', () => {
    const agents: AgentConfig[] = [
      makeAgent({
        id: 'aggregator',
        on_complete: [{ agent: 'source-a' }, { agent: 'source-b' }],
      }),
    ];

    expect(evaluateTriggers(agents, 'source-a', 'completed').map((a) => a.id)).toEqual(['aggregator']);
    expect(evaluateTriggers(agents, 'source-b', 'completed').map((a) => a.id)).toEqual(['aggregator']);
    expect(evaluateTriggers(agents, 'source-c', 'completed')).toEqual([]);
  });

  it('does not trigger disabled agents', () => {
    const agents: AgentConfig[] = [
      makeAgent({
        id: 'downstream',
        enabled: false,
        on_complete: [{ agent: 'source' }],
      }),
    ];

    const triggered = evaluateTriggers(agents, 'source', 'completed');
    expect(triggered).toEqual([]);
  });
});
