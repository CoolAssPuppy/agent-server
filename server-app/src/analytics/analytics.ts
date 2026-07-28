import type { AnalyticsDestination, AnalyticsEnvelope } from './destination.js';
import type { AnalyticsEventName, AnalyticsProperties } from './events.js';

/**
 * The capture surface the rest of the CLI sees. Nothing outside this directory
 * imports a provider, so providers stay swappable.
 */
export type Analytics = {
  capture(event: AnalyticsEventName, properties?: AnalyticsProperties): void;
  /** Sends everything queued. Safe to call when the queue is empty. */
  flush(): Promise<void>;
  /** Stops the flush timer and drains the queue one last time. */
  shutdown(): Promise<void>;
};

export type AnalyticsOptions = {
  destinations: readonly AnalyticsDestination[];
  /** Per-install identifier. Shared with the macOS app so both surfaces are one person. */
  distinctId: string;
  /** Which surface produced the event: `agent_server_cli`. */
  source: string;
  appVersion: string;
  /**
   * Re-read before every flush rather than captured once at startup. The macOS
   * app can flip the preference while this daemon is already running, and an
   * opt-out has to take effect without waiting for a restart.
   */
  isOptedOut: () => boolean;
  /** Flush when the queue reaches this many events. */
  batchSize?: number;
  flushIntervalMs?: number;
  now?: () => Date;
};

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 10_000;
/**
 * Ceiling on the queue when every destination is failing. A daemon that runs
 * for weeks behind a broken network must not grow a queue until it is killed.
 * Oldest events are dropped first: recent usage matters more than stale usage.
 */
const MAX_QUEUED_EVENTS = 500;

/**
 * Anonymous product analytics for the CLI and daemon.
 *
 * Identity is a per-install UUID with no PII attached. Events are queued and
 * delivered in batches so a slow network never delays an agent run. Every
 * destination is isolated: one that throws or rejects does not stop the rest,
 * and no failure ever reaches a call site.
 *
 * Pass an empty `destinations` array to get a live object that discards
 * everything, which is what an unconfigured contributor build does.
 */
export function createAnalytics(options: AnalyticsOptions): Analytics {
  const {
    destinations,
    distinctId,
    source,
    appVersion,
    isOptedOut,
    batchSize = DEFAULT_BATCH_SIZE,
    flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
    now = () => new Date(),
  } = options;

  let queue: AnalyticsEnvelope[] = [];
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  const isDisabled = destinations.length === 0;

  function startTimer(): void {
    if (timer || isDisabled) return;
    timer = setInterval(() => void flush(), flushIntervalMs);
    // Never hold the process open for analytics. A one-shot command such as
    // `agent-server list` must exit as soon as its work is done.
    timer.unref();
  }

  function stopTimer(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = undefined;
  }

  function capture(event: AnalyticsEventName, properties: AnalyticsProperties = {}): void {
    if (isDisabled || isOptedOut()) return;

    queue.push({
      event,
      distinctId,
      timestamp: now().toISOString(),
      properties: { ...properties, source, app_version: appVersion },
    });

    if (queue.length > MAX_QUEUED_EVENTS) {
      queue = queue.slice(queue.length - MAX_QUEUED_EVENTS);
    }

    startTimer();
    if (queue.length >= batchSize) void flush();
  }

  async function flush(): Promise<void> {
    if (isDisabled) return;

    // An opt-out between capture and flush discards what was queued. The user
    // said stop, so nothing already buffered is sent either.
    if (isOptedOut()) {
      queue = [];
      return;
    }

    if (queue.length === 0) return;

    const batch = queue;
    queue = [];

    // Serialize flushes so a slow destination cannot interleave batches and
    // deliver events out of order.
    inFlight = inFlight.then(async () => {
      await Promise.allSettled(destinations.map((destination) => destination.deliver(batch)));
    });
    await inFlight;
  }

  async function shutdown(): Promise<void> {
    stopTimer();
    await flush();
    await inFlight;
  }

  return { capture, flush, shutdown };
}

/** A no-op instance for tests and for code paths that run before configuration. */
export function createNoopAnalytics(): Analytics {
  return {
    capture: () => {},
    flush: async () => {},
    shutdown: async () => {},
  };
}
