import { describe, expect, it } from 'vitest';

import {
  reduceV2Command,
  type V2CommandBoundaryState,
  type V2CommandRequest,
} from './v2-command.js';

const machineId = '1d2f8f5e-9ea8-4fce-89b1-1c7c2f5ecf99';
const now = new Date('2026-08-02T10:00:00.000Z');

const baseCommand: V2CommandRequest = {
  protocolVersion: 2,
  commandId: 'e566a8f5-becf-49e7-a384-a72d42e9f807',
  targetMachineId: machineId,
  localAgentId: 'weekly-report',
  action: 'run',
  idempotencyKey: 'weekly-report:2026-08-02',
  requestedAt: '2026-08-02T09:59:00.000Z',
  expiresAt: '2026-08-02T10:01:00.000Z',
  status: 'requested',
};

const initialState: V2CommandBoundaryState = {
  machineId,
  processedCommandIds: [],
  processedIdempotencyKeys: [],
};

const allActions = [
  'run',
  'cancel',
  'retry',
  'pause',
  'resume',
  'answer',
  'approve',
  'test_connection',
] as const;

function reduce(
  command: unknown = baseCommand,
  state: V2CommandBoundaryState = initialState,
) {
  return reduceV2Command(command, {
    now,
    state,
    supportedActions: allActions,
    localPolicy: () => ({ accepted: true }),
  });
}

describe('reduceV2Command', () => {
  it.each(allActions)('accepts the validated %s action and advances replay state', (action) => {
    const command = { ...baseCommand, action, idempotencyKey: `key:${action}` };

    const result = reduce(command);

    expect(result).toEqual({
      accepted: true,
      status: 'accepted',
      command,
      state: {
        machineId,
        processedCommandIds: [command.commandId],
        processedIdempotencyKeys: [command.idempotencyKey],
      },
    });
    expect(initialState.processedCommandIds).toEqual([]);
    expect(initialState.processedIdempotencyKeys).toEqual([]);
  });

  it.each([
    null,
    { ...baseCommand, protocolVersion: 3 },
    { ...baseCommand, action: 'delete' },
    { ...baseCommand, extra: true },
    { ...baseCommand, commandId: 'not-a-uuid' },
    { ...baseCommand, expiresAt: 'tomorrow' },
  ])('fails closed for a malformed or extended command', (command) => {
    const result = reduce(command);

    expect(result).toMatchObject({
      accepted: false,
      status: 'rejected',
      code: 'invalid_command',
      state: initialState,
    });
    expect(result.state).toBe(initialState);
  });

  it('ignores a command for any machine other than the exact local identity', () => {
    const result = reduce({
      ...baseCommand,
      targetMachineId: '3fe519ca-bec1-4e16-ab3a-2baffdc9b97b',
    });

    expect(result).toMatchObject({
      accepted: false,
      status: 'ignored',
      code: 'target_machine_mismatch',
    });
    expect(result.state).toBe(initialState);
  });

  it('rejects a valid command that is no longer requested', () => {
    const result = reduce({ ...baseCommand, status: 'accepted' });

    expect(result).toMatchObject({
      accepted: false,
      status: 'rejected',
      code: 'command_not_requested',
    });
    expect(result.state).toBe(initialState);
  });

  it('expires a command when now equals expiresAt', () => {
    const result = reduce({ ...baseCommand, expiresAt: now.toISOString() });

    expect(result).toMatchObject({
      accepted: false,
      status: 'expired',
      code: 'command_expired',
    });
    expect(result.state).toBe(initialState);
  });

  it('accepts a command one millisecond before expiresAt', () => {
    const result = reduce({
      ...baseCommand,
      expiresAt: new Date(now.getTime() + 1).toISOString(),
    });

    expect(result).toMatchObject({
      accepted: true,
      status: 'accepted',
    });
  });

  it.each([
    { requestedAt: baseCommand.expiresAt, expiresAt: baseCommand.expiresAt },
    {
      requestedAt: '2026-08-02T10:02:00.000Z',
      expiresAt: '2026-08-02T10:01:00.000Z',
    },
  ])('rejects invalid requestedAt and expiresAt chronology', (chronology) => {
    const result = reduce({ ...baseCommand, ...chronology });

    expect(result).toMatchObject({
      accepted: false,
      status: 'rejected',
      code: 'invalid_command',
    });
    expect(result.state).toBe(initialState);
  });

  it.each([
    {
      state: { ...initialState, processedCommandIds: [baseCommand.commandId] },
      label: 'command ID',
    },
    {
      state: { ...initialState, processedIdempotencyKeys: [baseCommand.idempotencyKey] },
      label: 'idempotency key',
    },
  ])('ignores replay by $label', ({ state }) => {
    const result = reduce(baseCommand, state);

    expect(result).toMatchObject({
      accepted: false,
      status: 'ignored',
      code: 'command_already_processed',
    });
    expect(result.state).toBe(state);
  });

  it('rejects an action that this caller does not support', () => {
    const result = reduceV2Command(baseCommand, {
      now,
      state: initialState,
      supportedActions: ['pause', 'resume'],
      localPolicy: () => ({ accepted: true }),
    });

    expect(result).toMatchObject({
      accepted: false,
      status: 'rejected',
      code: 'command_action_unsupported',
    });
    expect(result.state).toBe(initialState);
  });

  it('returns the local policy explanation without advancing state', () => {
    const result = reduceV2Command(baseCommand, {
      now,
      state: initialState,
      supportedActions: allActions,
      localPolicy: () => ({
        accepted: false,
        explanation: 'Manual runs are disabled on this machine.',
      }),
    });

    expect(result).toMatchObject({
      accepted: false,
      status: 'rejected',
      code: 'local_policy_rejected',
      explanation: 'Manual runs are disabled on this machine.',
    });
    expect(result.state).toBe(initialState);
  });
});
