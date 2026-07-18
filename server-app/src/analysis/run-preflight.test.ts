import { describe, expect, it, vi } from 'vitest';
import type { PreflightResult } from './models.js';
import { evaluateRunPreflight } from './run-preflight.js';
import { createRunPreflightGate, RunPreflightDeniedError } from './run-preflight-gate.js';
import { RunStore } from '../reporting/store.js';
import { PreflightSkipRecorder } from './preflight-skip-recorder.js';
import { makeAgent } from '../test-factories.js';

const HASH = `sha256:${'a'.repeat(64)}`;

function preflight(overrides: Partial<PreflightResult> = {}): PreflightResult {
  return {
    schema_version: 1,
    agent_id: 'reporter',
    content_hash: HASH,
    analyzer_version: '1.1.0',
    decision: 'allow',
    risk: { level: 'low', reasons: [], finding_count: 0 },
    findings: [],
    acknowledgement_required: false,
    ...overrides,
  };
}

describe('canonical run preflight policy', () => {
  it('allows low, needs-review, and acknowledged high-risk runs', () => {
    expect(evaluateRunPreflight(preflight(), { source: 'manual' }).allowed).toBe(true);
    expect(evaluateRunPreflight(preflight({
      decision: 'allow', risk: { level: 'needs_review', reasons: ['Network'], finding_count: 0 },
    }), { source: 'schedule' }).allowed).toBe(true);
    expect(evaluateRunPreflight(preflight({
      decision: 'allow', risk: { level: 'high', reasons: ['File changes'], finding_count: 0 },
    }), { source: 'schedule' }).allowed).toBe(true);
  });

  it('requires the exact current content hash for manual high-risk confirmation', () => {
    const result = preflight({
      decision: 'confirm',
      risk: { level: 'high', reasons: ['File changes'], finding_count: 0 },
      acknowledgement_required: true,
    });
    expect(evaluateRunPreflight(result, { source: 'manual' })).toMatchObject({
      allowed: false, code: 'confirmation_required', contentHash: HASH,
    });
    expect(evaluateRunPreflight(result, {
      source: 'manual', confirmedContentHash: `sha256:${'b'.repeat(64)}`,
    })).toMatchObject({ allowed: false, code: 'content_changed' });
    expect(evaluateRunPreflight(result, {
      source: 'manual', confirmedContentHash: HASH,
    }).allowed).toBe(true);
  });

  it('blocks critical manual runs and unreviewed high-risk schedules', () => {
    expect(evaluateRunPreflight(preflight({
      decision: 'block', risk: { level: 'critical', reasons: ['Literal secret'], finding_count: 0 },
      acknowledgement_required: true,
    }), { source: 'manual' })).toMatchObject({ allowed: false, code: 'blocked' });
    expect(evaluateRunPreflight(preflight({
      decision: 'confirm', risk: { level: 'high', reasons: ['File changes'], finding_count: 0 },
      acknowledgement_required: true,
    }), { source: 'schedule' })).toMatchObject({ allowed: false, code: 'review_required' });
  });

  it('keeps an ephemeral safe test outside normal preflight blocking', () => {
    expect(evaluateRunPreflight(preflight({
      decision: 'block', risk: { level: 'critical', reasons: ['Saved definition is unsafe'], finding_count: 0 },
      acknowledgement_required: true,
    }), { source: 'safe_test' }).allowed).toBe(true);
  });

  it('prevents an unreviewed high-risk scheduler run and records one skipped outcome', async () => {
    const store = new RunStore();
    const trigger = vi.fn().mockReturnValue('run-1');
    const onAutomaticSkip = vi.fn();
    const gate = createRunPreflightGate({
      preflight: async () => preflight({
        decision: 'confirm', risk: { level: 'high', reasons: ['File changes'], finding_count: 0 },
        acknowledgement_required: true,
      }),
      trigger,
      skipRecorder: new PreflightSkipRecorder(store),
      onAutomaticSkip,
    });
    await expect(gate.run(makeAgent(), {}, { source: 'schedule' })).resolves.toBeUndefined();
    await expect(gate.run(makeAgent(), {}, { source: 'schedule' })).resolves.toBeUndefined();
    expect(trigger).not.toHaveBeenCalled();
    expect(store.list()[0]).toMatchObject({ status: 'skipped', error: expect.stringContaining('Security review') });
    expect(onAutomaticSkip).toHaveBeenCalledOnce();
    expect(onAutomaticSkip).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'test-agent' }),
      expect.objectContaining({ code: 'review_required' }),
      store.list()[0]?.runId,
    );
  });

  it('runs acknowledged high risk and bypasses saved-definition checks for safe tests', async () => {
    const preflightCheck = vi.fn().mockResolvedValue(preflight({
      decision: 'allow', risk: { level: 'high', reasons: ['Reviewed'], finding_count: 0 },
    }));
    const trigger = vi.fn().mockReturnValue('run-1');
    const gate = createRunPreflightGate({
      preflight: preflightCheck,
      trigger,
      skipRecorder: new PreflightSkipRecorder(new RunStore()),
    });
    await expect(gate.run(makeAgent(), {}, { source: 'schedule' })).resolves.toBe('run-1');
    await expect(gate.run(makeAgent(), {}, { source: 'safe_test' })).resolves.toBe('run-1');
    expect(preflightCheck).toHaveBeenCalledOnce();
  });

  it('throws a typed denial for manual callers', async () => {
    const gate = createRunPreflightGate({
      preflight: async () => preflight({
        decision: 'block', risk: { level: 'critical', reasons: ['Secret'], finding_count: 0 },
        acknowledgement_required: true,
      }),
      trigger: () => 'never',
      skipRecorder: new PreflightSkipRecorder(new RunStore()),
    });
    await expect(gate.run(makeAgent(), {}, { source: 'manual' })).rejects.toBeInstanceOf(RunPreflightDeniedError);
  });
});
