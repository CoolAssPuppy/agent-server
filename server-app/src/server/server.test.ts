import { describe, it, expect } from 'vitest';
import { makeAgent } from '../test-factories.js';
import {
  chatKeyFromString,
  extractMcpNeedsAuthServers,
  shouldDispatchNotification,
  shouldSendChannelRunNotification,
  shouldSendTelegramRunNotification,
} from './server.js';

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
