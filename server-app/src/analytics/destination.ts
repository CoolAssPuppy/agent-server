import type { AnalyticsProperties } from './events.js';

/** One captured event, already stamped with identity and the common properties. */
export type AnalyticsEnvelope = {
  readonly event: string;
  readonly distinctId: string;
  readonly timestamp: string;
  readonly properties: AnalyticsProperties;
};

/**
 * Abstract contract for one analytics provider.
 *
 * To add a provider — GA4, an internal collector, anything — implement this
 * interface and append it to the array `createAnalytics` receives. That is the
 * only edit. No capture site changes, because no capture site knows a provider
 * exists.
 *
 * `deliver` may reject. The facade isolates every destination, so a provider
 * that is down or misconfigured never blocks the others and never surfaces an
 * error to the user.
 */
export interface AnalyticsDestination {
  /** Stable slug used in debug logs. Not sent to any provider. */
  readonly name: string;
  deliver(batch: readonly AnalyticsEnvelope[]): Promise<void>;
}
