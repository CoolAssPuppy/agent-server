import { describe, it, expect, vi } from 'vitest';
import { ChannelDispatcher } from './dispatcher.js';
import type { Channel } from './channel.js';
import type { InteractionRequest } from '../interaction/schema.js';
import type { NotificationData } from '../interaction/notification.js';

function makeChannel(name: string): Channel & {
  sendCalls: Array<{ id: string; request: InteractionRequest }>;
  notifyCalls: NotificationData[];
} {
  const sendCalls: Array<{ id: string; request: InteractionRequest }> = [];
  const notifyCalls: NotificationData[] = [];
  return {
    name,
    sendCalls,
    notifyCalls,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn(async (id: string, request: InteractionRequest) => {
      sendCalls.push({ id, request });
    }),
    notify: vi.fn(async (data: NotificationData) => {
      notifyCalls.push(data);
    }),
    onReply: vi.fn(),
  };
}

describe('ChannelDispatcher', () => {
  it('registers and resolves a channel by name', () => {
    const dispatcher = new ChannelDispatcher();
    const channel = makeChannel('telegram');
    dispatcher.register(channel);
    expect(dispatcher.resolve('telegram')).toBe(channel);
  });

  it('returns undefined for unknown channel', () => {
    const dispatcher = new ChannelDispatcher();
    expect(dispatcher.resolve('nonexistent')).toBeUndefined();
  });

  it('dispatches interaction request to the correct channel', async () => {
    const dispatcher = new ChannelDispatcher();
    const channel = makeChannel('console');
    dispatcher.register(channel);

    const request: InteractionRequest = {
      message: 'Pick one',
      options: [{ label: 'A', value: 'a' }],
      freeText: false,
    };

    await dispatcher.dispatch('int-1', 'console', request);
    expect(channel.sendCalls).toHaveLength(1);
    expect(channel.sendCalls[0].id).toBe('int-1');
    expect(channel.sendCalls[0].request).toBe(request);
  });

  it('rejects interaction delivery for an unknown channel', async () => {
    const dispatcher = new ChannelDispatcher();
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const request: InteractionRequest = {
      message: 'Pick one',
      freeText: true,
    };

    await expect(dispatcher.dispatch('int-1', 'unknown', request))
      .rejects.toThrow('Channel not configured: unknown');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('unknown'));
    spy.mockRestore();
  });

  it('sends notification to the correct channel', async () => {
    const dispatcher = new ChannelDispatcher();
    const channel = makeChannel('telegram');
    dispatcher.register(channel);

    const data: NotificationData = { agentName: 'Test', status: 'completed', summary: 'Done' };
    await dispatcher.notify('telegram', data);
    expect(channel.notifyCalls).toEqual([data]);
  });

  it('logs warning when notifying unknown channel', async () => {
    const dispatcher = new ChannelDispatcher();
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await dispatcher.notify('unknown', 'Hello');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('unknown'));
    spy.mockRestore();
  });

  it('expires interactions on the correct channel', async () => {
    const dispatcher = new ChannelDispatcher();
    const channel = makeChannel('telegram');
    channel.expireInteraction = vi.fn().mockResolvedValue(undefined);
    dispatcher.register(channel);

    await dispatcher.expireInteractions([
      { id: 'int-1', channel: 'telegram' },
      { id: 'int-2', channel: 'telegram' },
    ]);

    expect(channel.expireInteraction).toHaveBeenCalledTimes(2);
    expect(channel.expireInteraction).toHaveBeenCalledWith('int-1');
    expect(channel.expireInteraction).toHaveBeenCalledWith('int-2');
  });

  it('skips channels without expireInteraction support', async () => {
    const dispatcher = new ChannelDispatcher();
    const channel = makeChannel('console');
    dispatcher.register(channel);

    await dispatcher.expireInteractions([
      { id: 'int-1', channel: 'console' },
    ]);
    // Should not throw
  });

  it('starts and stops all registered channels', async () => {
    const dispatcher = new ChannelDispatcher();
    const ch1 = makeChannel('console');
    const ch2 = makeChannel('telegram');
    dispatcher.register(ch1);
    dispatcher.register(ch2);

    await dispatcher.startAll();
    expect(ch1.start).toHaveBeenCalledOnce();
    expect(ch2.start).toHaveBeenCalledOnce();

    await dispatcher.stopAll();
    expect(ch1.stop).toHaveBeenCalledOnce();
    expect(ch2.stop).toHaveBeenCalledOnce();
  });
});
