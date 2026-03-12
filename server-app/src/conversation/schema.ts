import { z } from 'zod';

export const ConversationMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(4_000),
  createdAt: z.coerce.date(),
});

export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

export const ConversationConfigSchema = z.object({
  enabled: z.boolean().default(false),
  ttl: z.string().trim().max(16).default('30m'),
});

export type ConversationConfig = z.infer<typeof ConversationConfigSchema>;

export type Conversation = {
  id: string;
  chatId: number;
  agentId: string;
  messages: ConversationMessage[];
  createdAt: Date;
  expiresAt: Date;
  status: 'active' | 'expired';
};
