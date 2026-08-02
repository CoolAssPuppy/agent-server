import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CLI_ANALYTICS_SOURCE,
  createAnalyticsFromEnvironment,
  isAnalyticsOptedOut,
} from './factory.js';
import { ANALYTICS_EVENTS } from './events.js';

function createHome(envFileContents?: string): string {
  const home = mkdtempSync(join(tmpdir(), 'agent-server-analytics-factory-'));
  if (envFileContents !== undefined) {
    writeFileSync(join(home, '.env'), envFileContents);
  }
  return home;
}

type CapturedRequest = { body: { batch: { event: string; properties: Record<string, unknown> }[] } };

function createFetchStub(): { fetchImpl: typeof fetch; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push({ body: JSON.parse(String(init?.body)) });
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

describe('analytics opt-out resolution', () => {
  it('defaults to opted out until the user explicitly opts in', () => {
    expect(isAnalyticsOptedOut(createHome(), {})).toBe(true);
  });

  it('honors an explicit shell opt-in when the workspace file is silent', () => {
    expect(isAnalyticsOptedOut(createHome(), { AGENT_SERVER_ANALYTICS_OPT_OUT: 'false' })).toBe(false);
  });

  it('honors a shell variable when the workspace file is silent', () => {
    expect(isAnalyticsOptedOut(createHome(), { AGENT_SERVER_ANALYTICS_OPT_OUT: 'true' })).toBe(true);
  });

  it('lets the workspace file turn a running daemon back off', () => {
    const home = createHome('AGENT_SERVER_ANALYTICS_OPT_OUT=true\n');

    expect(isAnalyticsOptedOut(home, { AGENT_SERVER_ANALYTICS_OPT_OUT: 'false' })).toBe(true);
  });

  it('lets the workspace file turn a running daemon back on', () => {
    const home = createHome('AGENT_SERVER_ANALYTICS_OPT_OUT=false\n');

    expect(isAnalyticsOptedOut(home, { AGENT_SERVER_ANALYTICS_OPT_OUT: 'true' })).toBe(false);
  });
});

describe('analytics factory', () => {
  it('discards everything when no key is configured', async () => {
    const { fetchImpl, requests } = createFetchStub();
    const analytics = createAnalyticsFromEnvironment({
      env: { AGENT_SERVER_HOME: createHome() },
      fetchImpl,
    });

    analytics.capture(ANALYTICS_EVENTS.serverStarted);
    await analytics.shutdown();

    expect(requests).toEqual([]);
  });

  it('sends CLI-sourced events once a key is present', async () => {
    const { fetchImpl, requests } = createFetchStub();
    const analytics = createAnalyticsFromEnvironment({
      env: {
        AGENT_SERVER_HOME: createHome(),
        AGENT_SERVER_ANALYTICS_KEY: 'phc_test',
        AGENT_SERVER_ANALYTICS_DISTINCT_ID: '11111111-2222-4333-8444-555555555555',
        AGENT_SERVER_ANALYTICS_OPT_OUT: 'false',
      },
      fetchImpl,
    });

    analytics.capture(ANALYTICS_EVENTS.cliCommandInvoked, { command: 'start' });
    await analytics.shutdown();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.body.batch[0]?.event).toBe('cli_command_invoked');
    expect(requests[0]?.body.batch[0]?.properties).toMatchObject({
      command: 'start',
      source: CLI_ANALYTICS_SOURCE,
      distinct_id: '11111111-2222-4333-8444-555555555555',
    });
  });

  it('stays silent when the workspace file opts out', async () => {
    const { fetchImpl, requests } = createFetchStub();
    const analytics = createAnalyticsFromEnvironment({
      env: {
        AGENT_SERVER_HOME: createHome('AGENT_SERVER_ANALYTICS_OPT_OUT=true\n'),
        AGENT_SERVER_ANALYTICS_KEY: 'phc_test',
      },
      fetchImpl,
    });

    analytics.capture(ANALYTICS_EVENTS.serverStarted);
    await analytics.shutdown();

    expect(requests).toEqual([]);
  });
});
