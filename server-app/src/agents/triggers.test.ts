import { describe, it, expect } from 'vitest';
import { evaluateTriggers } from './triggers.js';
import { makeAgent } from '../test-factories.js';

describe('evaluateTriggers', () => {
  it('returns agents triggered by on_complete of source agent', () => {
    const agents = [
      makeAgent({ id: 'source' }),
      makeAgent({ id: 'downstream', on_complete: [{ agent: 'source' }] }),
      makeAgent({ id: 'unrelated' }),
    ];

    const triggered = evaluateTriggers(agents, 'source', 'completed');
    expect(triggered.map((a) => a.id)).toEqual(['downstream']);
  });

  it('returns empty array when no triggers match', () => {
    const agents = [
      makeAgent({ id: 'source' }),
      makeAgent({ id: 'other' }),
    ];

    const triggered = evaluateTriggers(agents, 'source', 'completed');
    expect(triggered).toEqual([]);
  });

  it('does not trigger on failure by default', () => {
    const agents = [
      makeAgent({ id: 'downstream', on_complete: [{ agent: 'source' }] }),
    ];

    const triggered = evaluateTriggers(agents, 'source', 'failed');
    expect(triggered).toEqual([]);
  });

  it('triggers on failure when on_failure is specified', () => {
    const agents = [
      makeAgent({ id: 'alerter', on_failure: [{ agent: 'source' }] }),
    ];

    const triggered = evaluateTriggers(agents, 'source', 'failed');
    expect(triggered.map((a) => a.id)).toEqual(['alerter']);
  });

  it('supports multiple trigger sources', () => {
    const agents = [
      makeAgent({ id: 'aggregator', on_complete: [{ agent: 'source-a' }, { agent: 'source-b' }] }),
    ];

    expect(evaluateTriggers(agents, 'source-a', 'completed').map((a) => a.id)).toEqual(['aggregator']);
    expect(evaluateTriggers(agents, 'source-b', 'completed').map((a) => a.id)).toEqual(['aggregator']);
    expect(evaluateTriggers(agents, 'source-c', 'completed')).toEqual([]);
  });

  it('does not trigger disabled agents', () => {
    const agents = [
      makeAgent({ id: 'downstream', enabled: false, on_complete: [{ agent: 'source' }] }),
    ];

    const triggered = evaluateTriggers(agents, 'source', 'completed');
    expect(triggered).toEqual([]);
  });
});
