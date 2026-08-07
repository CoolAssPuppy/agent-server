import { z } from 'zod';

export const AgentConnectionSlotKeySchema = z.string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/);

const PortableTypeSchema = z.string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);

const SemanticOperationSchema = z.string()
  .min(3)
  .max(160)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/);

export const AgentConnectionResourceSlotSchema = z.object({
  type: PortableTypeSchema,
  purpose: z.string().trim().min(1).max(500),
  access: z.enum(['read', 'write', 'read_write']),
}).strict();

export const AgentConnectionUseSchema = z.object({
  type: PortableTypeSchema,
  name: z.string().trim().min(1).max(120),
  purpose: z.string().trim().min(1).max(500),
  operations: z.array(SemanticOperationSchema).min(1).max(128),
  resources: z.record(
    AgentConnectionSlotKeySchema,
    AgentConnectionResourceSlotSchema,
  ).default({}),
}).strict().superRefine((connection, context) => {
  if (new Set(connection.operations).size !== connection.operations.length) {
    context.addIssue({
      code: 'custom',
      path: ['operations'],
      message: 'Connection operations must be unique',
    });
  }
});

export const AgentConnectionUsesSchema = z.record(
  AgentConnectionSlotKeySchema,
  AgentConnectionUseSchema,
).superRefine((connections, context) => {
  const normalizedNames = Object.values(connections)
    .map(({ name }) => name.toLocaleLowerCase());
  if (new Set(normalizedNames).size !== normalizedNames.length) {
    context.addIssue({
      code: 'custom',
      message: 'Connection names must be unique within an agent',
    });
  }
});

export type AgentConnectionUse = z.infer<typeof AgentConnectionUseSchema>;
export type AgentConnectionUses = z.infer<typeof AgentConnectionUsesSchema>;
