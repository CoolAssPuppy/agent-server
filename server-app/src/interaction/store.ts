import { randomUUID } from 'node:crypto';

import type { InteractionRequest } from './schema.js';
import { evictOldest, sweepExpired } from '../util/map-store.js';

export const MAX_INTERACTION_RESPONSE_TEXT_LENGTH = 4_000;

export type InteractionClaimResponse =
  | {
      type: 'option';
      optionIndex: number;
      label: string;
      value: string;
    }
  | {
      type: 'text';
      value: string;
    };

export type InteractionClaim = {
  interactionId: string;
  claimToken: string;
  replyAgentId: string;
  response: InteractionClaimResponse;
};

export type InteractionClaimResult =
  | { ok: true; claim: InteractionClaim }
  | {
      ok: false;
      reason: 'not_found' | 'expired' | 'not_pending' | 'invalid_response';
    };

export type PendingInteraction = {
  id: string;
  runId: string;
  agentId: string;
  replyAgentId: string;
  request: InteractionRequest;
  channel: string;
  createdAt: Date;
  expiresAt: Date;
  status: 'pending' | 'processing' | 'acted' | 'expired';
};

export type AddInteractionInput = Omit<PendingInteraction, 'status'>;

const DEFAULT_MAX_INTERACTIONS = 1_000;

export class InteractionStore {
  private interactions = new Map<string, PendingInteraction>();
  private claimTokens = new Map<string, string>();
  private readonly maxInteractions: number;

  constructor(
    private readonly createClaimToken: () => string = randomUUID,
    maxInteractions: number = DEFAULT_MAX_INTERACTIONS,
  ) {
    this.maxInteractions = maxInteractions;
  }

  add(input: AddInteractionInput): void {
    this.claimTokens.delete(input.id);
    this.interactions.set(input.id, { ...input, status: 'pending' });
    this.evictOldestIfNeeded();
  }

  get(id: string): PendingInteraction | undefined {
    return this.interactions.get(id);
  }

  markActed(id: string): void {
    const interaction = this.interactions.get(id);
    if (interaction && interaction.status !== 'processing') {
      this.claimTokens.delete(id);
      this.interactions.set(id, { ...interaction, status: 'acted' });
    }
  }

  remove(id: string): void {
    this.claimTokens.delete(id);
    this.interactions.delete(id);
  }

  claim(id: string, response: unknown, now = new Date()): InteractionClaimResult {
    const interaction = this.interactions.get(id);
    if (!interaction) {
      return { ok: false, reason: 'not_found' };
    }

    if (interaction.status !== 'pending') {
      return { ok: false, reason: 'not_pending' };
    }

    if (interaction.expiresAt <= now) {
      this.interactions.set(id, { ...interaction, status: 'expired' });
      return { ok: false, reason: 'expired' };
    }

    const validatedResponse = validateClaimResponse(interaction.request, response);
    if (!validatedResponse) {
      return { ok: false, reason: 'invalid_response' };
    }

    const claimToken = this.createClaimToken();
    this.claimTokens.set(id, claimToken);
    this.interactions.set(id, { ...interaction, status: 'processing' });

    return {
      ok: true,
      claim: {
        interactionId: id,
        claimToken,
        replyAgentId: interaction.replyAgentId,
        response: validatedResponse,
      },
    };
  }

  complete(id: string, claimToken: string): boolean {
    const interaction = this.matchClaim(id, claimToken);
    if (!interaction) {
      return false;
    }

    this.claimTokens.delete(id);
    this.interactions.set(id, { ...interaction, status: 'acted' });
    return true;
  }

  restore(id: string, claimToken: string, now = new Date()): boolean {
    const interaction = this.matchClaim(id, claimToken);
    if (!interaction) {
      return false;
    }

    this.claimTokens.delete(id);
    const status = interaction.expiresAt <= now ? 'expired' : 'pending';
    this.interactions.set(id, { ...interaction, status });
    return true;
  }

  expireStale(): string[] {
    const expiredIds = sweepExpired(this.interactions, new Date(), {
      isActive: (i) => i.status === 'pending',
      hasExpired: (i, now) => i.expiresAt <= now,
      toExpired: (i) => ({ ...i, status: 'expired' as const }),
    });
    this.dropOrphanedClaimTokens();
    return expiredIds;
  }

  listPending(): PendingInteraction[] {
    return [...this.interactions.values()].filter((i) => i.status === 'pending');
  }

  private evictOldestIfNeeded(): void {
    evictOldest(this.interactions, this.maxInteractions, (i) => i.createdAt.getTime());
    this.dropOrphanedClaimTokens();
  }

  /**
   * Removes claim tokens whose interaction is gone.
   *
   * Capacity eviction and the stale sweep delete straight out of the
   * interactions map, and a claimed interaction carries a second entry in
   * `claimTokens` that neither of them knows about. A token left behind can
   * never be redeemed — `matchClaim` needs the interaction too — so this leaks
   * memory rather than authority, growing by one entry per claimed interaction
   * that is evicted or swept.
   */
  private dropOrphanedClaimTokens(): void {
    if (this.claimTokens.size === 0) return;
    for (const id of this.claimTokens.keys()) {
      if (!this.interactions.has(id)) this.claimTokens.delete(id);
    }
  }

  private matchClaim(id: string, claimToken: string): PendingInteraction | undefined {
    const interaction = this.interactions.get(id);
    if (
      interaction?.status !== 'processing' ||
      this.claimTokens.get(id) !== claimToken
    ) {
      return undefined;
    }

    return interaction;
  }
}

function validateClaimResponse(
  request: InteractionRequest,
  response: unknown,
): InteractionClaimResponse | undefined {
  if (!isRecord(response) || typeof response.type !== 'string') {
    return undefined;
  }

  if (response.type === 'option') {
    if (!hasExactKeys(response, ['type', 'optionIndex'])) {
      return undefined;
    }
    const optionIndex = response.optionIndex;
    if (typeof optionIndex !== 'number' || !Number.isInteger(optionIndex)) {
      return undefined;
    }

    const option = request.options?.[optionIndex];
    if (!option) {
      return undefined;
    }

    return {
      type: 'option',
      optionIndex,
      label: option.label,
      value: option.value,
    };
  }

  if (response.type === 'text') {
    if (!hasExactKeys(response, ['type', 'text'])) {
      return undefined;
    }
    if (!request.freeText || typeof response.text !== 'string') {
      return undefined;
    }

    const value = response.text.trim();
    if (value.length === 0 || value.length > MAX_INTERACTION_RESPONSE_TEXT_LENGTH) {
      return undefined;
    }

    return { type: 'text', value };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.hasOwn(value, key));
}
