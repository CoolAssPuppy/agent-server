import { describe, expect, it } from 'vitest';
import { makeAgent } from '../test-factories.js';
import {
  createTriggerChain,
  evaluateSafeTriggers,
  evaluateTriggers,
} from './triggers.js';

describe('outgoing agent triggers', () => {
  it('resolves the targets declared by the completed source agent', () => {
    const agents = [
      makeAgent({ id: 'source', on_complete: [{ agent: 'downstream' }] }),
      makeAgent({ id: 'downstream' }),
      makeAgent({ id: 'unrelated' }),
    ];

    expect(evaluateTriggers(agents, 'source', 'completed').map((agent) => agent.id))
      .toEqual(['downstream']);
  });

  it('uses the source agent failure targets only after failure', () => {
    const agents = [
      makeAgent({
        id: 'source',
        on_complete: [{ agent: 'success-handler' }],
        on_failure: [{ agent: 'failure-handler' }],
      }),
      makeAgent({ id: 'success-handler' }),
      makeAgent({ id: 'failure-handler' }),
    ];

    expect(evaluateTriggers(agents, 'source', 'failed').map((agent) => agent.id))
      .toEqual(['failure-handler']);
  });

  it('ignores missing and disabled targets', () => {
    const agents = [
      makeAgent({
        id: 'source',
        on_complete: [{ agent: 'missing' }, { agent: 'disabled' }],
      }),
      makeAgent({ id: 'disabled', enabled: false }),
    ];

    expect(evaluateTriggers(agents, 'source', 'completed')).toEqual([]);
  });

  it('returns no targets when the source agent cannot be found', () => {
    expect(evaluateTriggers([makeAgent({ id: 'other' })], 'missing', 'completed'))
      .toEqual([]);
  });

  it('deduplicates repeated target references while preserving declaration order', () => {
    const agents = [
      makeAgent({
        id: 'source',
        on_complete: [
          { agent: 'second' },
          { agent: 'first' },
          { agent: 'second' },
        ],
      }),
      makeAgent({ id: 'first' }),
      makeAgent({ id: 'second' }),
    ];

    expect(evaluateTriggers(agents, 'source', 'completed').map((agent) => agent.id))
      .toEqual(['second', 'first']);
  });
});

describe('safe trigger chains', () => {
  it('creates child contexts with a stable chain ID and accumulated ancestry', () => {
    const sourceChain = createTriggerChain('source', 'chain-1');
    const agents = [
      makeAgent({ id: 'source', on_complete: [{ agent: 'downstream' }] }),
      makeAgent({ id: 'downstream' }),
    ];

    expect(evaluateSafeTriggers(agents, 'source', 'completed', sourceChain, 5))
      .toEqual({
        fired: [{
          agent: agents[1],
          chain: {
            id: 'chain-1',
            visitedAgentIds: ['source', 'downstream'],
            depth: 1,
          },
        }],
        refused: [],
      });
  });

  it('rejects a self-trigger', () => {
    const source = makeAgent({ id: 'source', on_complete: [{ agent: 'source' }] });

    expect(evaluateSafeTriggers(
      [source],
      source.id,
      'completed',
      createTriggerChain(source.id, 'chain-1'),
      5,
    )).toEqual({
      fired: [],
      refused: [{ agent: source, reason: 'cycle' }],
    });
  });

  it('rejects a target already visited by the current branch', () => {
    const agents = [
      makeAgent({ id: 'agent-b', on_complete: [{ agent: 'agent-a' }] }),
      makeAgent({ id: 'agent-a' }),
    ];
    const chain = {
      id: 'chain-1',
      visitedAgentIds: ['agent-a', 'agent-b'],
      depth: 1,
    };

    expect(evaluateSafeTriggers(agents, 'agent-b', 'completed', chain, 5)).toEqual({
      fired: [],
      refused: [{ agent: agents[1], reason: 'cycle' }],
    });
  });

  it('stops before launching an edge beyond the maximum depth', () => {
    const agents = [
      makeAgent({ id: 'agent-b', on_complete: [{ agent: 'agent-c' }] }),
      makeAgent({ id: 'agent-c' }),
    ];
    const chain = {
      id: 'chain-1',
      visitedAgentIds: ['agent-a', 'agent-b'],
      depth: 1,
    };

    // Named as a depth refusal, not dropped: the silent version of this is
    // a chain whose tail never happens with nothing anywhere saying so.
    expect(evaluateSafeTriggers(agents, 'agent-b', 'completed', chain, 1)).toEqual({
      fired: [],
      refused: [{ agent: agents[1], reason: 'depth_limit' }],
    });
  });

  it('allows the edge that reaches the configured maximum depth', () => {
    const agents = [
      makeAgent({ id: 'agent-b', on_complete: [{ agent: 'agent-c' }] }),
      makeAgent({ id: 'agent-c' }),
    ];
    const chain = {
      id: 'chain-1',
      visitedAgentIds: ['agent-a', 'agent-b'],
      depth: 1,
    };

    expect(evaluateSafeTriggers(agents, 'agent-b', 'completed', chain, 2).fired[0]?.chain)
      .toEqual({
        id: 'chain-1',
        visitedAgentIds: ['agent-a', 'agent-b', 'agent-c'],
        depth: 2,
      });
  });
});
