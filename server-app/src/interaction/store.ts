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

export class InteractionStore {
  private interactions = new Map<string, PendingInteraction>();

  add(input: AddInteractionInput): void {
    this.interactions.set(input.id, { ...input, status: 'pending' });
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
    }

    return expired;
  }

  listPending(): PendingInteraction[] {
    return [...this.interactions.values()].filter((i) => i.status === 'pending');
  }
}
