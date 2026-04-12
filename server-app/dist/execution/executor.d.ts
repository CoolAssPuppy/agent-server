import type { InteractionRequest } from '../interaction/schema.js';
export declare const MAX_SUMMARY_LENGTH = 200;
export type ClaudeStreamEvent = {
    type: string;
    message?: {
        content?: Array<{
            type: string;
            text?: string;
            name?: string;
            input?: Record<string, unknown>;
        }>;
    };
    result?: string;
    [key: string]: unknown;
};
export type McpServerInfo = {
    name: string;
    status: string;
    error?: string;
};
export type ExecutionResult = {
    summary: string;
    output: Record<string, unknown>;
    usage: Record<string, unknown>;
    turnCount: number;
    toolsUsed: string[];
    filesRead: string[];
    filesWritten: string[];
    commandsRun: string[];
    interaction?: InteractionRequest;
    mcpServers?: McpServerInfo[];
};
export declare function parseStreamEvent(line: string): ClaudeStreamEvent | null;
export declare function truncate(text: string): string;
export declare function extractTextParts(event: ClaudeStreamEvent): string[];
export declare function summarizeTurn(event: ClaudeStreamEvent): string | null;
type ToolMetadata = {
    toolNames: string[];
    filesRead: string[];
    filesWritten: string[];
    commandsRun: string[];
};
export declare const WRITE_TOOLS: Set<string>;
export declare function extractToolMetadata(event: ClaudeStreamEvent): ToolMetadata;
export {};
//# sourceMappingURL=executor.d.ts.map