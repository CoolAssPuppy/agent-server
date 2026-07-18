import { randomUUID } from 'crypto';
import type { Conversation, ConversationMessage } from './schema.js';
import { evictOldest, sweepExpired } from '../util/map-store.js';

const MAX_MESSAGES = 50;
const MAX_CONTENT_LENGTH = 4_000;
const DEFAULT_MAX_CONVERSATIONS = 100;

function truncateContent(content: string): string {
  if (content.length <= MAX_CONTENT_LENGTH) return content;
  return content.slice(0, MAX_CONTENT_LENGTH);
}

export class ConversationStore {
  private readonly conversations = new Map<string, Conversation>();
  private readonly maxConversations: number;

  constructor(maxConversations: number = DEFAULT_MAX_CONVERSATIONS) {
    this.maxConversations = maxConversations;
  }

  create(chatId: number, agentId: string, ttlMs: number): Conversation {
    const now = new Date();
    const conversation: Conversation = {
      id: randomUUID(),
      chatId,
      agentId,
      messages: [],
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
      status: 'active',
    };

    this.conversations.set(conversation.id, conversation);
    this.evictOldestIfNeeded();
    return { ...conversation };
  }

  get(id: string): Conversation | undefined {
    const conv = this.conversations.get(id);
    return conv ? { ...conv, messages: [...conv.messages] } : undefined;
  }

  findActive(chatId: number, agentId: string): Conversation | undefined {
    for (const conv of this.conversations.values()) {
      if (conv.chatId === chatId && conv.agentId === agentId && conv.status === 'active') {
        return { ...conv, messages: [...conv.messages] };
      }
    }
    return undefined;
  }

  findActiveByChat(chatId: number): Conversation | undefined {
    for (const conv of this.conversations.values()) {
      if (conv.chatId === chatId && conv.status === 'active') {
        return { ...conv, messages: [...conv.messages] };
      }
    }
    return undefined;
  }

  addMessage(conversationId: string, role: 'user' | 'assistant', content: string): void {
    const conv = this.conversations.get(conversationId);
    if (!conv) return;

    const message: ConversationMessage = {
      role,
      content: truncateContent(content),
      createdAt: new Date(),
    };

    const nextMessages = [...conv.messages, message];
    const trimmed = nextMessages.length > MAX_MESSAGES
      ? nextMessages.slice(nextMessages.length - MAX_MESSAGES)
      : nextMessages;

    this.conversations.set(conversationId, { ...conv, messages: trimmed });
  }

  expire(conversationId: string): void {
    const conv = this.conversations.get(conversationId);
    if (conv) {
      this.conversations.set(conversationId, { ...conv, status: 'expired' });
    }
  }

  expireStale(): string[] {
    return sweepExpired(this.conversations, new Date(), {
      isActive: (c) => c.status === 'active',
      hasExpired: (c, now) => c.expiresAt <= now,
      toExpired: (c) => ({ ...c, status: 'expired' as const }),
    });
  }

  private evictOldestIfNeeded(): void {
    evictOldest(this.conversations, this.maxConversations, (c) => c.createdAt.getTime());
  }
}
