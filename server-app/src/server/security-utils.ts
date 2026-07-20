import type { ProgressEvent } from './websocket.js';

// eslint-disable-next-line no-control-regex -- intentionally strips control characters
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const LONG_HORIZONTAL_SPACE_PATTERN = /[^\S\n]{2,}/g;
const EXCESSIVE_NEWLINES_PATTERN = /\n{4,}/g;

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-(?:ant|live|test)?[-_a-zA-Z0-9]{12,}\b/g,
  /\bap_(?:live|test)?[-_a-zA-Z0-9]{8,}\b/g,
  /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{10,}\b/gi,
  /\b(x-agent-server-key\s*[:=]\s*)[^\s,;]+/gi,
  /\b(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi,
  /\b(authorization\s*[:=]\s*['"]?bearer\s+)[^\s,;'"}]+/gi,
  /\b(password|passwd|token|secret|api[_-]?key)\s*[:=]\s*['"][^'"]+['"]/gi,
  /\b(password|passwd|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
];

const OMITTED_METADATA_KEYS = new Set([
  'tool_call',
  'tool_calls',
  'tool_input',
  'tool_inputs',
  'tool_output',
  'tool_outputs',
]);

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
    .replace(LONG_HORIZONTAL_SPACE_PATTERN, ' ')
    .replace(EXCESSIVE_NEWLINES_PATTERN, '\n\n\n')
    .trim();

  const redacted = replaceSecrets(cleaned);
  if (redacted.length <= maxLength) return redacted;
  if (maxLength <= 0) return '';
  return `${redacted.slice(0, maxLength - 1)}…`;
}

export function sanitizePromptSuffix(input: string): string {
  return sanitizeText(input, 4_000);
}

/**
 * Sanitizes an unknown JSON-like value with hard depth and collection bounds.
 * Tool-call payloads are omitted because they can contain full file contents,
 * command output, and credentials that a string redactor cannot classify.
 */
export function sanitizeStructuredValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[TRUNCATED]';
  if (typeof value === 'string') return sanitizeText(value, 800);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => sanitizeStructuredValue(entry, depth + 1));
  }
  if (typeof value !== 'object') return undefined;

  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 50)) {
    if (OMITTED_METADATA_KEYS.has(key.toLowerCase())) continue;
    const safeEntry = sanitizeStructuredValue(entry, depth + 1);
    if (safeEntry !== undefined) sanitized[sanitizeText(key, 120)] = safeEntry;
  }
  return sanitized;
}

export function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return sanitizeStructuredValue(metadata) as Record<string, unknown>;
}

export function sanitizeProgressEvent(event: ProgressEvent): ProgressEvent {
  return {
    ...event,
    message: event.message ? sanitizeText(event.message, 400) : undefined,
    error: event.error ? sanitizeText(event.error, 400) : undefined,
    summary: event.summary ? sanitizeText(event.summary, 800) : undefined,
    metadata: event.metadata ? sanitizeMetadata(event.metadata) : undefined,
  };
}

export function getClientIp(
  request: Request,
  options: { trustProxyHeaders?: boolean; remoteAddress?: string } = {},
): string {
  const remoteAddress = options.remoteAddress?.trim();
  if (remoteAddress) return remoteAddress;

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

const DEFAULT_MAX_TRACKED_KEYS = 10_000;

function evictOldestEntry<T>(entries: Map<string, T>): void {
  const oldestKey = entries.keys().next().value;
  if (oldestKey !== undefined) entries.delete(oldestKey);
}

export class InMemoryRateLimiter {
  private readonly counters = new Map<string, Counter>();
  private nextSweepAt = 0;

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly maxTrackedKeys: number = DEFAULT_MAX_TRACKED_KEYS,
  ) {}

  consume(key: string, now: number = Date.now()): RateLimitResult {
    this.sweepIfNeeded(now);
    const current = this.counters.get(key);
    if (!current || current.resetAt <= now) {
      if (!current && this.counters.size >= this.maxTrackedKeys) {
        evictOldestEntry(this.counters);
      }
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

  private sweepIfNeeded(now: number): void {
    if (now < this.nextSweepAt && this.counters.size < this.maxTrackedKeys) return;
    for (const [key, counter] of this.counters) {
      if (counter.resetAt <= now) this.counters.delete(key);
    }
    this.nextSweepAt = now + Math.min(this.windowMs, 60_000);
  }
}

type BanRecord = {
  failures: number;
  blockedUntil: number;
  expiresAt: number;
};

function evictOldestUnblockedRecord(records: Map<string, BanRecord>, now: number): boolean {
  for (const [key, record] of records) {
    if (record.blockedUntil <= now) {
      records.delete(key);
      return true;
    }
  }
  return false;
}

export class AuthFailureTracker {
  private readonly records = new Map<string, BanRecord>();
  private nextSweepAt = 0;

  constructor(
    private readonly maxFailures: number,
    private readonly banMs: number,
    private readonly maxTrackedKeys: number = DEFAULT_MAX_TRACKED_KEYS,
  ) {}

  isBlocked(key: string, now: number = Date.now()): RateLimitResult {
    this.sweepIfNeeded(now);
    const record = this.records.get(key);
    if (!record) return { allowed: true };
    if (record.blockedUntil > 0 && record.blockedUntil <= now) {
      this.records.delete(key);
      return { allowed: true };
    }

    if (record.blockedUntil === 0) return { allowed: true };

    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((record.blockedUntil - now) / 1000)),
    };
  }

  registerFailure(key: string, now: number = Date.now()): RateLimitResult {
    this.sweepIfNeeded(now);
    const record = this.records.get(key);
    if (!record) {
      if (this.records.size >= this.maxTrackedKeys) {
        const hasCapacity = evictOldestUnblockedRecord(this.records, now);
        if (!hasCapacity) {
          return {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil(this.banMs / 1000)),
          };
        }
      }
      this.records.set(key, { failures: 1, blockedUntil: 0, expiresAt: now + this.banMs });
      return { allowed: true };
    }

    record.failures += 1;
    record.expiresAt = now + this.banMs;
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

  private sweepIfNeeded(now: number): void {
    if (now < this.nextSweepAt && this.records.size < this.maxTrackedKeys) return;
    for (const [key, record] of this.records) {
      if (record.expiresAt <= now) this.records.delete(key);
    }
    this.nextSweepAt = now + Math.min(this.banMs, 60_000);
  }
}
