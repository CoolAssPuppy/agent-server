import { z } from 'zod';

import type { AgentConfig } from '../agents/config.js';
import { getNextRun } from '../agents/scheduler.js';
import { computeAgentContentHash } from '../analysis/security-rules.js';

/**
 * One assistant on the wire.
 *
 * Panel parses this with a strict schema, so an extra key is a rejected sync
 * rather than an ignored field. The machine and the protocol version are named
 * once by the payload around these rows and must not be repeated here.
 */
const V2AssistantSyncRowSchema = z.object({
  local_agent_id: z.string().trim().min(1).max(200),
  display_name: z.string().trim().min(1).max(200),
  enabled: z.boolean(),
  // Bare hex, no algorithm prefix. Panel stores this in a 64 character column,
  // so "sha256:" ahead of the digest does not fit.
  definition_hash: z.string().regex(/^[a-f0-9]{64}$/),
  description: z.string().min(1).max(2_000).optional(),
  cron_expression: z.string().min(1).max(120).optional(),
  next_run_at: z.iso.datetime().optional(),
  timezone: z.string().min(1).max(60).optional(),
}).strict();

export const V2AssistantSyncPayloadSchema = z.object({
  protocol_version: z.literal(2),
  machine_id: z.uuid(),
  /** Says what this payload is allowed to contain: identity and schedule, no instructions. */
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
        local_agent_id: agent.id,
        display_name: agent.name,
        enabled: agent.enabled,
        definition_hash: wireDigest(content),
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

/**
 * The same digest the local security analysis uses, without its label.
 *
 * Locally a hash is written "sha256:..." so the algorithm travels with it. The
 * wire field is a fixed 64 character column, so the label is dropped here at
 * the boundary rather than two different hashes being computed.
 */
function wireDigest(content: string): string {
  return computeAgentContentHash(content).replace(/^sha256:/, '');
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
