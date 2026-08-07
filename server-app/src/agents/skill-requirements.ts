import { z } from 'zod';

export const AgentSkillSlotKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

export const AgentSkillRequirementsSchema = z.record(
  AgentSkillSlotKeySchema,
  z.object({
    name: z.string().trim().min(1).max(120),
    purpose: z.string().trim().min(1).max(500),
  }).strict(),
);

export type AgentSkillRequirements = z.infer<typeof AgentSkillRequirementsSchema>;
