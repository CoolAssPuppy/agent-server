/**
 * Whether reporting to Agent Panel is actually working.
 *
 * Every reporter already knows the outcome of its own deliveries and logs it
 * to the terminal, where nobody is looking. This is the one place those
 * outcomes accumulate so /health can answer "is Panel hearing from this Mac"
 * -- the question that went unanswered while a superseded credential got 401
 * on every event and runs silently vanished from Panel.
 *
 * One instance per server. Reporters write into it; /health reads it.
 */

const FAILING_THRESHOLD = 3;
const MAX_FAILURE_TEXT = 200;

export type PanelHealthSnapshot = {
  /** `unknown` until the first delivery outcome of this process. */
  state: 'unknown' | 'ok' | 'failing';
  last_success_at: string | null;
  last_failure_at: string | null;
  /** Short human-readable reason, e.g. "HTTP 401". */
  last_failure: string | null;
  consecutive_failures: number;
};

export class PanelHealth {
  private lastSuccessAt: Date | null = null;
  private lastFailureAt: Date | null = null;
  private lastFailure: string | null = null;
  private consecutiveFailures = 0;

  recordSuccess(now: Date = new Date()): void {
    this.lastSuccessAt = now;
    this.consecutiveFailures = 0;
  }

  recordFailure(reason: string, now: Date = new Date()): void {
    this.lastFailureAt = now;
    this.lastFailure = reason.slice(0, MAX_FAILURE_TEXT);
    this.consecutiveFailures += 1;
  }

  snapshot(): PanelHealthSnapshot {
    return {
      state: this.state(),
      last_success_at: this.lastSuccessAt?.toISOString() ?? null,
      last_failure_at: this.lastFailureAt?.toISOString() ?? null,
      last_failure: this.lastFailure,
      consecutive_failures: this.consecutiveFailures,
    };
  }

  private state(): PanelHealthSnapshot['state'] {
    if (!this.lastSuccessAt && !this.lastFailureAt) return 'unknown';
    // Heartbeats go out every minute, so one dropped request self-heals
    // before anybody could act on it. Three in a row is a condition.
    if (this.consecutiveFailures >= FAILING_THRESHOLD) return 'failing';
    return 'ok';
  }
}
