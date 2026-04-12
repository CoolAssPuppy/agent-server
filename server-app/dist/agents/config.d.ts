import { z } from 'zod';
declare const TriggerRefSchema: z.ZodObject<{
    agent: z.ZodString;
}, z.core.$strip>;
export type TriggerRef = z.infer<typeof TriggerRefSchema>;
declare const FileWatchSchema: z.ZodObject<{
    path: z.ZodString;
    glob: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type FileWatch = z.infer<typeof FileWatchSchema>;
export declare const PermissionsSchema: z.ZodObject<{
    allow: z.ZodDefault<z.ZodArray<z.ZodString>>;
    deny: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type Permissions = z.infer<typeof PermissionsSchema>;
declare const McpServerConfigSchema: z.ZodUnion<readonly [z.ZodObject<{
    type: z.ZodLiteral<"sse">;
    url: z.ZodString;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"http">;
    url: z.ZodString;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodOptional<z.ZodLiteral<"stdio">>;
    command: z.ZodString;
    args: z.ZodOptional<z.ZodArray<z.ZodString>>;
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strip>]>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export declare function resolveEnvVars(env: Record<string, string>, source?: Record<string, string | undefined>): Record<string, string>;
export declare const AgentConfigSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    schedule: z.ZodOptional<z.ZodString>;
    timezone: z.ZodOptional<z.ZodString>;
    prompt: z.ZodString;
    tools: z.ZodDefault<z.ZodArray<z.ZodString>>;
    disallowed_tools: z.ZodDefault<z.ZodArray<z.ZodString>>;
    max_turns: z.ZodDefault<z.ZodNumber>;
    working_directory: z.ZodOptional<z.ZodString>;
    permission_mode: z.ZodOptional<z.ZodEnum<{
        default: "default";
        acceptEdits: "acceptEdits";
        bypassPermissions: "bypassPermissions";
        plan: "plan";
        dontAsk: "dontAsk";
    }>>;
    enabled: z.ZodDefault<z.ZodBoolean>;
    on_complete: z.ZodOptional<z.ZodArray<z.ZodObject<{
        agent: z.ZodString;
    }, z.core.$strip>>>;
    on_failure: z.ZodOptional<z.ZodArray<z.ZodObject<{
        agent: z.ZodString;
    }, z.core.$strip>>>;
    watch: z.ZodOptional<z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        glob: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    executor: z.ZodOptional<z.ZodString>;
    permissions: z.ZodOptional<z.ZodObject<{
        allow: z.ZodDefault<z.ZodArray<z.ZodString>>;
        deny: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    mcp_servers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodObject<{
        type: z.ZodLiteral<"sse">;
        url: z.ZodString;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"http">;
        url: z.ZodString;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodOptional<z.ZodLiteral<"stdio">>;
        command: z.ZodString;
        args: z.ZodOptional<z.ZodArray<z.ZodString>>;
        env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>]>>>;
    interaction: z.ZodOptional<z.ZodObject<{
        channel: z.ZodString;
        on_reply: z.ZodString;
        timeout: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>>;
    notification: z.ZodOptional<z.ZodObject<{
        channel: z.ZodString;
        on_complete: z.ZodDefault<z.ZodBoolean>;
        on_failure: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    conversation: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        ttl: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$loose>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export declare function parseAgentYaml(yaml: string): AgentConfig;
export declare function parseAgentFile(content: string): AgentConfig;
export {};
//# sourceMappingURL=config.d.ts.map