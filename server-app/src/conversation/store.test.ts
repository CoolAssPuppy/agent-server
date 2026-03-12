import { describe, it, expect } from 'vitest';
import { ConversationStore } from './store.js';

function makeStore(maxConversations = 100): ConversationStore {
  return new ConversationStore(maxConversations);
}

describe('ConversationStore', () => {
  describe('create and find', () => {
    it('should create a conversation and find it by chat + agent', () => {
      const store = makeStore();
      const conv = store.create(123, 'restaurant-checker', 30 * 60 * 1000);

      expect(conv.id).toBeTruthy();
      expect(conv.chatId).toBe(123);
      expect(conv.agentId).toBe('restaurant-checker');
      expect(conv.messages).toEqual([]);
      expect(conv.status).toBe('active');

      const found = store.findActive(123, 'restaurant-checker');
      expect(found).toBeDefined();
      expect(found!.id).toBe(conv.id);
    });

    it('should find active conversation by chat only', () => {
      const store = makeStore();
      const conv = store.create(123, 'restaurant-checker', 30 * 60 * 1000);

      const found = store.findActiveByChat(123);
      expect(found).toBeDefined();
      expect(found!.id).toBe(conv.id);
    });

    it('should not find conversation for different chat', () => {
      const store = makeStore();
      store.create(123, 'restaurant-checker', 30 * 60 * 1000);

      expect(store.findActive(456, 'restaurant-checker')).toBeUndefined();
      expect(store.findActiveByChat(456)).toBeUndefined();
    });

    it('should not find expired conversations', () => {
      const store = makeStore();
      const conv = store.create(123, 'restaurant-checker', -1);

      store.expireStale();

      expect(store.findActive(123, 'restaurant-checker')).toBeUndefined();
      expect(store.findActiveByChat(123)).toBeUndefined();
    });
  });

  describe('addMessage', () => {
    it('should add messages to a conversation', () => {
      const store = makeStore();
      const conv = store.create(123, 'restaurant-checker', 30 * 60 * 1000);

      store.addMessage(conv.id, 'user', 'Find me a restaurant');
      store.addMessage(conv.id, 'assistant', 'I found 3 restaurants.');

      const updated = store.findActive(123, 'restaurant-checker');
      expect(updated!.messages).toHaveLength(2);
      expect(updated!.messages[0].role).toBe('user');
      expect(updated!.messages[0].content).toBe('Find me a restaurant');
      expect(updated!.messages[1].role).toBe('assistant');
    });

    it('should cap messages at 50', () => {
      const store = makeStore();
      const conv = store.create(123, 'agent-a', 30 * 60 * 1000);

      for (let i = 0; i < 55; i++) {
        store.addMessage(conv.id, 'user', `Message ${i}`);
      }

      const updated = store.findActive(123, 'agent-a');
      expect(updated!.messages).toHaveLength(50);
      expect(updated!.messages[0].content).toBe('Message 5');
    });

    it('should truncate messages longer than 4000 chars', () => {
      const store = makeStore();
      const conv = store.create(123, 'agent-a', 30 * 60 * 1000);

      const longMessage = 'x'.repeat(5000);
      store.addMessage(conv.id, 'user', longMessage);

      const updated = store.findActive(123, 'agent-a');
      expect(updated!.messages[0].content.length).toBeLessThanOrEqual(4000);
    });

    it('should not add message to nonexistent conversation', () => {
      const store = makeStore();
      store.addMessage('nonexistent', 'user', 'Hello');
      // No error thrown, just a no-op
    });
  });

  describe('expire', () => {
    it('should manually expire a conversation', () => {
      const store = makeStore();
      const conv = store.create(123, 'agent-a', 30 * 60 * 1000);

      store.expire(conv.id);

      expect(store.findActive(123, 'agent-a')).toBeUndefined();
    });
  });

  describe('expireStale', () => {
    it('should expire conversations past their TTL', () => {
      const store = makeStore();
      store.create(123, 'agent-a', -1);
      store.create(456, 'agent-b', 60 * 60 * 1000);

      const expired = store.expireStale();
      expect(expired).toHaveLength(1);
      expect(store.findActiveByChat(123)).toBeUndefined();
      expect(store.findActiveByChat(456)).toBeDefined();
    });
  });

  describe('eviction', () => {
    it('should evict oldest conversations when exceeding max', () => {
      const store = makeStore(3);

      store.create(1, 'agent-a', 60 * 60 * 1000);
      store.create(2, 'agent-b', 60 * 60 * 1000);
      store.create(3, 'agent-c', 60 * 60 * 1000);
      store.create(4, 'agent-d', 60 * 60 * 1000);

      expect(store.findActiveByChat(1)).toBeUndefined();
      expect(store.findActiveByChat(4)).toBeDefined();
    });
  });

  describe('get', () => {
    it('should return a copy of the conversation', () => {
      const store = makeStore();
      const conv = store.create(123, 'agent-a', 30 * 60 * 1000);
      const retrieved = store.get(conv.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(conv.id);
    });

    it('should return undefined for unknown id', () => {
      const store = makeStore();
      expect(store.get('unknown')).toBeUndefined();
    });
  });
});
