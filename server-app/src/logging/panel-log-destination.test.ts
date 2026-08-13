import { describe, expect, it } from 'vitest';
import { PanelLogDestination, type PanelLogDestinationOptions } from './panel-log-destination.js';
import type { LogRecord } from './record.js';

const RUN_ONE = '11111111-1111-4111-8111-111111111111';
const RUN_TWO = '22222222-2222-4222-8222-222222222222';

type PanelEntry = {
  timestamp: string;
  level: string;
  message: string;
  source: string;
  metadata?: Record<string, unknown>;
};

type PanelBatch = {
  protocol_version: number;
  machine_id: string;
  entries: PanelEntry[];
};

type PanelRequest = {
  url: string;
  headers: Record<string, string>;
  bodyBytes: number;
  batch: PanelBatch;
};

type PanelStub = {
  requests: PanelRequest[];
  fetchImpl: typeof globalThis.fetch;
};

function okResponse(inserted = 1): Response {
  return new Response(JSON.stringify({ ok: true, inserted }), { status: 200 });
}

function errorResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: 'nope' }), { status, headers });
}

/** Records every request the driver makes and answers with whatever the test wants. */
function createPanelStub(
  reply: (callNumber: number) => Response | Promise<Response> = () => okResponse(),
): PanelStub {
  const requests: PanelRequest[] = [];
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const body = String(init?.body ?? '');
    requests.push({
      url: typeof input === 'string' ? input : String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      bodyBytes: Buffer.byteLength(body, 'utf8'),
      batch: JSON.parse(body) as PanelBatch,
    });
    return reply(requests.length);
  };
  return { requests, fetchImpl };
}

function createRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    timestamp: '2026-08-13T09:00:00.000Z',
    level: 'info',
    message: 'Wrote the weekly report to Notion',
    agent_id: 'weekly-report',
    run_id: RUN_ONE,
    machine_id: '33333333-3333-4333-8333-333333333333',
    hostname: 'office-mac',
    source: 'agent',
    ...overrides,
  };
}

function createDestination(
  overrides: Partial<PanelLogDestinationOptions> = {},
): PanelLogDestination {
  return new PanelLogDestination({
    panelUrl: 'https://panel.example.com',
    panelApiKey: 'machine-credential',
    machineId: '33333333-3333-4333-8333-333333333333',
    fetchImpl: createPanelStub().fetchImpl,
    // Tests drive delivery by calling flush, so the timer never has to fire.
    flushIntervalMs: 3_600_000,
    onWarn: () => {},
    ...overrides,
  });
}

describe('Agent Panel log driver', () => {
  it('sends one request per run, addressed to that run', async () => {
    const panel = createPanelStub();
    const destination = createDestination({ fetchImpl: panel.fetchImpl });

    destination.write(createRecord({ message: 'first' }));
    destination.write(createRecord({ run_id: RUN_TWO, message: 'other run' }));
    destination.write(createRecord({ message: 'second' }));
    await destination.flush();

    expect(panel.requests).toHaveLength(2);
    expect(panel.requests[0].url).toBe(`https://panel.example.com/api/runs/${RUN_ONE}/logs`);
    expect(panel.requests[0].batch.entries.map((entry) => entry.message)).toEqual([
      'first',
      'second',
    ]);
    expect(panel.requests[1].url).toBe(`https://panel.example.com/api/runs/${RUN_TWO}/logs`);
    expect(panel.requests[1].batch.entries.map((entry) => entry.message)).toEqual(['other run']);
  });

  it('presents the machine credential as a bearer token and nowhere else', async () => {
    const panel = createPanelStub();
    const destination = createDestination({ fetchImpl: panel.fetchImpl });

    destination.write(createRecord());
    await destination.flush();

    const [request] = panel.requests;
    expect(request.headers.Authorization).toBe('Bearer machine-credential');
    expect(request.headers['Content-Type']).toBe('application/json');
    expect(JSON.stringify(request.batch)).not.toContain('machine-credential');
  });

  it('claims the paired machine identity and the current protocol version', async () => {
    const panel = createPanelStub();
    const destination = createDestination({ fetchImpl: panel.fetchImpl });

    destination.write(createRecord({ machine_id: 'a-stale-identity' }));
    await destination.flush();

    expect(panel.requests[0].batch.protocol_version).toBe(2);
    expect(panel.requests[0].batch.machine_id).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('does not reach the network while a run is writing', () => {
    const panel = createPanelStub();
    const destination = createDestination({ fetchImpl: panel.fetchImpl });

    destination.write(createRecord());

    expect(panel.requests).toHaveLength(0);
  });

  it('keeps the fields Panel has no column for in the entry metadata', async () => {
    const panel = createPanelStub();
    const destination = createDestination({ fetchImpl: panel.fetchImpl });

    destination.write(createRecord({ level: 'warn', source: 'server', attempt: 3 }));
    await destination.flush();

    const [entry] = panel.requests[0].batch.entries;
    expect(entry).toMatchObject({
      timestamp: '2026-08-13T09:00:00.000Z',
      level: 'warn',
      source: 'server',
    });
    expect(entry.metadata).toMatchObject({
      agent_id: 'weekly-report',
      hostname: 'office-mac',
      attempt: 3,
    });
  });

  it('folds a body into the metadata', async () => {
    const panel = createPanelStub();
    const destination = createDestination({ fetchImpl: panel.fetchImpl });

    destination.write(createRecord({ body: 'the report that could not be delivered' }));
    await destination.flush();

    expect(panel.requests[0].batch.entries[0].metadata?.body).toBe(
      'the report that could not be delivered',
    );
  });

  it('trims an entry to the caps Panel enforces', async () => {
    const panel = createPanelStub();
    const destination = createDestination({ fetchImpl: panel.fetchImpl });

    destination.write(createRecord({ message: 'm'.repeat(25_000), body: 'b'.repeat(40_000) }));
    await destination.flush();

    const [entry] = panel.requests[0].batch.entries;
    expect(entry.message).toHaveLength(10_000);
    expect(Buffer.byteLength(JSON.stringify(entry.metadata), 'utf8')).toBeLessThanOrEqual(8 * 1024);
    expect(entry.metadata?.agent_id).toBe('weekly-report');
  });

  it('never sends more than two hundred entries in one request', async () => {
    const panel = createPanelStub();
    const destination = createDestination({ fetchImpl: panel.fetchImpl });

    for (let index = 0; index < 250; index += 1) {
      destination.write(createRecord({ message: `entry ${index}` }));
    }
    await destination.flush();
    await destination.flush();

    expect(panel.requests[0].batch.entries).toHaveLength(200);
    expect(panel.requests[1].batch.entries).toHaveLength(50);
  });

  it('splits a batch that would exceed the body cap', async () => {
    const panel = createPanelStub();
    const destination = createDestination({ fetchImpl: panel.fetchImpl });

    for (let index = 0; index < 60; index += 1) {
      destination.write(createRecord({ message: `entry ${index}`, body: 'b'.repeat(9_000) }));
    }
    await destination.flush();
    await destination.flush();

    expect(panel.requests.length).toBeGreaterThan(1);
    for (const request of panel.requests) {
      expect(request.bodyBytes).toBeLessThanOrEqual(256 * 1024);
    }
  });

  it('holds entries for a run Panel has not heard of yet and retries later', async () => {
    let clock = 1_000;
    const panel = createPanelStub((callNumber) => (
      callNumber === 1 ? errorResponse(404) : okResponse()
    ));
    const destination = createDestination({ fetchImpl: panel.fetchImpl, now: () => clock });

    destination.write(createRecord({ message: 'before the status event' }));
    await destination.flush();
    await destination.flush();

    expect(panel.requests).toHaveLength(1);

    clock += 60_000;
    await destination.flush();

    expect(panel.requests).toHaveLength(2);
    expect(panel.requests[1].batch.entries[0].message).toBe('before the status event');
  });

  it('retries a rate limited batch and a server error', async () => {
    let clock = 1_000;
    const panel = createPanelStub((callNumber) => (
      callNumber === 1
        ? errorResponse(429, { 'retry-after': '2' })
        : callNumber === 2 ? errorResponse(503) : okResponse()
    ));
    const destination = createDestination({ fetchImpl: panel.fetchImpl, now: () => clock });

    destination.write(createRecord({ message: 'kept through the wobble' }));
    await destination.flush();

    clock += 2_500;
    await destination.flush();

    clock += 60_000;
    await destination.flush();

    expect(panel.requests).toHaveLength(3);
    expect(panel.requests[2].batch.entries[0].message).toBe('kept through the wobble');
  });

  it('retries when the network is unreachable', async () => {
    let clock = 1_000;
    let calls = 0;
    const fetchImpl: typeof globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) throw new Error('getaddrinfo ENOTFOUND');
      return okResponse();
    };
    const destination = createDestination({ fetchImpl, now: () => clock });

    destination.write(createRecord());
    await destination.flush();
    clock += 60_000;
    await destination.flush();

    expect(calls).toBe(2);
  });

  it('does not resend a batch Panel accepted', async () => {
    let clock = 1_000;
    const panel = createPanelStub();
    const destination = createDestination({ fetchImpl: panel.fetchImpl, now: () => clock });

    destination.write(createRecord());
    await destination.flush();
    clock += 600_000;
    await destination.flush();

    expect(panel.requests).toHaveLength(1);
  });

  it('discards a batch Panel refuses, because resending it would be refused too', async () => {
    let clock = 1_000;
    const warnings: string[] = [];
    const panel = createPanelStub((callNumber) => (
      callNumber === 1 ? errorResponse(400) : okResponse()
    ));
    const destination = createDestination({
      fetchImpl: panel.fetchImpl,
      now: () => clock,
      onWarn: (message) => warnings.push(message),
    });

    destination.write(createRecord());
    await destination.flush();
    clock += 600_000;
    await destination.flush();

    expect(panel.requests).toHaveLength(1);
    expect(warnings.join(' ')).toContain('400');
  });

  it('stops sending once the credential is rejected', async () => {
    let clock = 1_000;
    const panel = createPanelStub(() => errorResponse(401));
    const destination = createDestination({ fetchImpl: panel.fetchImpl, now: () => clock });

    destination.write(createRecord());
    await destination.flush();

    destination.write(createRecord({ message: 'later' }));
    clock += 600_000;
    await destination.flush();

    expect(panel.requests).toHaveLength(1);
  });

  it('gives up on a run that never becomes deliverable', async () => {
    let clock = 1_000;
    const warnings: string[] = [];
    const panel = createPanelStub(() => errorResponse(404));
    const destination = createDestination({
      fetchImpl: panel.fetchImpl,
      now: () => clock,
      onWarn: (message) => warnings.push(message),
    });

    destination.write(createRecord());
    for (let attempt = 0; attempt < 12; attempt += 1) {
      clock += 3_600_000;
      await destination.flush();
    }

    expect(panel.requests.length).toBeLessThanOrEqual(7);
    expect(warnings.join(' ')).toContain('gave up');
  });

  it('drops the oldest entries when the queue is full', async () => {
    const panel = createPanelStub();
    const warnings: string[] = [];
    const destination = createDestination({
      fetchImpl: panel.fetchImpl,
      maxQueuedEntries: 3,
      onWarn: (message) => warnings.push(message),
    });

    for (const message of ['one', 'two', 'three', 'four']) {
      destination.write(createRecord({ message }));
    }
    await destination.flush();

    expect(panel.requests[0].batch.entries.map((entry) => entry.message)).toEqual([
      'two',
      'three',
      'four',
    ]);
    expect(warnings.join(' ')).toContain('dropped');
  });

  it('never lets a delivery failure reach the caller', async () => {
    const destination = createDestination({
      fetchImpl: async () => {
        throw new Error('the panel is on fire');
      },
    });

    expect(() => destination.write(createRecord())).not.toThrow();
    await expect(destination.flush()).resolves.toBeUndefined();
  });

  it('delivers what it is holding when the server shuts down', async () => {
    const panel = createPanelStub();
    const destination = createDestination({ fetchImpl: panel.fetchImpl });

    destination.write(createRecord({ message: 'the last thing that happened' }));
    await destination.shutdown();

    expect(panel.requests).toHaveLength(1);
    expect(panel.requests[0].batch.entries[0].message).toBe('the last thing that happened');
  });

  it('ignores a record with no run to attach it to', async () => {
    const panel = createPanelStub();
    const destination = createDestination({ fetchImpl: panel.fetchImpl });

    destination.write(createRecord({ run_id: '' }));
    await destination.flush();

    expect(panel.requests).toHaveLength(0);
  });
});
