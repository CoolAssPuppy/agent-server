import { describe, expect, it, vi } from 'vitest';

import { createAnalytics, createNoopAnalytics, type AnalyticsOptions } from './analytics.js';
import type { AnalyticsDestination, AnalyticsEnvelope } from './destination.js';
import { ANALYTICS_EVENTS } from './events.js';

type RecordingDestination = AnalyticsDestination & {
  readonly batches: AnalyticsEnvelope[][];
  readonly events: AnalyticsEnvelope[];
};

function createRecordingDestination(name = 'recorder'): RecordingDestination {
  const batches: AnalyticsEnvelope[][] = [];
  return {
    name,
    batches,
    get events() {
      return batches.flat();
    },
    deliver: async (batch) => {
      batches.push([...batch]);
    },
  };
}

function createFailingDestination(name = 'broken'): AnalyticsDestination {
  return {
    name,
    deliver: async () => {
      throw new Error('provider is down');
    },
  };
}

function createAnalyticsOptions(overrides?: Partial<AnalyticsOptions>): AnalyticsOptions {
  return {
    destinations: [],
    distinctId: '11111111-2222-3333-4444-555555555555',
    source: 'agent_server_cli',
    appVersion: '9.9.9',
    isOptedOut: () => false,
    now: () => new Date('2026-07-29T12:00:00.000Z'),
    ...overrides,
  };
}

describe('CLI analytics', () => {
  it('stamps identity, source, and version onto every captured event', async () => {
    const destination = createRecordingDestination();
    const analytics = createAnalytics(createAnalyticsOptions({ destinations: [destination] }));

    analytics.capture(ANALYTICS_EVENTS.cliCommandInvoked, { command: 'list' });
    await analytics.flush();

    expect(destination.events).toEqual([
      {
        event: 'cli_command_invoked',
        distinctId: '11111111-2222-3333-4444-555555555555',
        timestamp: '2026-07-29T12:00:00.000Z',
        properties: { command: 'list', source: 'agent_server_cli', app_version: '9.9.9' },
      },
    ]);
  });

  it('delivers to every destination even when one of them fails', async () => {
    const healthy = createRecordingDestination('healthy');
    const analytics = createAnalytics(
      createAnalyticsOptions({ destinations: [createFailingDestination(), healthy] }),
    );

    analytics.capture(ANALYTICS_EVENTS.serverStarted);
    await expect(analytics.flush()).resolves.toBeUndefined();

    expect(healthy.events).toHaveLength(1);
  });

  it('captures nothing while the user is opted out', async () => {
    const destination = createRecordingDestination();
    const analytics = createAnalytics(
      createAnalyticsOptions({ destinations: [destination], isOptedOut: () => true }),
    );

    analytics.capture(ANALYTICS_EVENTS.serverStarted);
    await analytics.flush();

    expect(destination.batches).toEqual([]);
  });

  it('discards already-queued events when the user opts out before the flush', async () => {
    const destination = createRecordingDestination();
    const optedOut = { value: false };
    const analytics = createAnalytics(
      createAnalyticsOptions({
        destinations: [destination],
        isOptedOut: () => optedOut.value,
      }),
    );

    analytics.capture(ANALYTICS_EVENTS.serverStarted);
    optedOut.value = true;
    await analytics.flush();

    expect(destination.batches).toEqual([]);
  });

  it('sends one batch once the queue reaches the batch size', async () => {
    const destination = createRecordingDestination();
    const analytics = createAnalytics(
      createAnalyticsOptions({ destinations: [destination], batchSize: 2 }),
    );

    analytics.capture(ANALYTICS_EVENTS.serverStarted);
    analytics.capture(ANALYTICS_EVENTS.serverStopped);
    await analytics.shutdown();

    expect(destination.batches).toHaveLength(1);
    expect(destination.batches[0]).toHaveLength(2);
  });

  it('drains the queue on shutdown', async () => {
    const destination = createRecordingDestination();
    const analytics = createAnalytics(createAnalyticsOptions({ destinations: [destination] }));

    analytics.capture(ANALYTICS_EVENTS.workspaceInitialized);
    await analytics.shutdown();

    expect(destination.events.map((event) => event.event)).toEqual(['workspace_initialized']);
  });

  it('flushes on a timer without holding the process open', async () => {
    vi.useFakeTimers();
    try {
      const destination = createRecordingDestination();
      const analytics = createAnalytics(
        createAnalyticsOptions({ destinations: [destination], flushIntervalMs: 1_000 }),
      );

      analytics.capture(ANALYTICS_EVENTS.serverStarted);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(destination.events).toHaveLength(1);
      await analytics.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops the oldest events rather than growing without bound while delivery fails', async () => {
    const destination = createRecordingDestination();
    const analytics = createAnalytics(
      createAnalyticsOptions({ destinations: [destination], batchSize: 10_000 }),
    );

    for (let index = 0; index < 600; index += 1) {
      analytics.capture(ANALYTICS_EVENTS.agentRunDispatched, { index });
    }
    await analytics.flush();

    const delivered = destination.events;
    expect(delivered).toHaveLength(500);
    expect(delivered[0]?.properties.index).toBe(100);
  });

  it('does nothing at all when no destination is configured', async () => {
    const analytics = createAnalytics(createAnalyticsOptions());

    analytics.capture(ANALYTICS_EVENTS.serverStarted);

    await expect(analytics.flush()).resolves.toBeUndefined();
    await expect(analytics.shutdown()).resolves.toBeUndefined();
  });

  it('offers a no-op instance for code paths that run before configuration', async () => {
    const analytics = createNoopAnalytics();

    analytics.capture(ANALYTICS_EVENTS.serverStarted);

    await expect(analytics.flush()).resolves.toBeUndefined();
    await expect(analytics.shutdown()).resolves.toBeUndefined();
  });
});
