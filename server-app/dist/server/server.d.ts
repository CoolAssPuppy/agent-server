import type { ServerConfig } from '../platform/config.js';
import type { AgentConfig } from '../agents/config.js';
import { type NotificationData } from '../interaction/notification.js';
export type ServerInstance = {
    stop: () => void;
};
export declare function isLoopbackHost(host: string): boolean;
export declare function isAllowedOrigin(originHeader: string | undefined, host: string): boolean;
export declare function validateNetworkExposure(host: string, apiKey?: string): void;
export declare function shouldSendTelegramRunNotification(agent: AgentConfig, status: 'completed' | 'failed'): boolean;
/**
 * Sentinel summary produced by plugins/claude-code.ts when the agent's final
 * message is empty. Treating this as "silent mode" lets agents opt out of a
 * completion notification by returning an empty final message. See the guard
 * in {@link shouldDispatchNotification}.
 */
export declare const SILENT_COMPLETION_SUMMARY = "Agent completed";
/**
 * Decides whether a run-completion or run-failure notification should be
 * dispatched to the agent's configured channel.
 *
 * Silent-mode behavior: when an agent returns an empty final message, the
 * claude-code plugin fills in the fallback string `"Agent completed"`. That
 * fallback is not a meaningful summary — it means the agent had nothing to
 * report — so completion notifications with that exact summary are suppressed.
 * Failure notifications are never silenced by this rule.
 */
export declare function shouldDispatchNotification(agent: AgentConfig, data: Pick<NotificationData, 'status' | 'summary'>): boolean;
type StartServerOptions = {
    anthropicApiKey?: string;
};
export declare function startServer(config: ServerConfig, options?: StartServerOptions): ServerInstance;
export {};
//# sourceMappingURL=server.d.ts.map