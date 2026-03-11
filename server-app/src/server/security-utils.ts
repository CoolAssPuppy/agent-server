import type { StoredRun } from '../reporting/store.js';
import type { ProgressEvent } from './websocket.js';

const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const LONG_WHITESPACE_PATTERN = /\s{2,}/g;

const SECRET_PATTERNS: RegExp[] = [
  /\b(sk-(?:ant|live|test)?[-_a-zA-Z0-9]{12,})\b/g,
  /\b(ap_(?:live|test)?[-_a-zA-Z0-9]{8,})\b/g,
  /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{10,}\b/gi,
  /\b(x-agent-server-key\s*[:=]\s*)[^\s,;]+/gi,
  /\b(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi,
  /\b(password|passwd|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
];

function replaceSecrets(text: string): string {
  let sanitized = text;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, (_m, prefix?: string) => {
      if (prefix) return `${prefix}[REDACTED]`;
      return '[REDACTED]';
    });
  }
  return sanitized;
}

export function sanitizeText(input: string, maxLength = 512): string {
  const cleaned = input
    .replace(CONTROL_CHAR_PATTERN, ' ')
    .replace(LONG_WHITESPACE_PATTERN, ' ')
    .trim();

  const redacted = replaceSecrets(cleaned);
  if (redacted.length <= maxLength) return redacted;
  return `${redacted.slice(0, maxLength)}…`;
}

export function sanitizePromptSuffix(input: string): string {
  return sanitizeText(input, 4_000);
}

export function sanitizeStoredRun(run: StoredRun): StoredRun {
  return {
    ...run,
    summary: run.summary ? sanitizeText(run.summary, 2_000) : undefined,
    error: run.error ? sanitizeText(run.error, 1_000) : undefined,
    toolsUsed: run.toolsUsed.slice(0, 64).map((x) => sanitizeText(x, 120)),
    filesRead: run.filesRead.slice(0, 128).map((x) => sanitizeText(x, 240)),
    filesWritten: run.filesWritten.slice(0, 128).map((x) => sanitizeText(x, 240)),
    commandsRun: run.commandsRun.slice(0, 128).map((x) => sanitizeText(x, 400)),
    progressMessages: run.progressMessages.slice(-200).map((x) => sanitizeText(x, 400)),
  };
}

export function sanitizeProgressEvent(event: ProgressEvent): ProgressEvent {
  return {
    ...event,
    message: event.message ? sanitizeText(event.message, 400) : undefined,
    error: event.error ? sanitizeText(event.error, 400) : undefined,
    summary: event.summary ? sanitizeText(event.summary, 800) : undefined,
    metadata: event.metadata,
  };
}

export function getClientIp(request: Request, options: { trustProxyHeaders?: boolean } = {}): string {
  const trustProxyHeaders = options.trustProxyHeaders === true;

  if (trustProxyHeaders) {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) {
      const first = forwarded.split(',')[0]?.trim();
      if (first) return first;
    }

    const realIp = request.headers.get('x-real-ip')?.trim();
    if (realIp) return realIp;
  }

  return 'unknown';
}

type RateLimitResult = { allowed: boolean; retryAfterSeconds?: number };

type Counter = {
  count: number;
  resetAt: number;
};

export class InMemoryRateLimiter {
  private readonly counters = new Map<string, Counter>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  consume(key: string, now: number = Date.now()): RateLimitResult {
    const current = this.counters.get(key);
    if (!current || current.resetAt <= now) {
      this.counters.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true };
    }

    if (current.count >= this.maxRequests) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      };
    }

    current.count += 1;
    return { allowed: true };
  }
}

type BanRecord = {
  failures: number;
  blockedUntil: number;
};

export class AuthFailureTracker {
  private readonly records = new Map<string, BanRecord>();

  constructor(
    private readonly maxFailures: number,
    private readonly banMs: number,
  ) {}

  isBlocked(key: string, now: number = Date.now()): RateLimitResult {
    const record = this.records.get(key);
    if (!record) return { allowed: true };
    if (record.blockedUntil <= now) {
      this.records.delete(key);
      return { allowed: true };
    }

    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((record.blockedUntil - now) / 1000)),
    };
  }

  registerFailure(key: string, now: number = Date.now()): RateLimitResult {
    const record = this.records.get(key);
    if (!record) {
      this.records.set(key, { failures: 1, blockedUntil: 0 });
      return { allowed: true };
    }

    record.failures += 1;
    if (record.failures >= this.maxFailures) {
      record.blockedUntil = now + this.banMs;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(this.banMs / 1000)),
      };
    }

    return { allowed: true };
  }

  registerSuccess(key: string): void {
    this.records.delete(key);
  }
}
