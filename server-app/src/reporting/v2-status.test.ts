import { describe, expect, it } from 'vitest';

import { serializeV2OperationalStatus } from './v2-status.js';

const baseEvent = {
  machineId: '1d2f8f5e-9ea8-4fce-89b1-1c7c2f5ecf99',
  processId: 'office-mac-1234',
  localAgentId: 'weekly-report',
  runId: 'e566a8f5-becf-49e7-a384-a72d42e9f807',
  state: 'completed' as const,
  timestamp: '2026-08-01T09:00:00.000Z',
};

describe('serializeV2OperationalStatus', () => {
  it('builds the exact operational envelope without rich local content', () => {
    expect(serializeV2OperationalStatus(baseEvent)).toEqual({
      protocol_version: 2,
      machine_id: baseEvent.machineId,
      process_id: baseEvent.processId,
      local_agent_id: baseEvent.localAgentId,
      run_id: baseEvent.runId,
      state: 'completed',
      timestamp: baseEvent.timestamp,
      privacy_level: 'operational',
    });
  });

  it('reports a local skipped run as completed with a stable reason code', () => {
    const serialized = serializeV2OperationalStatus({
      ...baseEvent,
      state: 'skipped',
      reasonCode: 'security_preflight_review_required',
    });

    expect(serialized.state).toBe('completed');
    expect(serialized.reason_code).toBe('security_preflight_review_required');
  });

  it('requires a stable reason when mapping a skipped run', () => {
    expect(() => serializeV2OperationalStatus({
      ...baseEvent,
      state: 'skipped',
    })).toThrow('reason code');
  });

  it('rejects invalid machine and run identity instead of emitting ambiguous telemetry', () => {
    expect(() => serializeV2OperationalStatus({ ...baseEvent, machineId: 'office-mac' })).toThrow();
    expect(() => serializeV2OperationalStatus({ ...baseEvent, runId: 'run-123' })).toThrow();
  });

  it('preserves canceled state and accepts only a bounded stable reason code', () => {
    expect(serializeV2OperationalStatus({
      ...baseEvent,
      state: 'canceled',
      reasonCode: 'user_requested',
    })).toMatchObject({
      state: 'canceled',
      reason_code: 'user_requested',
    });
    expect(() => serializeV2OperationalStatus({
      ...baseEvent,
      reasonCode: 'Contains spaces',
    })).toThrow();
  });
});
