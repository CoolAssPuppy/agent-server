import { homedir } from 'node:os';
import { join } from 'node:path';

import { loadEnvFile } from '../platform/config.js';
import { AGENT_SERVER_VERSION } from '../version.js';
import { createAnalytics, createNoopAnalytics, type Analytics } from './analytics.js';
import type { AnalyticsDestination } from './destination.js';
import { resolveDistinctId } from './identity.js';
import { createPostHogDestination } from './posthog-destination.js';

/** Marks every event as coming from the CLI, not the macOS app. */
export const CLI_ANALYTICS_SOURCE = 'agent_server_cli';

export type AnalyticsFactoryOptions = {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
};

const OPT_OUT_KEY = 'AGENT_SERVER_ANALYTICS_OPT_OUT';

/**
 * Reads the live opt-out, with `~/.agent-server/.env` deliberately beating the
 * process environment.
 *
 * Everywhere else in this codebase the shell wins over the file. Here it must
 * not. The macOS app writes the user's choice to the file while the daemon it
 * spawned is already running with a stale copy of the environment, so the file
 * is the only channel that can reach a live process. A shell variable still
 * works for anyone running the CLI directly, because that process has no file
 * entry to override it.
 */
export function isAnalyticsOptedOut(
  home: string,
  env: Record<string, string | undefined>,
): boolean {
  const fromFile = loadEnvFile(home, {})[OPT_OUT_KEY];
  if (fromFile !== undefined) return fromFile === 'true';
  const fromEnvironment = env[OPT_OUT_KEY];
  if (fromEnvironment !== undefined) return fromEnvironment === 'true';
  return true;
}

/**
 * Builds the analytics facade for this process from the environment.
 *
 * No key means no destinations, which means a live object that discards
 * everything. That is the normal state for a contributor running from source:
 * the key is injected by the macOS app, which reads it from the build settings
 * baked in at release time. Development never reaches the production project.
 *
 * The opt-out is re-read from `~/.agent-server/.env` on every flush rather than
 * captured once here. A daemon can outlive several trips through the macOS
 * settings drawer, and the user flipping the switch off has to stop the sending
 * now, not after the next restart.
 */
export function createAnalyticsFromEnvironment(
  options: AnalyticsFactoryOptions = {},
): Analytics {
  const env = options.env ?? process.env;
  const apiKey = env.AGENT_SERVER_ANALYTICS_KEY?.trim();
  if (!apiKey) return createNoopAnalytics();

  const home = env.AGENT_SERVER_HOME || join(homedir(), '.agent-server');

  const destinations: AnalyticsDestination[] = [
    createPostHogDestination({
      apiKey,
      host: env.AGENT_SERVER_ANALYTICS_HOST,
      fetchImpl: options.fetchImpl,
    }),
  ];

  return createAnalytics({
    destinations,
    distinctId: resolveDistinctId({ inherited: env.AGENT_SERVER_ANALYTICS_DISTINCT_ID, home }),
    source: CLI_ANALYTICS_SOURCE,
    appVersion: AGENT_SERVER_VERSION,
    isOptedOut: () => isAnalyticsOptedOut(home, env),
  });
}
