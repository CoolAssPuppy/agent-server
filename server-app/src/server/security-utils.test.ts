import { describe, expect, it } from 'vitest';
import {
  AuthFailureTracker,
  InMemoryRateLimiter,
  getClientIp,
  sanitizeProgressEvent,
  sanitizeStoredRun,
  sanitizeText,
} from './security-utils.js';
import { makeStoredRun } from '../test-factories.js';

describe('security-utils', () => {
  it('redacts secrets from text', () => {
    const text = sanitizeText('Authorization: Bearer secret-token-value');
    expect(text).toContain('[REDACTED]');
    expect(text).not.toContain('secret-token-value');
  });

  it('does not preserve API credential values as redaction prefixes', () => {
    const secret = 'sk-live-abcdefghijklmnop';
    expect(sanitizeText(`Use ${secret} for access`)).not.toContain(secret);
  });

  it('keeps truncated text within the requested character limit', () => {
    const text = sanitizeText('A detailed description that exceeds its field.', 20);

    expect(text).toHaveLength(20);
    expect(text.endsWith('…')).toBe(true);
  });

  it('sanitizes stored run payload fields', () => {
    const run = makeStoredRun({
      summary: 'token=abc123',
      commandsRun: ['echo Authorization: Bearer should-hide'],
      retryOfRunId: 'failed-run-token="secret-value"',
      repairId: 'repair-token="secret-value"',
    });

    const sanitized = sanitizeStoredRun(run);
    expect(sanitized.summary).toContain('[REDACTED]');
    expect(sanitized.commandsRun[0]).toContain('[REDACTED]');
    expect(sanitized.retryOfRunId).not.toContain('secret-value');
    expect(sanitized.repairId).not.toContain('secret-value');
  });

  it('removes tool-call payloads and redacts nested WebSocket metadata', () => {
    const sanitized = sanitizeProgressEvent({
      type: 'run_progress',
      runId: 'run-1',
      agentId: 'agent-1',
      timestamp: '2026-07-18T12:00:00.000Z',
      metadata: {
        turns_completed: 2,
        tool_calls: [{ input: { token: 'secret-value' }, output: 'private file contents' }],
        mcp_servers: [{ name: 'slack', error: 'Authorization: Bearer hidden-token-value' }],
      },
    });

    expect(sanitized.metadata?.turns_completed).toBe(2);
    expect(sanitized.metadata).not.toHaveProperty('tool_calls');
    expect(JSON.stringify(sanitized.metadata)).not.toContain('hidden-token-value');
    expect(JSON.stringify(sanitized.metadata)).toContain('[REDACTED]');
  });

  it('enforces rate limits', () => {
    const limiter = new InMemoryRateLimiter(2, 1000);
    expect(limiter.consume('ip').allowed).toBe(true);
    expect(limiter.consume('ip').allowed).toBe(true);
    expect(limiter.consume('ip').allowed).toBe(false);
  });

  it('bounds rate-limit keys and evicts the oldest active counter', () => {
    const limiter = new InMemoryRateLimiter(1, 10_000, 2);
    expect(limiter.consume('first', 1).allowed).toBe(true);
    expect(limiter.consume('second', 2).allowed).toBe(true);
    expect(limiter.consume('third', 3).allowed).toBe(true);

    expect(limiter.consume('first', 4).allowed).toBe(true);
  });

  it('sweeps expired rate-limit counters before applying the bound', () => {
    const limiter = new InMemoryRateLimiter(1, 100, 2);
    limiter.consume('expired-a', 1);
    limiter.consume('expired-b', 2);

    expect(limiter.consume('current', 200).allowed).toBe(true);
    expect(limiter.consume('expired-a', 201).allowed).toBe(true);
  });


  it('does not trust proxy headers by default when extracting client IP', () => {
    const request = new Request('http://localhost/test', {
      headers: {
        'x-forwarded-for': '203.0.113.5',
        'x-real-ip': '198.51.100.8',
      },
    });

    expect(getClientIp(request)).toBe('unknown');
  });

  it('uses the server-provided socket address when available', () => {
    const request = new Request('http://localhost/test');

    expect(getClientIp(request, { remoteAddress: '127.0.0.2' })).toBe('127.0.0.2');
  });

  it('can trust proxy headers when explicitly enabled', () => {
    const request = new Request('http://localhost/test', {
      headers: {
        'x-forwarded-for': '203.0.113.5, 198.51.100.8',
      },
    });

    expect(getClientIp(request, { trustProxyHeaders: true })).toBe('203.0.113.5');
  });

  it('preserves newlines in sanitized text', () => {
    const text = sanitizeText('Line one\n\nLine two\n\nLine three', 500);
    expect(text).toBe('Line one\n\nLine two\n\nLine three');
  });

  it('collapses excessive newlines but keeps up to three', () => {
    const text = sanitizeText('Line one\n\n\n\n\n\nLine two', 500);
    expect(text).toBe('Line one\n\n\nLine two');
  });

  it('collapses repeated horizontal spaces without affecting newlines', () => {
    const text = sanitizeText('hello     world\n\ngoodbye     world', 500);
    expect(text).toBe('hello world\n\ngoodbye world');
  });

  it('blocks after repeated auth failures', () => {
    const tracker = new AuthFailureTracker(2, 10_000);
    expect(tracker.registerFailure('ip').allowed).toBe(true);
    expect(tracker.registerFailure('ip').allowed).toBe(false);
    expect(tracker.isBlocked('ip').allowed).toBe(false);
    tracker.registerSuccess('ip');
    expect(tracker.isBlocked('ip').allowed).toBe(true);
  });

  it('retains failures while checking an unblocked client', () => {
    const tracker = new AuthFailureTracker(2, 10_000);

    tracker.registerFailure('ip');
    expect(tracker.isBlocked('ip').allowed).toBe(true);
    expect(tracker.registerFailure('ip').allowed).toBe(false);
  });

  it('bounds authentication records and evicts the oldest client', () => {
    const tracker = new AuthFailureTracker(2, 10_000, 2);
    tracker.registerFailure('first', 1);
    tracker.registerFailure('second', 2);
    tracker.registerFailure('third', 3);

    expect(tracker.registerFailure('first', 4).allowed).toBe(true);
  });

  it('never evicts an active ban when new client keys fill the tracker', () => {
    const tracker = new AuthFailureTracker(2, 10_000, 2);
    tracker.registerFailure('banned', 1);
    expect(tracker.registerFailure('banned', 2).allowed).toBe(false);
    tracker.registerFailure('unblocked', 3);

    tracker.registerFailure('churn', 4);

    expect(tracker.isBlocked('banned', 5).allowed).toBe(false);
    expect(tracker.registerFailure('unblocked', 6).allowed).toBe(true);
  });

  it('rejects new tracking entries instead of evicting when every record is actively banned', () => {
    const tracker = new AuthFailureTracker(2, 10_000, 2);
    tracker.registerFailure('first', 1);
    expect(tracker.registerFailure('first', 2).allowed).toBe(false);
    tracker.registerFailure('second', 3);
    expect(tracker.registerFailure('second', 4).allowed).toBe(false);

    expect(tracker.registerFailure('churn', 5).allowed).toBe(false);
    expect(tracker.isBlocked('first', 6).allowed).toBe(false);
    expect(tracker.isBlocked('second', 6).allowed).toBe(false);
  });

  it('sweeps authentication failures after the retention window', () => {
    const tracker = new AuthFailureTracker(2, 100, 2);
    tracker.registerFailure('expired-a', 1);
    tracker.registerFailure('expired-b', 2);

    expect(tracker.registerFailure('current', 200).allowed).toBe(true);
    expect(tracker.registerFailure('expired-a', 201).allowed).toBe(true);
  });
});
