import { z } from 'zod';

export const V2CommandActionSchema = z.enum([
  'run',
  'cancel',
  'retry',
  'pause',
  'resume',
  'answer',
  'approve',
  'test_connection',
]);

const V2CommandStatusSchema = z.enum([
  'requested',
  'accepted',
  'rejected',
  'started',
  'completed',
  'failed',
  'canceled',
  'expired',
]);

export const V2CommandRequestSchema = z.object({
  protocolVersion: z.literal(2),
  commandId: z.uuid(),
  targetMachineId: z.uuid(),
  localAgentId: z.string().trim().min(1).max(200),
  action: V2CommandActionSchema,
  idempotencyKey: z.string().trim().min(1).max(500),
  requestedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  status: V2CommandStatusSchema,
}).strict().superRefine((command, context) => {
  if (Date.parse(command.requestedAt) >= Date.parse(command.expiresAt)) {
    context.addIssue({
      code: 'custom',
      path: ['expiresAt'],
      message: 'Command expiry must be later than its request time',
    });
  }
});

export type V2CommandAction = z.infer<typeof V2CommandActionSchema>;
export type V2CommandRequest = z.infer<typeof V2CommandRequestSchema>;

export type V2CommandBoundaryState = Readonly<{
  machineId: string;
  processedCommandIds: readonly string[];
  processedIdempotencyKeys: readonly string[];
}>;

export type V2LocalCommandPolicyResult =
  | Readonly<{ accepted: true }>
  | Readonly<{ accepted: false; explanation: string }>;

export type V2CommandBoundaryOptions = Readonly<{
  now: Date;
  state: V2CommandBoundaryState;
  supportedActions: readonly V2CommandAction[];
  localPolicy: (command: Readonly<V2CommandRequest>) => V2LocalCommandPolicyResult;
}>;

export type V2CommandRejectionCode =
  | 'invalid_command'
  | 'target_machine_mismatch'
  | 'command_expired'
  | 'command_not_requested'
  | 'command_already_processed'
  | 'command_action_unsupported'
  | 'local_policy_rejected';

export type V2CommandBoundaryResult =
  | Readonly<{
    accepted: true;
    status: 'accepted';
    command: V2CommandRequest;
    state: V2CommandBoundaryState;
  }>
  | Readonly<{
    accepted: false;
    status: 'rejected' | 'expired' | 'ignored';
    code: V2CommandRejectionCode;
    explanation: string;
    state: V2CommandBoundaryState;
  }>;

/**
 * Evaluate one V2 command against caller-owned replay state and local policy.
 * The reducer is side-effect free.
 */
export function reduceV2Command(
  input: unknown,
  options: V2CommandBoundaryOptions,
): V2CommandBoundaryResult {
  const parsed = V2CommandRequestSchema.safeParse(input);
  if (!parsed.success) {
    return reject(options.state, 'invalid_command', 'The command payload is invalid.');
  }

  const command = parsed.data;
  if (command.targetMachineId !== options.state.machineId) {
    return reject(
      options.state,
      'target_machine_mismatch',
      'The command targets a different machine.',
      'ignored',
    );
  }

  if (command.status !== 'requested') {
    return reject(
      options.state,
      'command_not_requested',
      'The command is not in requested status.',
    );
  }

  if (options.now.getTime() >= Date.parse(command.expiresAt)) {
    return reject(
      options.state,
      'command_expired',
      'The command has expired.',
      'expired',
    );
  }

  if (
    options.state.processedCommandIds.includes(command.commandId)
    || options.state.processedIdempotencyKeys.includes(command.idempotencyKey)
  ) {
    return reject(
      options.state,
      'command_already_processed',
      'The command or its idempotency key was already processed.',
      'ignored',
    );
  }

  if (!options.supportedActions.includes(command.action)) {
    return reject(
      options.state,
      'command_action_unsupported',
      `The ${command.action} action is not supported locally.`,
    );
  }

  const policyResult = options.localPolicy(command);
  if (!policyResult.accepted) {
    return reject(
      options.state,
      'local_policy_rejected',
      policyResult.explanation,
    );
  }

  return {
    accepted: true,
    status: 'accepted',
    command,
    state: {
      machineId: options.state.machineId,
      processedCommandIds: [
        ...options.state.processedCommandIds,
        command.commandId,
      ],
      processedIdempotencyKeys: [
        ...options.state.processedIdempotencyKeys,
        command.idempotencyKey,
      ],
    },
  };
}

function reject(
  state: V2CommandBoundaryState,
  code: V2CommandRejectionCode,
  explanation: string,
  status: 'rejected' | 'expired' | 'ignored' = 'rejected',
): V2CommandBoundaryResult {
  return {
    accepted: false,
    status,
    code,
    explanation,
    state,
  };
}
