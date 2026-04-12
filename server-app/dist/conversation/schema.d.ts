import { z } from 'zod';
export declare const ConversationMessageSchema: z.ZodObject<{
    role: z.ZodEnum<{
        user: "user";
        assistant: "assistant";
    }>;
    content: z.ZodString;
    createdAt: z.ZodCoercedDate<unknown>;
}, z.core.$strip>;
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
export declare const ConversationConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    ttl: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
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
//# sourceMappingURL=schema.d.ts.map