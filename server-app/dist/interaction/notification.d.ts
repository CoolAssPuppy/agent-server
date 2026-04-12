import type { AgentConfig } from '../agents/config.js';
export type NotificationData = {
    agentName: string;
    status: 'completed' | 'failed';
    summary?: string;
    error?: string;
    turnCount?: number;
    toolsUsed?: string[];
    filesWritten?: string[];
    durationMs?: number;
};
export declare function formatAgentListMessage(agents: AgentConfig[]): string;
export declare function formatCompletionNotification(agentName: string, summary?: string): string;
export declare function formatFailureNotification(agentName: string, error?: string): string;
export declare function formatPlainNotification(data: NotificationData): string;
//# sourceMappingURL=notification.d.ts.map