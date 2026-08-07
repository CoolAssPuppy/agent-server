import { z } from 'zod';
import { EXECUTOR_NAMES } from './executor.js';
import { ProviderConfigSchema } from './config.js';

export const RuntimeAssignmentAgentIdSchema = z.string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);

export const RuntimeAssignmentInputSchema = z.object({
  executor: z.enum(EXECUTOR_NAMES),
  model: z.string().trim().min(1).max(120).optional(),
  provider: ProviderConfigSchema.optional(),
}).strict();

export const RuntimeAssignmentSchema = RuntimeAssignmentInputSchema.extend({
  agent_id: RuntimeAssignmentAgentIdSchema,
  revision: z.number().int().positive(),
  updated_at: z.string().datetime(),
}).strict();

export const RuntimeAssignmentRegistrySchema = z.object({
  schema_version: z.literal(1),
  assignments: z.record(RuntimeAssignmentAgentIdSchema, RuntimeAssignmentSchema),
}).strict().superRefine((registry, context) => {
  for (const [agentId, assignment] of Object.entries(registry.assignments)) {
    if (assignment.agent_id !== agentId) {
      context.addIssue({
        code: 'custom',
        path: ['assignments', agentId, 'agent_id'],
        message: 'Assignment agent ID must match its registry key',
      });
    }
  }
});

export type RuntimeAssignmentInput = Readonly<z.infer<typeof RuntimeAssignmentInputSchema>>;
export type RuntimeAssignment = Readonly<z.infer<typeof RuntimeAssignmentSchema>>;
export type RuntimeAssignmentRegistry = z.infer<typeof RuntimeAssignmentRegistrySchema>;
