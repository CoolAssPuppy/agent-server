import { describe, it, expect, vi } from 'vitest';
import { ChannelDispatcher } from './dispatcher.js';
import type { Channel, ChannelReply } from './channel.js';
import type { InteractionRequest } from '../interaction/schema.js';

function makeChannel(name: string): Channel & { sendCalls: Array<{ id: string; request: InteractionRequest }> } {
  const sendCalls: Array<{ id: string; request: InteractionRequest }> = [];
  return {
    name,
    sendCalls,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn(async (id: string, request: InteractionRequest) => {
      sendCalls.push({ id, request });
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

  it('logs warning for unknown channel', async () => {
    const dispatcher = new ChannelDispatcher();
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const request: InteractionRequest = {
      message: 'Pick one',
      freeText: true,
    };

    await dispatcher.dispatch('int-1', 'unknown', request);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('unknown'));
    spy.mockRestore();
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
