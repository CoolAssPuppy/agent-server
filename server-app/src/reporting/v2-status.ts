import { z } from 'zod';

const StatusStateSchema = z.enum([
  'submitted',
  'working',
  'input_required',
  'completed',
  'failed',
  'canceled',
  'rejected',
]);

const StableReasonCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,119}$/);

const V2OperationalStatusInputSchema = z.object({
  machineId: z.uuid(),
  processId: z.string().trim().min(1).max(200),
  localAgentId: z.string().trim().min(1).max(200),
  runId: z.uuid(),
  state: z.union([StatusStateSchema, z.literal('skipped')]),
  timestamp: z.iso.datetime(),
  reasonCode: StableReasonCodeSchema.optional(),
}).strict().superRefine((event, context) => {
  if (event.state === 'skipped' && !event.reasonCode) {
    context.addIssue({
      code: 'custom',
      path: ['reasonCode'],
      message: 'A skipped run requires a stable reason code',
    });
  }
});

export const V2OperationalStatusEventSchema = z.object({
  protocol_version: z.literal(2),
  machine_id: z.uuid(),
  process_id: z.string().min(1).max(200),
  local_agent_id: z.string().min(1).max(200),
  run_id: z.uuid(),
  state: StatusStateSchema,
  timestamp: z.iso.datetime(),
  privacy_level: z.literal('operational'),
  reason_code: StableReasonCodeSchema.optional(),
}).strict();

export type V2OperationalStatusInput = z.input<typeof V2OperationalStatusInputSchema>;
export type V2OperationalStatusEvent = z.infer<typeof V2OperationalStatusEventSchema>;

/** Build a deterministic V2 event containing operational metadata only. */
export function serializeV2OperationalStatus(
  input: V2OperationalStatusInput,
): V2OperationalStatusEvent {
  const event = V2OperationalStatusInputSchema.parse(input);
  return V2OperationalStatusEventSchema.parse({
    protocol_version: 2,
    machine_id: event.machineId,
    process_id: event.processId,
    local_agent_id: event.localAgentId,
    run_id: event.runId,
    state: event.state === 'skipped' ? 'completed' : event.state,
    timestamp: event.timestamp,
    privacy_level: 'operational',
    ...(event.reasonCode ? { reason_code: event.reasonCode } : {}),
  });
}
