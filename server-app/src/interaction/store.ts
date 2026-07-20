import type { InteractionRequest } from './schema.js';
import { evictOldest, sweepExpired } from '../util/map-store.js';

export type PendingInteraction = {
  id: string;
  runId: string;
  agentId: string;
  replyAgentId: string;
  request: InteractionRequest;
  channel: string;
  createdAt: Date;
  expiresAt: Date;
  status: 'pending' | 'acted' | 'expired';
};

export type AddInteractionInput = Omit<PendingInteraction, 'status'>;

const MAX_INTERACTIONS = 1_000;

export class InteractionStore {
  private interactions = new Map<string, PendingInteraction>();

  add(input: AddInteractionInput): void {
    this.interactions.set(input.id, { ...input, status: 'pending' });
    this.evictOldestIfNeeded();
  }

  get(id: string): PendingInteraction | undefined {
    return this.interactions.get(id);
  }

  markActed(id: string): void {
    const interaction = this.interactions.get(id);
    if (interaction) {
      this.interactions.set(id, { ...interaction, status: 'acted' });
    }
  }

  remove(id: string): void {
    this.interactions.delete(id);
  }

  expireStale(): string[] {
    return sweepExpired(this.interactions, new Date(), {
      isActive: (i) => i.status === 'pending',
      hasExpired: (i, now) => i.expiresAt <= now,
      toExpired: (i) => ({ ...i, status: 'expired' as const }),
    });
  }

  listPending(): PendingInteraction[] {
    return [...this.interactions.values()].filter((i) => i.status === 'pending');
  }

  private evictOldestIfNeeded(): void {
    evictOldest(this.interactions, MAX_INTERACTIONS, (i) => i.createdAt.getTime());
  }
}
