import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  TelemetryReporter,
  replayPendingTerminals,
  PENDING_TERMINALS_DIR,
  type StatusEvent,
} from './reporter.js';

type TerminalFile = {
  runId: string;
  endpoint: string;
  body: StatusEvent;
  apiKey?: string;
};

function writePendingFile(dir: string, entry: TerminalFile): string {
  const file = join(dir, `${entry.runId}.json`);
  writeFileSync(file, JSON.stringify(entry), 'utf8');
  return file;
}

describe('replayPendingTerminals', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pending-replay-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('replays every persisted file and deletes on 2xx', async () => {
    const file1 = writePendingFile(tmp, {
      runId: 'run-a',
      endpoint: 'https://panel.example/api/runs/run-a/status',
      body: { agent: 'A', state: 'completed' },
    });
    const file2 = writePendingFile(tmp, {
      runId: 'run-b',
      endpoint: 'https://panel.example/api/runs/run-b/status',
      body: { agent: 'B', state: 'failed' },
    });

    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await replayPendingTerminals({
      fetchImpl,
      getApiKey: () => 'ap_live_secret',
      panelUrl: 'https://panel.example',
    }, tmp);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const headers1 = fetchImpl.mock.calls[0][1].headers;
    expect(headers1.Authorization).toBe('Bearer ap_live_secret');
    expect(existsSync(file1)).toBe(false);
    expect(existsSync(file2)).toBe(false);
  });

  it('deletes file on 409 (panel already has terminal state)', async () => {
    const file = writePendingFile(tmp, {
      runId: 'run-a',
      endpoint: 'https://panel.example/api/runs/run-a/status',
      body: { agent: 'A', state: 'completed' },
    });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 409 });

    await replayPendingTerminals({
      fetchImpl,
      getApiKey: () => 'ap_live_secret',
      panelUrl: 'https://panel.example',
    }, tmp);

    expect(existsSync(file)).toBe(false);
  });

  it('keeps file on 5xx so a future replay can retry', async () => {
    const file = writePendingFile(tmp, {
      runId: 'run-a',
      endpoint: 'https://panel.example/api/runs/run-a/status',
      body: { agent: 'A', state: 'completed' },
    });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 502, statusText: 'Bad Gateway' });

    await replayPendingTerminals({
      fetchImpl,
      getApiKey: () => 'ap_live_secret',
      panelUrl: 'https://panel.example',
    }, tmp);

    expect(existsSync(file)).toBe(true);
  });

  it('accepts legacy files that embed apiKey (forward migration)', async () => {
    const file = writePendingFile(tmp, {
      runId: 'run-legacy',
      endpoint: 'https://panel.example/api/runs/run-legacy/status',
      apiKey: 'ap_live_legacy',
      body: { agent: 'A', state: 'completed' },
    });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    // No current key — replay must fall back to the embedded one.
    await replayPendingTerminals({
      fetchImpl,
      getApiKey: () => undefined,
      panelUrl: 'https://panel.example',
    }, tmp);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const headers = fetchImpl.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer ap_live_legacy');
    expect(existsSync(file)).toBe(false);
  });

  it('exports the default PENDING_TERMINALS_DIR pointing at the user home', () => {
    expect(PENDING_TERMINALS_DIR).toMatch(/\.agent-server\/pending-terminals$/);
  });

  it('refuses to replay entries that target a different origin', async () => {
    const file = writePendingFile(tmp, {
      runId: 'run-evil',
      endpoint: 'https://attacker.example/collect',
      body: { agent: 'A', state: 'failed' },
    });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await replayPendingTerminals({
      fetchImpl,
      getApiKey: () => 'ap_live_secret',
      panelUrl: 'https://panel.example',
    }, tmp);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(existsSync(file)).toBe(true);
  });

  it('refuses to replay entries with unexpected paths', async () => {
    const file = writePendingFile(tmp, {
      runId: 'run-bad-path',
      endpoint: 'https://panel.example/api/other',
      body: { agent: 'A', state: 'failed' },
    });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await replayPendingTerminals({
      fetchImpl,
      getApiKey: () => 'ap_live_secret',
      panelUrl: 'https://panel.example',
    }, tmp);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(existsSync(file)).toBe(true);
  });
});

describe('TelemetryReporter persistence', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pending-persist-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('does NOT embed the API key in persisted pending-terminal JSON', async () => {
    // Use fake timers so we can sprint through the retry ladder quickly, then
    // real timers to let the async writeFile settle.
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Unavailable' });

    const reporter = new TelemetryReporter({
      runId: 'run-secret',
      agentName: 'Agent',
      endpoint: 'https://panel.example/api/runs/run-secret/status',
      apiKey: 'ap_live_supersecret',
      fetch: fetchImpl,
      heartbeatMs: 0,
      pendingTerminalsDir: tmp,
    });

    const failPromise = reporter.fail(new Error('boom'));
    // Immediate retries: 500 + 1000 + 2000 ms.
    await vi.advanceTimersByTimeAsync(5000);
    await failPromise;
    // Deferred retries: 5s + 10s + 20s + 40s + 80s.
    await vi.advanceTimersByTimeAsync(200_000);

    vi.useRealTimers();
    // Yield so the async persistPendingTerminal writeFile can settle.
    await new Promise((r) => setTimeout(r, 50));

    const file = join(tmp, 'run-secret.json');
    expect(existsSync(file)).toBe(true);
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    expect(parsed.apiKey).toBeUndefined();
    expect(parsed.runId).toBe('run-secret');
    expect(parsed.endpoint).toBe('https://panel.example/api/runs/run-secret/status');
    expect(parsed.body.state).toBe('failed');

    // And a subsequent replay succeeds using the current-config API key.
    const successFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await replayPendingTerminals({
      fetchImpl: successFetch,
      getApiKey: () => 'ap_live_fresh_key',
      panelUrl: 'https://panel.example',
    }, tmp);

    expect(successFetch).toHaveBeenCalledTimes(1);
    const headers = successFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer ap_live_fresh_key');
    expect(existsSync(file)).toBe(false);

    reporter.stop();
  });
});
