import { describe, it, expect, vi } from 'vitest';
import { evaluateTriggers } from '../agents/triggers.js';
import { makeAgent } from '../test-factories.js';
import type { AgentConfig } from '../agents/config.js';
import { shouldSendTelegramRunNotification } from './server.js';

describe('fireDownstreamTriggers', () => {
  async function fireDownstreamTriggers(
    sourceAgentId: string,
    status: 'completed' | 'failed',
    discover: () => Promise<AgentConfig[]>,
    trigger: (agent: AgentConfig) => void,
  ): Promise<void> {
    try {
      const agents = await discover();
      const downstream = evaluateTriggers(agents, sourceAgentId, status);
      for (const agent of downstream) {
        trigger(agent);
      }
    } catch (err) {
      console.error(`[triggers] Failed to evaluate triggers for ${sourceAgentId}:`, err);
    }
  }

  it('triggers downstream agents on completion', async () => {
    const downstream = makeAgent({ id: 'downstream', on_complete: [{ agent: 'source' }] });
    const discover = vi.fn().mockResolvedValue([
      makeAgent({ id: 'source' }),
      downstream,
      makeAgent({ id: 'unrelated' }),
    ]);
    const trigger = vi.fn();

    await fireDownstreamTriggers('source', 'completed', discover, trigger);

    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith(downstream);
  });

  it('triggers on_failure agents when run fails', async () => {
    const alerter = makeAgent({ id: 'alerter', on_failure: [{ agent: 'source' }] });
    const discover = vi.fn().mockResolvedValue([
      makeAgent({ id: 'source' }),
      alerter,
    ]);
    const trigger = vi.fn();

    await fireDownstreamTriggers('source', 'failed', discover, trigger);

    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith(alerter);
  });

  it('does not trigger when no downstream agents match', async () => {
    const discover = vi.fn().mockResolvedValue([
      makeAgent({ id: 'source' }),
      makeAgent({ id: 'other' }),
    ]);
    const trigger = vi.fn();

    await fireDownstreamTriggers('source', 'completed', discover, trigger);

    expect(trigger).not.toHaveBeenCalled();
  });

  it('handles discovery errors gracefully without crashing', async () => {
    const discover = vi.fn().mockRejectedValue(new Error('disk failure'));
    const trigger = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await fireDownstreamTriggers('source', 'completed', discover, trigger);

    expect(trigger).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[triggers]'),
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it('triggers multiple downstream agents', async () => {
    const d1 = makeAgent({ id: 'notifier', on_complete: [{ agent: 'source' }] });
    const d2 = makeAgent({ id: 'reporter', on_complete: [{ agent: 'source' }] });
    const discover = vi.fn().mockResolvedValue([
      makeAgent({ id: 'source' }),
      d1,
      d2,
    ]);
    const trigger = vi.fn();

    await fireDownstreamTriggers('source', 'completed', discover, trigger);

    expect(trigger).toHaveBeenCalledTimes(2);
    expect(trigger).toHaveBeenCalledWith(d1);
    expect(trigger).toHaveBeenCalledWith(d2);
  });
});

describe('shouldSendTelegramRunNotification', () => {
  it('returns false when completion notification is already configured for telegram', () => {
    const agent = makeAgent({
      notification: {
        channel: 'telegram',
        on_complete: true,
        on_failure: false,
      },
    });

    expect(shouldSendTelegramRunNotification(agent, 'completed')).toBe(false);
  });

  it('returns true when failure notification is not configured for telegram', () => {
    const agent = makeAgent({
      notification: {
        channel: 'telegram',
        on_complete: true,
        on_failure: false,
      },
    });

    expect(shouldSendTelegramRunNotification(agent, 'failed')).toBe(true);
  });

  it('returns true when notification channel is not telegram', () => {
    const agent = makeAgent({
      notification: {
        channel: 'console',
        on_complete: true,
        on_failure: true,
      },
    });

    expect(shouldSendTelegramRunNotification(agent, 'completed')).toBe(true);
  });
});
