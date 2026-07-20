import { describe, it, expect, vi } from 'vitest';
import { makeAgent } from '../test-factories.js';
import { createDownstreamTriggerHandler } from './downstream-triggers.js';
import {
  chatKeyFromString,
  extractMcpNeedsAuthServers,
  shouldDispatchNotification,
  shouldSendChannelRunNotification,
  shouldSendTelegramRunNotification,
} from './server.js';

describe('fireDownstreamTriggers', () => {
  it('triggers downstream agents on completion', async () => {
    const downstream = makeAgent({ id: 'downstream' });
    const discover = vi.fn().mockResolvedValue([
      makeAgent({ id: 'source', on_complete: [{ agent: 'downstream' }] }),
      downstream,
      makeAgent({ id: 'unrelated' }),
    ]);
    const trigger = vi.fn();
    const fireDownstreamTriggers = createDownstreamTriggerHandler({
      discover,
      trigger,
      maxDepth: 10,
    });

    await fireDownstreamTriggers(makeAgent({
      id: 'source',
      on_complete: [{ agent: 'downstream' }],
    }), 'completed');

    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith(
      downstream,
      expect.objectContaining({ visitedAgentIds: ['source', 'downstream'] }),
    );
  });

  it('triggers on_failure agents when run fails', async () => {
    const alerter = makeAgent({ id: 'alerter' });
    const discover = vi.fn().mockResolvedValue([
      makeAgent({ id: 'source', on_failure: [{ agent: 'alerter' }] }),
      alerter,
    ]);
    const trigger = vi.fn();
    const fireDownstreamTriggers = createDownstreamTriggerHandler({ discover, trigger, maxDepth: 10 });

    await fireDownstreamTriggers(makeAgent({
      id: 'source',
      on_failure: [{ agent: 'alerter' }],
    }), 'failed');

    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith(alerter, expect.any(Object));
  });

  it('does not trigger when no downstream agents match', async () => {
    const discover = vi.fn().mockResolvedValue([
      makeAgent({ id: 'source' }),
      makeAgent({ id: 'other' }),
    ]);
    const trigger = vi.fn();
    const fireDownstreamTriggers = createDownstreamTriggerHandler({ discover, trigger, maxDepth: 10 });

    await fireDownstreamTriggers(makeAgent({ id: 'source' }), 'completed');

    expect(trigger).not.toHaveBeenCalled();
  });

  it('handles discovery errors gracefully without crashing', async () => {
    const discover = vi.fn().mockRejectedValue(new Error('disk failure'));
    const trigger = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fireDownstreamTriggers = createDownstreamTriggerHandler({ discover, trigger, maxDepth: 10 });

    await fireDownstreamTriggers(makeAgent({ id: 'source' }), 'completed');

    expect(trigger).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[triggers]'),
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it('triggers multiple downstream agents', async () => {
    const d1 = makeAgent({ id: 'notifier' });
    const d2 = makeAgent({ id: 'reporter' });
    const discover = vi.fn().mockResolvedValue([
      makeAgent({
        id: 'source',
        on_complete: [{ agent: 'notifier' }, { agent: 'reporter' }],
      }),
      d1,
      d2,
    ]);
    const trigger = vi.fn();
    const fireDownstreamTriggers = createDownstreamTriggerHandler({ discover, trigger, maxDepth: 10 });

    await fireDownstreamTriggers(makeAgent({
      id: 'source',
      on_complete: [{ agent: 'notifier' }, { agent: 'reporter' }],
    }), 'completed');

    expect(trigger).toHaveBeenCalledTimes(2);
    expect(trigger).toHaveBeenCalledWith(d1, expect.any(Object));
    expect(trigger).toHaveBeenCalledWith(d2, expect.any(Object));
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

describe('shouldSendChannelRunNotification', () => {
  it('suppresses only the channel the agent already notifies on', () => {
    const agent = makeAgent({
      notification: { channel: 'slack', on_complete: true, on_failure: true },
    });
    // Slack notification is already configured, so the ad-hoc run stays quiet.
    expect(shouldSendChannelRunNotification(agent, 'completed', 'slack')).toBe(false);
    // A different channel is unaffected.
    expect(shouldSendChannelRunNotification(agent, 'completed', 'telegram')).toBe(true);
  });

  it('always closes the originating channel when a run is skipped', () => {
    const agent = makeAgent({
      notification: { channel: 'slack', on_complete: true, on_failure: true },
    });

    expect(shouldSendChannelRunNotification(agent, 'skipped', 'slack')).toBe(true);
  });
});

describe('chatKeyFromString', () => {
  it('is deterministic and positive', () => {
    expect(chatKeyFromString('D123')).toBe(chatKeyFromString('D123'));
    expect(chatKeyFromString('D123')).toBeGreaterThanOrEqual(0);
  });

  it('separates distinct channel ids', () => {
    expect(chatKeyFromString('D123')).not.toBe(chatKeyFromString('D999'));
  });
});

describe('shouldDispatchNotification', () => {
  const notifyingAgent = makeAgent({
    id: 'silent-agent',
    notification: {
      channel: 'telegram',
      on_complete: true,
      on_failure: true,
    },
  });

  it('suppresses completion notifications when summary is the empty-fallback string', () => {
    expect(
      shouldDispatchNotification(notifyingAgent, {
        status: 'completed',
        summary: 'Agent completed',
      }),
    ).toBe(false);
  });

  it('dispatches completion notifications when summary contains real content', () => {
    expect(
      shouldDispatchNotification(notifyingAgent, {
        status: 'completed',
        summary: '🔔 Proactive Work Update\n\nCreated 2 drafts.',
      }),
    ).toBe(true);
  });

  it('dispatches failure notifications even when the error string matches the fallback', () => {
    expect(
      shouldDispatchNotification(notifyingAgent, {
        status: 'failed',
        summary: 'Agent completed',
        error: 'Agent completed',
      }),
    ).toBe(true);
  });

  it('returns false when the agent has no notification config', () => {
    const agent = makeAgent({ id: 'quiet-agent' });
    expect(
      shouldDispatchNotification(agent, {
        status: 'completed',
        summary: 'Found work.',
      }),
    ).toBe(false);
  });

  it('does not send configured failure notifications for a skipped overlap', () => {
    expect(shouldDispatchNotification(notifyingAgent, {
      status: 'skipped',
      summary: 'Already running',
    })).toBe(false);
  });

  it('returns false when on_complete is disabled even for real content', () => {
    const agent = makeAgent({
      notification: {
        channel: 'telegram',
        on_complete: false,
        on_failure: true,
      },
    });
    expect(
      shouldDispatchNotification(agent, {
        status: 'completed',
        summary: 'Found work.',
      }),
    ).toBe(false);
  });

  it('returns false when on_failure is disabled even for failures', () => {
    const agent = makeAgent({
      notification: {
        channel: 'telegram',
        on_complete: true,
        on_failure: false,
      },
    });
    expect(
      shouldDispatchNotification(agent, {
        status: 'failed',
        error: 'MCP server unreachable',
      }),
    ).toBe(false);
  });

  it('dispatches completion notifications when the summary is undefined but on_complete is true', () => {
    expect(
      shouldDispatchNotification(notifyingAgent, {
        status: 'completed',
        summary: undefined,
      }),
    ).toBe(true);
  });
});

describe('extractMcpNeedsAuthServers', () => {
  it('returns empty when metadata is missing', () => {
    expect(extractMcpNeedsAuthServers(undefined)).toEqual([]);
  });

  it('returns empty when mcp_servers is absent or not an array', () => {
    expect(extractMcpNeedsAuthServers({})).toEqual([]);
    expect(extractMcpNeedsAuthServers({ mcp_servers: 'oops' })).toEqual([]);
  });

  it('returns only the names of servers that report needs-auth', () => {
    const meta = {
      mcp_servers: [
        { name: 'gmail', status: 'connected' },
        { name: 'hubspot', status: 'needs-auth' },
        { name: 'zapier', status: 'needs-auth' },
        { name: 'canva', status: 'failed' },
      ],
    };
    expect(extractMcpNeedsAuthServers(meta)).toEqual(['hubspot', 'zapier']);
  });

  it('rejects entries with a non-string name or wrong shape', () => {
    const meta = {
      mcp_servers: [
        { name: 'ok', status: 'needs-auth' },
        { name: 42, status: 'needs-auth' },
        null,
        'garbage',
      ],
    };
    expect(extractMcpNeedsAuthServers(meta)).toEqual(['ok']);
  });
});
