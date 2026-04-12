import { z } from 'zod';
const InteractionOptionSchema = z.object({
    label: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(500),
    description: z.string().max(300).optional(),
});
export const InteractionRequestSchema = z.object({
    message: z.string().trim().min(1).max(2_000),
    options: z.array(InteractionOptionSchema).max(20).optional(),
    freeText: z.boolean().default(false),
});
export const InteractionConfigSchema = z.object({
    channel: z.string().trim().min(1).max(64),
    on_reply: z.string().trim().min(1).max(64),
    timeout: z.string().trim().max(16).default('30m'),
});
export const NotificationConfigSchema = z.object({
    channel: z.string().trim().min(1).max(64),
    on_complete: z.boolean().default(true),
    on_failure: z.boolean().default(true),
});
//# sourceMappingURL=schema.js.map