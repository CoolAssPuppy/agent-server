import { describe, it, expect } from 'vitest';
import { formatConversationHistory } from './history-formatter.js';
import type { ConversationMessage } from './schema.js';

function makeMessage(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    role: 'user',
    content: 'Hello',
    createdAt: new Date('2026-03-12T10:00:00Z'),
    ...overrides,
  };
}

describe('formatConversationHistory', () => {
  it('should return empty string for no messages', () => {
    expect(formatConversationHistory([])).toBe('');
  });

  it('should format a single user message', () => {
    const messages = [makeMessage({ role: 'user', content: 'Find me a restaurant' })];
    const result = formatConversationHistory(messages);

    expect(result).toContain('<conversation_history>');
    expect(result).toContain('[User]');
    expect(result).toContain('Find me a restaurant');
    expect(result).toContain('</conversation_history>');
  });

  it('should format a multi-turn conversation', () => {
    const messages = [
      makeMessage({ role: 'user', content: 'Find me a restaurant in Soho' }),
      makeMessage({ role: 'assistant', content: 'I found 3 restaurants: 1) Barrafina 2) Bao 3) Kiln' }),
      makeMessage({ role: 'user', content: 'Book the second one for 7pm' }),
    ];
    const result = formatConversationHistory(messages);

    expect(result).toContain('[User]');
    expect(result).toContain('[Assistant]');
    expect(result).toContain('Find me a restaurant in Soho');
    expect(result).toContain('Barrafina');
    expect(result).toContain('Book the second one for 7pm');
  });

  it('should summarize long assistant messages', () => {
    const longContent = 'A'.repeat(3000);
    const messages = [
      makeMessage({ role: 'assistant', content: longContent }),
    ];
    const result = formatConversationHistory(messages);

    expect(result.length).toBeLessThan(longContent.length + 200);
    expect(result).toContain('...');
  });

  it('should not summarize assistant messages under 2000 chars', () => {
    const content = 'A'.repeat(1500);
    const messages = [
      makeMessage({ role: 'assistant', content }),
    ];
    const result = formatConversationHistory(messages);

    expect(result).toContain(content);
    expect(result).not.toContain('...');
  });

  it('should cap total output at 20000 chars by trimming oldest', () => {
    const messages = Array.from({ length: 30 }, (_, i) =>
      makeMessage({ role: 'user', content: 'X'.repeat(1000), createdAt: new Date(Date.now() + i * 1000) }),
    );
    const result = formatConversationHistory(messages);

    expect(result.length).toBeLessThanOrEqual(20_000);
  });

  it('should preserve newest messages when trimming', () => {
    const messages = [
      makeMessage({ role: 'user', content: 'OLD_MESSAGE', createdAt: new Date('2026-03-12T08:00:00Z') }),
      ...Array.from({ length: 25 }, (_, i) =>
        makeMessage({ role: 'user', content: 'X'.repeat(1000), createdAt: new Date(Date.now() + i * 1000) }),
      ),
      makeMessage({ role: 'user', content: 'NEWEST_MESSAGE', createdAt: new Date('2026-03-12T23:00:00Z') }),
    ];
    const result = formatConversationHistory(messages);

    expect(result).toContain('NEWEST_MESSAGE');
  });
});
