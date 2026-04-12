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
export declare class InteractionStore {
    private interactions;
    add(input: AddInteractionInput): void;
    get(id: string): PendingInteraction | undefined;
    markActed(id: string): void;
    expireStale(): string[];
    listPending(): PendingInteraction[];
    private evictOldestIfNeeded;
}
//# sourceMappingURL=store.d.ts.map