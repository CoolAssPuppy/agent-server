import { z } from 'zod';
export const ConversationMessageSchema = z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(4_000),
    createdAt: z.coerce.date(),
});
export const ConversationConfigSchema = z.object({
    enabled: z.boolean().default(false),
    ttl: z.string().trim().max(16).default('30m'),
});
//# sourceMappingURL=schema.js.map