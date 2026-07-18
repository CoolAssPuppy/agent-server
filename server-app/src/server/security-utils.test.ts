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

  it('sanitizes stored run payload fields', () => {
    const run = makeStoredRun({
      summary: 'token=abc123',
      commandsRun: ['echo Authorization: Bearer should-hide'],
    });

    const sanitized = sanitizeStoredRun(run);
    expect(sanitized.summary).toContain('[REDACTED]');
    expect(sanitized.commandsRun[0]).toContain('[REDACTED]');
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
});
