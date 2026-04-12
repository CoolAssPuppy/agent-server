import { z } from 'zod';
export declare function loadEnvFile(dir: string, existing?: Record<string, string | undefined>): Record<string, string | undefined>;
export declare const ServerConfigSchema: z.ZodObject<{
    agentsDir: z.ZodDefault<z.ZodString>;
    lockDir: z.ZodDefault<z.ZodString>;
    logsDir: z.ZodDefault<z.ZodString>;
    panelUrl: z.ZodOptional<z.ZodString>;
    panelApiKey: z.ZodOptional<z.ZodString>;
    checkIntervalMs: z.ZodDefault<z.ZodNumber>;
    heartbeatMs: z.ZodDefault<z.ZodNumber>;
    port: z.ZodDefault<z.ZodNumber>;
    host: z.ZodDefault<z.ZodString>;
    telegramBotToken: z.ZodOptional<z.ZodString>;
    apiKey: z.ZodOptional<z.ZodString>;
    catchUp: z.ZodDefault<z.ZodBoolean>;
    maxConcurrentRuns: z.ZodDefault<z.ZodNumber>;
    maxWebSocketClients: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export declare function loadConfig(env?: Record<string, string | undefined>): ServerConfig;
//# sourceMappingURL=config.d.ts.map