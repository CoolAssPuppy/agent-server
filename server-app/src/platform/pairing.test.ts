import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  clearPairing,
  loadPairing,
  normalizePairingCode,
  redeemPairingCode,
  savePairing,
  type PairingRecord,
} from './pairing.js';

/**
 * Pairing is typed in by a person watching a screen, so every failure has to
 * come back as a sentence that says what to do next. And the credential it
 * produces names this machine to Panel, so how it is stored matters as much as
 * how it is obtained.
 */

const record = (overrides: Partial<PairingRecord> = {}): PairingRecord => ({
  credential: 'ap_live_secret_credential',
  orgId: '11111111-1111-4111-8111-111111111111',
  machineId: '22222222-2222-4222-8222-222222222222',
  displayName: "Prashant's MacBook Air",
  pairedAt: '2026-08-09T14:00:00.000Z',
  heartbeatIntervalSeconds: 60,
  ...overrides,
});

const okResponse = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status: 200 });

describe('Typing a code in', () => {
  it('ignores the spacing and case a person reads off a screen', () => {
    expect(normalizePairingCode(' abcd-efgh ')).toBe('ABCDEFGH');
    expect(normalizePairingCode('abcd efgh')).toBe('ABCDEFGH');
  });

  it('says so when the code is obviously too short, without asking Panel', async () => {
    const fetchFn = vi.fn();
    const result = await redeemPairingCode({
      code: 'ABC',
      panelUrl: 'https://panel.test',
      machineId: 'm1',
      serverVersion: '3.6.1',
      fetch: fetchFn as never,
    });

    expect(result).toMatchObject({ ok: false });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('Redeeming a code', () => {
  it('sends what Panel needs and keeps what comes back', async () => {
    const fetchFn = vi.fn(async () => okResponse({
      protocol_version: 2,
      machine_id: 'machine-uuid',
      org_id: 'org-uuid',
      credential: 'ap_live_abc',
      heartbeat_interval_seconds: 45,
    }));

    const result = await redeemPairingCode({
      code: 'abcd-efgh',
      panelUrl: 'https://panel.test',
      machineId: 'machine-uuid',
      serverVersion: '3.6.1',
      displayName: 'Test Mac',
      fetch: fetchFn as never,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record).toMatchObject({
      credential: 'ap_live_abc',
      orgId: 'org-uuid',
      heartbeatIntervalSeconds: 45,
    });

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://panel.test/api/machines/register');
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({
      protocol_version: 2,
      // Normalized before it goes, so a code typed with a dash still works.
      pairing_code: 'ABCDEFGH',
      machine_id: 'machine-uuid',
      display_name: 'Test Mac',
      server_version: '3.6.1',
    });
  });

  it('names the machine after the computer when nobody chose a name', async () => {
    const fetchFn = vi.fn(async () => okResponse({
      org_id: 'org-uuid', credential: 'ap_live_abc',
    }));

    const result = await redeemPairingCode({
      code: 'ABCDEFGH',
      panelUrl: 'https://panel.test',
      machineId: 'm1',
      serverVersion: '3.6.1',
      fetch: fetchFn as never,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.displayName.length).toBeGreaterThan(0);
  });

  it('explains a used or expired code, which is the common mistake', async () => {
    for (const status of [404, 410]) {
      const result = await redeemPairingCode({
        code: 'ABCDEFGH',
        panelUrl: 'https://panel.test',
        machineId: 'm1',
        serverVersion: '3.6.1',
        fetch: vi.fn(async () => new Response('{}', { status })) as never,
      });

      expect(result).toMatchObject({ ok: false });
      if (result.ok) return;
      expect(result.error).toMatch(/not valid any more|generate a new one/i);
    }
  });

  it('repeats what Panel said rather than inventing its own wording', async () => {
    const result = await redeemPairingCode({
      code: 'ABCDEFGH',
      panelUrl: 'https://panel.test',
      machineId: 'm1',
      serverVersion: '3.6.1',
      fetch: vi.fn(async () => new Response(
        JSON.stringify({ error: 'This Panel speaks protocol version 2.' }),
        { status: 400 },
      )) as never,
    });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toBe('This Panel speaks protocol version 2.');
  });

  it('survives an unreachable Panel', async () => {
    const result = await redeemPairingCode({
      code: 'ABCDEFGH',
      panelUrl: 'https://panel.test',
      machineId: 'm1',
      serverVersion: '3.6.1',
      fetch: vi.fn(async () => {
        throw new Error('network down');
      }) as never,
    });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toMatch(/could not reach/i);
  });

  it('refuses a reply with no credential in it', async () => {
    const result = await redeemPairingCode({
      code: 'ABCDEFGH',
      panelUrl: 'https://panel.test',
      machineId: 'm1',
      serverVersion: '3.6.1',
      fetch: vi.fn(async () => okResponse({ org_id: 'org-uuid' })) as never,
    });

    expect(result.ok).toBe(false);
  });
});

describe('Keeping the credential', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pairing-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round trips', () => {
    savePairing(dir, record());
    expect(loadPairing(dir)).toMatchObject({
      credential: 'ap_live_secret_credential',
      orgId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('is readable only by its owner', () => {
    savePairing(dir, record());
    const mode = statSync(join(dir, 'panel-credential.json')).mode & 0o777;

    // It is a live credential for somebody's organization.
    expect(mode).toBe(0o600);
  });

  it('reports nothing when this machine has never paired', () => {
    expect(loadPairing(dir)).toBeUndefined();
  });

  it('reports nothing rather than throwing on a damaged file', () => {
    // An unpaired daemon and one with a corrupt credential should both fall
    // back to the API key and keep working.
    writeFileSync(join(dir, 'panel-credential.json'), 'not json at all');
    expect(loadPairing(dir)).toBeUndefined();

    writeFileSync(join(dir, 'panel-credential.json'), JSON.stringify({ credential: 'x' }));
    expect(loadPairing(dir)).toBeUndefined();
  });

  it('forgets on request, and forgetting twice is not an error', () => {
    savePairing(dir, record());
    clearPairing(dir);
    expect(loadPairing(dir)).toBeUndefined();
    expect(() => clearPairing(dir)).not.toThrow();
  });

  it('replaces an existing credential when the machine pairs again', () => {
    savePairing(dir, record());
    savePairing(dir, record({ credential: 'ap_live_second', orgId: '33333333-3333-4333-8333-333333333333' }));

    expect(loadPairing(dir)).toMatchObject({
      credential: 'ap_live_second',
      orgId: '33333333-3333-4333-8333-333333333333',
    });
  });
});
