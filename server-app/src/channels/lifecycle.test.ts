import { describe, expect, it } from 'vitest';
import { ChannelLifecycle, ChannelReconnectPolicy } from './lifecycle.js';

describe('ChannelLifecycle', () => {
  it('tracks recovery transitions and clears stale errors after connection', () => {
    const lifecycle = new ChannelLifecycle('slack');

    lifecycle.transition('reconnecting', 'network');
    expect(lifecycle.status()).toMatchObject({ state: 'reconnecting', error_code: 'network' });
    lifecycle.transition('connected');

    expect(lifecycle.status()).toEqual({ channel: 'slack', state: 'connected' });
  });

  it('keeps stopped terminal when late provider events arrive', () => {
    const lifecycle = new ChannelLifecycle('telegram');

    lifecycle.stop();
    lifecycle.transition('connected');

    expect(lifecycle.status()).toEqual({ channel: 'telegram', state: 'stopped' });
  });

  it('exposes only stable sanitized error codes', () => {
    const lifecycle = new ChannelLifecycle('slack');

    lifecycle.transition('needs_auth', 'xapp-secret-value');

    expect(lifecycle.status()).toEqual({
      channel: 'slack',
      state: 'needs_auth',
      error_code: 'unknown',
    });
  });
});

describe('ChannelReconnectPolicy', () => {
  it('backs off to a bounded delay and resets after connection', () => {
    const policy = new ChannelReconnectPolicy(1_000, 30_000);

    expect([1, 2, 3, 10].map((attempt) => policy.delay(attempt)))
      .toEqual([1_000, 2_000, 4_000, 30_000]);
  });
});
