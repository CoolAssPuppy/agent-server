import { z } from 'zod';

import type { AgentConfig } from '../agents/config.js';
import { getNextRun } from '../agents/scheduler.js';
import { computeAgentContentHash } from '../analysis/security-rules.js';

const V2AssistantSyncRowSchema = z.object({
  protocol_version: z.literal(2),
  machine_id: z.uuid(),
  local_agent_id: z.string().trim().min(1).max(200),
  display_name: z.string().trim().min(1).max(200),
  enabled: z.boolean(),
  definition_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  description: z.string().min(1).max(2_000).optional(),
  cron_expression: z.string().min(1).optional(),
  next_run_at: z.iso.datetime().optional(),
  timezone: z.string().min(1).optional(),
}).strict();

export const V2AssistantSyncPayloadSchema = z.object({
  protocol_version: z.literal(2),
  machine_id: z.uuid(),
  privacy_level: z.literal('operational'),
  assistants: z.array(V2AssistantSyncRowSchema),
}).strict();

export type V2AssistantSyncPayload = z.infer<typeof V2AssistantSyncPayloadSchema>;

export type AssistantDefinition = {
  agent: AgentConfig;
  content: string;
};

export type V2AssistantSyncOptions = {
  machineId: string;
  now: Date;
  includeDescriptions?: boolean;
};

/** Serialize assistant definitions without exposing instructions or local access details. */
export function buildV2AssistantSyncPayload(
  definitions: readonly AssistantDefinition[],
  options: V2AssistantSyncOptions,
): V2AssistantSyncPayload {
  const seenIds = new Set<string>();
  const assistants = [...definitions]
    .sort((left, right) => left.agent.id.localeCompare(right.agent.id))
    .map(({ agent, content }) => {
      if (seenIds.has(agent.id)) {
        throw new Error(`Duplicate local assistant identity: ${agent.id}`);
      }
      seenIds.add(agent.id);

      const description = options.includeDescriptions
        ? normalizedDescription(agent.description)
        : undefined;
      const nextRunAt = computeNextRun(agent, options.now);

      return {
        protocol_version: 2 as const,
        machine_id: options.machineId,
        local_agent_id: agent.id,
        display_name: agent.name,
        enabled: agent.enabled,
        definition_hash: computeAgentContentHash(content),
        ...(description ? { description } : {}),
        ...(agent.schedule ? { cron_expression: agent.schedule } : {}),
        ...(nextRunAt ? { next_run_at: nextRunAt } : {}),
        ...(agent.timezone ? { timezone: agent.timezone } : {}),
      };
    });

  return V2AssistantSyncPayloadSchema.parse({
    protocol_version: 2,
    machine_id: options.machineId,
    privacy_level: 'operational',
    assistants,
  });
}

function normalizedDescription(description: string | undefined): string | undefined {
  const normalized = description?.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, 2_000);
}

function computeNextRun(agent: AgentConfig, now: Date): string | undefined {
  if (!agent.schedule) return undefined;
  try {
    return getNextRun(agent, now)?.toISOString();
  } catch {
    return undefined;
  }
}
