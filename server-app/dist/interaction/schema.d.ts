import { z } from 'zod';
declare const InteractionOptionSchema: z.ZodObject<{
    label: z.ZodString;
    value: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const InteractionRequestSchema: z.ZodObject<{
    message: z.ZodString;
    options: z.ZodOptional<z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        value: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    freeText: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type InteractionRequest = z.infer<typeof InteractionRequestSchema>;
export type InteractionOption = z.infer<typeof InteractionOptionSchema>;
export declare const InteractionConfigSchema: z.ZodObject<{
    channel: z.ZodString;
    on_reply: z.ZodString;
    timeout: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type InteractionConfig = z.infer<typeof InteractionConfigSchema>;
export declare const NotificationConfigSchema: z.ZodObject<{
    channel: z.ZodString;
    on_complete: z.ZodDefault<z.ZodBoolean>;
    on_failure: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type NotificationConfig = z.infer<typeof NotificationConfigSchema>;
export {};
//# sourceMappingURL=schema.d.ts.map