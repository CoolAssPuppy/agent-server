import { z } from 'zod';

const InteractionOptionSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  description: z.string().optional(),
});

export const InteractionRequestSchema = z.object({
  message: z.string().min(1),
  options: z.array(InteractionOptionSchema).optional(),
  freeText: z.boolean().default(false),
});

export type InteractionRequest = z.infer<typeof InteractionRequestSchema>;
export type InteractionOption = z.infer<typeof InteractionOptionSchema>;

export const InteractionConfigSchema = z.object({
  channel: z.string().min(1),
  on_reply: z.string().min(1),
  timeout: z.string().default('30m'),
});

export type InteractionConfig = z.infer<typeof InteractionConfigSchema>;

export const NotificationConfigSchema = z.object({
  channel: z.string().min(1),
  on_complete: z.boolean().default(true),
  on_failure: z.boolean().default(true),
});

export type NotificationConfig = z.infer<typeof NotificationConfigSchema>;
