import type { AnalyticsDestination, AnalyticsEnvelope } from './destination.js';

export type PostHogDestinationOptions = {
  apiKey: string;
  host?: string;
  /** Injected in tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const DEFAULT_HOST = 'https://us.i.posthog.com';
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * PostHog capture over its documented batch endpoint.
 *
 * Written against `fetch` rather than `posthog-node` on purpose. The whole
 * `node_modules` tree is copied into the signed .app bundle and every Mach-O
 * binary in it is re-signed at build time, so a dependency here is not free. A
 * single POST with a documented body shape costs less than the SDK earns, and
 * it keeps the batching policy in one place (`createAnalytics`) instead of two.
 */
export function createPostHogDestination(options: PostHogDestinationOptions): AnalyticsDestination {
  const {
    apiKey,
    host = DEFAULT_HOST,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const endpoint = `${host.replace(/\/+$/, '')}/batch/`;

  return {
    name: 'posthog',
    async deliver(batch: readonly AnalyticsEnvelope[]): Promise<void> {
      if (batch.length === 0) return;

      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          api_key: apiKey,
          batch: batch.map((envelope) => ({
            event: envelope.event,
            timestamp: envelope.timestamp,
            properties: {
              ...envelope.properties,
              distinct_id: envelope.distinctId,
            },
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`PostHog rejected the batch with HTTP ${response.status}`);
      }
    },
  };
}
