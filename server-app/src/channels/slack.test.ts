import { describe, it, expect, vi } from 'vitest';
import {
  SlackChannel,
  buildSlackBlocks,
  formatSlackMessage,
  encodeActionValue,
  parseActionValue,
} from './slack.js';
import type { InteractionRequest } from '../interaction/schema.js';
import type { ChannelReply } from './channel.js';

const optionsRequest: InteractionRequest = {
  message: 'Found 3 slots at Bougainville',
  options: [
    { label: '19:00', value: 'Book 19:00' },
    { label: '20:30', value: 'Book 20:30' },
    { label: '21:00', value: 'Book 21:00' },
  ],
  freeText: false,
};

const freeTextRequest: InteractionRequest = {
  message: 'What is your budget?',
  freeText: true,
};

type SentMessage = { channel: string; text: string; blocks?: unknown[] };

function makeApi() {
  const sent: SentMessage[] = [];
  const updated: Array<{ channel: string; ts: string; text: string }> = [];
  let counter = 0;
  return {
    sent,
    updated,
    api: {
      postMessage: vi.fn(async (channel: string, text: string, blocks?: unknown[]) => {
        sent.push({ channel, text, blocks });
        counter += 1;
        return { ts: `ts-${counter}`, channel };
      }),
      updateMessage: vi.fn(async (channel: string, ts: string, text: string) => {
        updated.push({ channel, ts, text });
      }),
    },
  };
}

describe('formatSlackMessage', () => {
  it('returns the message text for options-only requests', () => {
    expect(formatSlackMessage(optionsRequest)).toBe('Found 3 slots at Bougainville');
  });

  it('appends a free-text hint when freeText and options are both present', () => {
    const text = formatSlackMessage({ ...optionsRequest, freeText: true });
    expect(text).toContain('Found 3 slots at Bougainville');
    expect(text).toContain('or type a reply');
  });

  it('returns the plain message for free-text-only requests', () => {
    expect(formatSlackMessage(freeTextRequest)).toBe('What is your budget?');
  });
});

describe('buildSlackBlocks', () => {
  it('builds a section plus one button per option', () => {
    const blocks = buildSlackBlocks('int-1', optionsRequest) as Array<Record<string, unknown>>;
    const actions = blocks.find((b) => b.type === 'actions') as { elements: unknown[] };
    expect(actions.elements).toHaveLength(3);
    const first = actions.elements[0] as { text: { text: string }; value: string };
    expect(first.text.text).toBe('19:00');
    expect(parseActionValue(first.value)).toEqual({ interactionId: 'int-1', optionIndex: 0 });
  });

  it('omits the actions block for free-text-only requests', () => {
    const blocks = buildSlackBlocks('int-2', freeTextRequest) as Array<Record<string, unknown>>;
    expect(blocks.some((b) => b.type === 'actions')).toBe(false);
  });
});

describe('encode/parse action value', () => {
  it('round-trips interaction id and option index', () => {
    expect(parseActionValue(encodeActionValue('abc-123', 4))).toEqual({
      interactionId: 'abc-123',
      optionIndex: 4,
    });
  });

  it('rejects malformed values', () => {
    expect(parseActionValue('garbage')).toBeUndefined();
    expect(parseActionValue('')).toBeUndefined();
  });
});

describe('SlackChannel', () => {
  it('posts an interaction with buttons and records the pending state', async () => {
    const { api, sent } = makeApi();
    const channel = new SlackChannel({ api, channelId: 'D123' });
    await channel.send('int-1', optionsRequest);
    expect(sent).toHaveLength(1);
    expect(sent[0].channel).toBe('D123');
    expect(channel.hasPendingInteraction('int-1')).toBe(true);
  });

  it('does not post without a paired channel', async () => {
    const { api, sent } = makeApi();
    const channel = new SlackChannel({ api });
    await channel.send('int-1', optionsRequest);
    expect(sent).toHaveLength(0);
  });

  it('delivers a selected option value to reply callbacks', async () => {
    const { api } = makeApi();
    const channel = new SlackChannel({ api, channelId: 'D123' });
    const replies: ChannelReply[] = [];
    channel.onReply((r) => replies.push(r));
    await channel.send('int-1', optionsRequest);

    channel.handleBlockAction(encodeActionValue('int-1', 1));
    expect(replies).toEqual([{ interactionId: 'int-1', selectedValue: 'Book 20:30' }]);
    expect(channel.hasPendingInteraction('int-1')).toBe(false);
  });

  it('routes a free-text reply to the pending interaction', async () => {
    const { api } = makeApi();
    const channel = new SlackChannel({ api, channelId: 'D123' });
    const replies: ChannelReply[] = [];
    channel.onReply((r) => replies.push(r));
    await channel.send('int-1', freeTextRequest);

    channel.handleIncomingMessage('around 200 euros');
    expect(replies).toEqual([{ interactionId: 'int-1', freeText: 'around 200 euros' }]);
  });

  it('routes a plain message to onMessage when nothing is pending', async () => {
    const { api } = makeApi();
    const channel = new SlackChannel({ api, channelId: 'D123' });
    const messages: string[] = [];
    channel.onMessage((t) => messages.push(t));
    channel.handleIncomingMessage('what can you do?');
    expect(messages).toEqual(['what can you do?']);
  });

  it('sends a run notification as plain text', async () => {
    const { api, sent } = makeApi();
    const channel = new SlackChannel({ api, channelId: 'D123' });
    await channel.notify({ agentName: 'Booker', status: 'completed', summary: 'Booked 20:30.' });
    expect(sent[0].text).toContain('✅ Booker completed');
    expect(sent[0].text).toContain('Booked 20:30.');
  });

  it('expires an interaction by editing the message and clearing buttons', async () => {
    const { api, updated } = makeApi();
    const channel = new SlackChannel({ api, channelId: 'D123' });
    await channel.send('int-1', optionsRequest);
    await channel.expireInteraction('int-1');
    expect(updated).toHaveLength(1);
    expect(updated[0].text).toContain('expired');
    expect(channel.hasPendingInteraction('int-1')).toBe(false);
  });

  it('persists a manual destination before changing the live channel', async () => {
    const { api } = makeApi();
    const persisted: string[] = [];
    const channel = new SlackChannel({
      api,
      persistChannelId: async (channelId) => {
        persisted.push(channelId);
      },
    });
    expect(channel.getChannelId()).toBeUndefined();

    await channel.pair('D99999999');

    expect(persisted).toEqual(['D99999999']);
    expect(channel.getChannelId()).toBe('D99999999');
  });

  it('keeps the current destination when persistence fails', async () => {
    const { api } = makeApi();
    const channel = new SlackChannel({
      api,
      channelId: 'D11111111',
      persistChannelId: vi.fn().mockRejectedValue(new Error('disk full')),
    });

    await expect(channel.pair('D22222222')).rejects.toThrow('disk full');
    expect(channel.getChannelId()).toBe('D11111111');
  });

  it('returns an Open Slack URL while waiting for a destination', async () => {
    const { api } = makeApi();
    const channel = new SlackChannel({
      api,
      resolveOpenUrl: vi.fn().mockResolvedValue('slack://user?team=T123&id=U123'),
    });

    await expect(channel.getPairingStatus()).resolves.toEqual({
      state: 'needs_pairing',
      open_url: 'slack://user?team=T123&id=U123',
      can_open_slack: true,
      can_test: false,
    });
  });

  it('sends an explicit test message only after pairing', async () => {
    const unpairedApi = makeApi();
    const unpaired = new SlackChannel({ api: unpairedApi.api });
    await expect(unpaired.sendTestMessage()).rejects.toThrow('Slack destination is not configured');

    const pairedApi = makeApi();
    const paired = new SlackChannel({ api: pairedApi.api, channelId: 'D12345678' });
    await paired.sendTestMessage();

    expect(pairedApi.sent).toEqual([{
      channel: 'D12345678',
      text: 'Agent Server is connected to Slack.',
      blocks: undefined,
    }]);
  });

  it('reports a Socket Mode connection failure instead of claiming readiness', async () => {
    const channel = new SlackChannel({
      api: { postMessage: vi.fn() },
      channelId: 'D0BK0NF46AU',
      socket: {
        start: vi.fn().mockRejectedValue(new Error('invalid app token')),
        disconnect: vi.fn(),
      },
      onSocketError: vi.fn(),
    });

    await channel.start();

    await expect(channel.getPairingStatus()).resolves.toEqual({
      state: 'error',
      can_open_slack: false,
      can_test: true,
    });
  });

  it('tracks native reconnect events and ignores late events after stop', async () => {
    const channel = new SlackChannel({ api: makeApi().api });

    channel.handleTransportState('reconnecting');
    expect(channel.getLifecycleStatus().state).toBe('reconnecting');
    channel.handleTransportState('connected');
    expect(channel.getLifecycleStatus().state).toBe('connected');
    await channel.stop();
    channel.handleTransportState('connected');

    expect(channel.getLifecycleStatus().state).toBe('stopped');
  });
});
