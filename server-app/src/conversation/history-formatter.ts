import type { ConversationMessage } from './schema.js';

const MAX_TOTAL_LENGTH = 20_000;
const SUMMARIZE_THRESHOLD = 2_000;
const SUMMARY_HEAD = 1_500;
const SUMMARY_TAIL = 500;

function summarizeIfLong(content: string): string {
  if (content.length <= SUMMARIZE_THRESHOLD) return content;
  return `${content.slice(0, SUMMARY_HEAD)}...${content.slice(-SUMMARY_TAIL)}`;
}

function formatMessage(message: ConversationMessage): string {
  const roleLabel = message.role === 'user' ? '[User]' : '[Assistant]';
  const content = message.role === 'assistant'
    ? summarizeIfLong(message.content)
    : message.content;

  return `${roleLabel}\n${content}`;
}

export function formatConversationHistory(messages: ConversationMessage[]): string {
  if (messages.length === 0) return '';

  const formatted = messages.map(formatMessage);

  let result = formatted.join('\n\n');
  if (result.length > MAX_TOTAL_LENGTH) {
    let trimmedMessages = [...formatted];
    while (trimmedMessages.length > 1 && trimmedMessages.join('\n\n').length > MAX_TOTAL_LENGTH) {
      trimmedMessages = trimmedMessages.slice(1);
    }
    result = trimmedMessages.join('\n\n');
    if (result.length > MAX_TOTAL_LENGTH) {
      result = result.slice(-MAX_TOTAL_LENGTH);
    }
  }

  return `<conversation_history>\n${result}\n</conversation_history>`;
}
