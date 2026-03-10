import type { InteractionRequest } from './schema.js';

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

  expireStale(): string[] {
    const now = new Date();
    const expired: string[] = [];

    for (const [id, interaction] of this.interactions) {
      if (interaction.status === 'pending' && interaction.expiresAt <= now) {
        this.interactions.set(id, { ...interaction, status: 'expired' });
        expired.push(id);
      }

      if (interaction.status !== 'pending' && now.getTime() - interaction.createdAt.getTime() > 24 * 60 * 60 * 1000) {
        this.interactions.delete(id);
      }
    }

    return expired;
  }

  listPending(): PendingInteraction[] {
    return [...this.interactions.values()].filter((i) => i.status === 'pending');
  }

  private evictOldestIfNeeded(): void {
    if (this.interactions.size <= MAX_INTERACTIONS) return;

    const entries = [...this.interactions.entries()]
      .sort(([, a], [, b]) => a.createdAt.getTime() - b.createdAt.getTime());

    const removeCount = this.interactions.size - MAX_INTERACTIONS;
    for (const [id] of entries.slice(0, removeCount)) {
      this.interactions.delete(id);
    }
  }
}
