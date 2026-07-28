import { describe, expect, it } from 'vitest';

import type { AnalyticsEnvelope } from './destination.js';
import { createPostHogDestination } from './posthog-destination.js';

function createEnvelope(overrides?: Partial<AnalyticsEnvelope>): AnalyticsEnvelope {
  return {
    event: 'server_started',
    distinctId: '11111111-2222-3333-4444-555555555555',
    timestamp: '2026-07-29T12:00:00.000Z',
    properties: { source: 'agent_server_cli', app_version: '9.9.9' },
    ...overrides,
  };
}

type CapturedRequest = { url: string; body: unknown };

function createFetchStub(response: Response): {
  fetchImpl: typeof fetch;
  requests: CapturedRequest[];
} {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return response;
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

describe('PostHog destination', () => {
  it('posts the batch in the shape PostHog documents', async () => {
    const { fetchImpl, requests } = createFetchStub(new Response(null, { status: 200 }));
    const destination = createPostHogDestination({ apiKey: 'phc_test', fetchImpl });

    await destination.deliver([createEnvelope({ properties: { command: 'list' } })]);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://us.i.posthog.com/batch/');
    expect(requests[0]?.body).toEqual({
      api_key: 'phc_test',
      batch: [
        {
          event: 'server_started',
          timestamp: '2026-07-29T12:00:00.000Z',
          properties: {
            command: 'list',
            distinct_id: '11111111-2222-3333-4444-555555555555',
          },
        },
      ],
    });
  });

  it('honors a custom host and normalizes a trailing slash', async () => {
    const { fetchImpl, requests } = createFetchStub(new Response(null, { status: 200 }));
    const destination = createPostHogDestination({
      apiKey: 'phc_test',
      host: 'https://eu.i.posthog.com/',
      fetchImpl,
    });

    await destination.deliver([createEnvelope()]);

    expect(requests[0]?.url).toBe('https://eu.i.posthog.com/batch/');
  });

  it('reports a rejected batch so the caller can isolate the failure', async () => {
    const { fetchImpl } = createFetchStub(new Response(null, { status: 401 }));
    const destination = createPostHogDestination({ apiKey: 'phc_dead', fetchImpl });

    await expect(destination.deliver([createEnvelope()])).rejects.toThrow('HTTP 401');
  });

  it('sends nothing for an empty batch', async () => {
    const { fetchImpl, requests } = createFetchStub(new Response(null, { status: 200 }));
    const destination = createPostHogDestination({ apiKey: 'phc_test', fetchImpl });

    await destination.deliver([]);

    expect(requests).toEqual([]);
  });
});
