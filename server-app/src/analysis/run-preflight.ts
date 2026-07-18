import type { PreflightResult } from './models.js';

export type RunTriggerSource =
  | 'manual'
  | 'schedule'
  | 'watcher'
  | 'chain'
  | 'interaction'
  | 'panel'
  | 'channel'
  | 'safe_test';

export type RunPreflightContext = {
  source: RunTriggerSource;
  confirmedContentHash?: string;
};

export type RunPreflightOutcome =
  | { allowed: true; contentHash: string }
  | {
    allowed: false;
    code: 'confirmation_required' | 'content_changed' | 'blocked' | 'review_required';
    message: string;
    contentHash: string;
  };

export function evaluateRunPreflight(
  preflight: PreflightResult,
  context: RunPreflightContext,
): RunPreflightOutcome {
  if (context.source === 'safe_test') {
    return { allowed: true, contentHash: preflight.content_hash };
  }
  if (preflight.decision === 'block') {
    return {
      allowed: false,
      code: 'blocked',
      message: 'Security check blocked this run until critical risks are resolved.',
      contentHash: preflight.content_hash,
    };
  }
  if (preflight.decision === 'allow') {
    return { allowed: true, contentHash: preflight.content_hash };
  }
  if (context.source !== 'manual') {
    return {
      allowed: false,
      code: 'review_required',
      message: 'Security review is required before this agent can run automatically.',
      contentHash: preflight.content_hash,
    };
  }
  if (!context.confirmedContentHash) {
    return {
      allowed: false,
      code: 'confirmation_required',
      message: 'Security review confirmation required',
      contentHash: preflight.content_hash,
    };
  }
  if (context.confirmedContentHash !== preflight.content_hash) {
    return {
      allowed: false,
      code: 'content_changed',
      message: 'The agent changed after review. Review the current security check before running.',
      contentHash: preflight.content_hash,
    };
  }
  return { allowed: true, contentHash: preflight.content_hash };
}
