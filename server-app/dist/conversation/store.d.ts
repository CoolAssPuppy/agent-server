import type { Conversation } from './schema.js';
export declare class ConversationStore {
    private readonly conversations;
    private readonly maxConversations;
    constructor(maxConversations?: number);
    create(chatId: number, agentId: string, ttlMs: number): Conversation;
    get(id: string): Conversation | undefined;
    findActive(chatId: number, agentId: string): Conversation | undefined;
    findActiveByChat(chatId: number): Conversation | undefined;
    addMessage(conversationId: string, role: 'user' | 'assistant', content: string): void;
    expire(conversationId: string): void;
    expireStale(): string[];
    private evictOldestIfNeeded;
}
//# sourceMappingURL=store.d.ts.map