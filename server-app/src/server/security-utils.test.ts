import { describe, expect, it } from 'vitest';
import { AuthFailureTracker, InMemoryRateLimiter, getClientIp, sanitizeStoredRun, sanitizeText } from './security-utils.js';
import { makeStoredRun } from '../test-factories.js';

describe('security-utils', () => {
  it('redacts secrets from text', () => {
    const text = sanitizeText('Authorization: Bearer secret-token-value');
    expect(text).toContain('[REDACTED]');
    expect(text).not.toContain('secret-token-value');
  });

  it('sanitizes stored run payload fields', () => {
    const run = makeStoredRun({
      summary: 'token=abc123',
      commandsRun: ['echo Authorization: Bearer should-hide'],
    });

    const sanitized = sanitizeStoredRun(run);
    expect(sanitized.summary).toContain('[REDACTED]');
    expect(sanitized.commandsRun[0]).toContain('[REDACTED]');
  });

  it('enforces rate limits', () => {
    const limiter = new InMemoryRateLimiter(2, 1000);
    expect(limiter.consume('ip').allowed).toBe(true);
    expect(limiter.consume('ip').allowed).toBe(true);
    expect(limiter.consume('ip').allowed).toBe(false);
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

  it('can trust proxy headers when explicitly enabled', () => {
    const request = new Request('http://localhost/test', {
      headers: {
        'x-forwarded-for': '203.0.113.5, 198.51.100.8',
      },
    });

    expect(getClientIp(request, { trustProxyHeaders: true })).toBe('203.0.113.5');
  });

  it('blocks after repeated auth failures', () => {
    const tracker = new AuthFailureTracker(2, 10_000);
    expect(tracker.registerFailure('ip').allowed).toBe(true);
    expect(tracker.registerFailure('ip').allowed).toBe(false);
    expect(tracker.isBlocked('ip').allowed).toBe(false);
    tracker.registerSuccess('ip');
    expect(tracker.isBlocked('ip').allowed).toBe(true);
  });
});
