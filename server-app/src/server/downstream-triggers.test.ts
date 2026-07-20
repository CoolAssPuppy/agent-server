import { describe, expect, it, vi } from 'vitest';

import type { AgentConfig } from '../agents/config.js';
import { makeAgent } from '../test-factories.js';
import { createDownstreamTriggerHandler } from './downstream-triggers.js';

const MAX_TRIGGER_DEPTH = 10;

function createHandler(
  agents: AgentConfig[],
  trigger = vi.fn(),
  logError?: (message: string, error: unknown) => void,
) {
  return {
    handler: createDownstreamTriggerHandler({
      discover: vi.fn().mockResolvedValue(agents),
      trigger,
      maxDepth: MAX_TRIGGER_DEPTH,
      logError,
    }),
    trigger,
  };
}

describe('createDownstreamTriggerHandler', () => {
  it('triggers downstream agents on completion with the propagated chain', async () => {
    const downstream = makeAgent({ id: 'downstream' });
    const { handler, trigger } = createHandler([
      makeAgent({ id: 'source', on_complete: [{ agent: 'downstream' }] }),
      downstream,
      makeAgent({ id: 'unrelated' }),
    ]);

    await handler(makeAgent({ id: 'source' }), 'completed');

    expect(trigger).toHaveBeenCalledOnce();
    expect(trigger).toHaveBeenCalledWith(
      downstream,
      expect.objectContaining({ visitedAgentIds: ['source', 'downstream'] }),
    );
  });

  it('triggers failure targets', async () => {
    const alerter = makeAgent({ id: 'alerter' });
    const { handler, trigger } = createHandler([
      makeAgent({ id: 'source', on_failure: [{ agent: 'alerter' }] }),
      alerter,
    ]);

    await handler(makeAgent({ id: 'source' }), 'failed');

    expect(trigger).toHaveBeenCalledWith(alerter, expect.any(Object));
  });

  it('does nothing when no downstream agents match', async () => {
    const { handler, trigger } = createHandler([
      makeAgent({ id: 'source' }),
      makeAgent({ id: 'other' }),
    ]);

    await handler(makeAgent({ id: 'source' }), 'completed');

    expect(trigger).not.toHaveBeenCalled();
  });

  it('reports discovery errors without triggering agents', async () => {
    const trigger = vi.fn();
    const logError = vi.fn();
    const handler = createDownstreamTriggerHandler({
      discover: vi.fn().mockRejectedValue(new Error('disk failure')),
      trigger,
      maxDepth: MAX_TRIGGER_DEPTH,
      logError,
    });

    await handler(makeAgent({ id: 'source' }), 'completed');

    expect(trigger).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      '[triggers] Failed to evaluate triggers for source:',
      expect.any(Error),
    );
  });

  it('triggers every matching target', async () => {
    const notifier = makeAgent({ id: 'notifier' });
    const reporter = makeAgent({ id: 'reporter' });
    const { handler, trigger } = createHandler([
      makeAgent({
        id: 'source',
        on_complete: [{ agent: 'notifier' }, { agent: 'reporter' }],
      }),
      notifier,
      reporter,
    ]);

    await handler(makeAgent({ id: 'source' }), 'completed');

    expect(trigger).toHaveBeenCalledTimes(2);
    expect(trigger).toHaveBeenCalledWith(notifier, expect.any(Object));
    expect(trigger).toHaveBeenCalledWith(reporter, expect.any(Object));
  });

  it('continues triggering independent targets after one target fails', async () => {
    const first = makeAgent({ id: 'first' });
    const second = makeAgent({ id: 'second' });
    const trigger = vi.fn()
      .mockRejectedValueOnce(new Error('first failed'))
      .mockResolvedValueOnce(undefined);
    const logError = vi.fn();
    const { handler } = createHandler([
      makeAgent({
        id: 'source',
        on_complete: [{ agent: 'first' }, { agent: 'second' }],
      }),
      first,
      second,
    ], trigger, logError);

    await handler(makeAgent({ id: 'source' }), 'completed');

    expect(trigger).toHaveBeenCalledTimes(2);
    expect(trigger).toHaveBeenNthCalledWith(1, first, expect.any(Object));
    expect(trigger).toHaveBeenNthCalledWith(2, second, expect.any(Object));
    expect(logError).toHaveBeenCalledWith(
      '[triggers] Failed to trigger first from source:',
      expect.any(Error),
    );
  });
});
