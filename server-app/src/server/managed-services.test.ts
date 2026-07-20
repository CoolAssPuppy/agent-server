import { describe, expect, it, vi } from 'vitest';
import { startManagedServices, type ManagedService } from './managed-services.js';

function makeService(
  name: string,
  events: string[],
  startError?: Error,
): ManagedService {
  return {
    name,
    start: vi.fn(async () => {
      events.push(`start:${name}`);
      if (startError) throw startError;
    }),
    stop: vi.fn(async () => {
      await Promise.resolve();
      events.push(`stop:${name}`);
    }),
  };
}

describe('managed server services', () => {
  it('awaits startup and stops acquired services in reverse order', async () => {
    const events: string[] = [];
    const first = makeService('first', events);
    const second = makeService('second', events);

    const stop = await startManagedServices([first, second]);
    await stop();

    expect(events).toEqual([
      'start:first',
      'start:second',
      'stop:second',
      'stop:first',
    ]);
  });

  it('rolls back partially acquired services when startup rejects', async () => {
    const events: string[] = [];
    const first = makeService('first', events);
    const second = makeService('second', events, new Error('cannot connect'));

    await expect(startManagedServices([first, second])).rejects.toThrow('cannot connect');

    expect(events).toEqual([
      'start:first',
      'start:second',
      'stop:second',
      'stop:first',
    ]);
  });

  it('makes teardown idempotent and waits for every service after one rejects', async () => {
    const events: string[] = [];
    const first = makeService('first', events);
    const second = makeService('second', events);
    vi.mocked(second.stop).mockRejectedValue(new Error('stop failed'));
    const stop = await startManagedServices([first, second]);

    await expect(stop()).rejects.toThrow('stop failed');
    await expect(stop()).resolves.toBeUndefined();

    expect(second.stop).toHaveBeenCalledTimes(1);
    expect(first.stop).toHaveBeenCalledTimes(1);
  });

  it('times out startup and rolls back a service that never becomes ready', async () => {
    const events: string[] = [];
    const service = makeService('stuck', events);
    vi.mocked(service.start).mockImplementation(() => new Promise<void>(() => {}));

    await expect(startManagedServices([service], { startTimeoutMs: 10 }))
      .rejects.toThrow('stuck did not start within 10ms');

    expect(service.stop).toHaveBeenCalledOnce();
  });

  it('bounds rollback when both startup and teardown never settle', async () => {
    const service = makeService('stuck', []);
    vi.mocked(service.start).mockImplementation(() => new Promise<void>(() => {}));
    vi.mocked(service.stop).mockImplementation(() => new Promise<void>(() => {}));

    await expect(startManagedServices([service], {
      startTimeoutMs: 10,
      stopTimeoutMs: 10,
    })).rejects.toMatchObject({
      errors: [
        { message: 'stuck did not start within 10ms' },
        { message: 'stuck: stuck did not stop within 10ms' },
      ],
    });
  });

  it('bounds normal teardown when a service never stops', async () => {
    const service = makeService('stuck', []);
    vi.mocked(service.stop).mockImplementation(() => new Promise<void>(() => {}));
    const stop = await startManagedServices([service], { stopTimeoutMs: 10 });

    await expect(stop()).rejects.toThrow('stuck did not stop within 10ms');
  });
});
