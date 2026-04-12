import type { StoredRun } from '../reporting/store.js';
import type { ProgressEvent } from './websocket.js';
export declare function sanitizeText(input: string, maxLength?: number): string;
export declare function sanitizePromptSuffix(input: string): string;
export declare function sanitizeStoredRun(run: StoredRun): StoredRun;
export declare function sanitizeProgressEvent(event: ProgressEvent): ProgressEvent;
export declare function getClientIp(request: Request, options?: {
    trustProxyHeaders?: boolean;
}): string;
type RateLimitResult = {
    allowed: boolean;
    retryAfterSeconds?: number;
};
export declare class InMemoryRateLimiter {
    private readonly maxRequests;
    private readonly windowMs;
    private readonly counters;
    constructor(maxRequests: number, windowMs: number);
    consume(key: string, now?: number): RateLimitResult;
}
export declare class AuthFailureTracker {
    private readonly maxFailures;
    private readonly banMs;
    private readonly records;
    constructor(maxFailures: number, banMs: number);
    isBlocked(key: string, now?: number): RateLimitResult;
    registerFailure(key: string, now?: number): RateLimitResult;
    registerSuccess(key: string): void;
}
export {};
//# sourceMappingURL=security-utils.d.ts.map