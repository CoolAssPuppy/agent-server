export type StatusState = 'submitted' | 'working' | 'input_required' | 'completed' | 'failed' | 'canceled';
export type StatusEvent = {
    agent: string;
    state: StatusState;
    message?: string;
    timestamp?: string;
    metadata?: Record<string, unknown>;
    result?: {
        summary?: string;
        accomplishments?: string[];
        observations?: string[];
        output?: Record<string, unknown>;
        usage?: Record<string, unknown>;
        model?: string;
    };
    error?: {
        message: string;
        code?: string;
        details?: Record<string, unknown>;
    };
};
type ReporterConfig = {
    runId: string;
    agentName: string;
    endpoint: string;
    apiKey: string;
    fetch?: typeof globalThis.fetch;
    heartbeatMs?: number;
    serverId?: string;
    conversationId?: string;
};
export declare class TelemetryReporter {
    private readonly config;
    private heartbeatTimer;
    constructor(config: ReporterConfig);
    start(): Promise<void>;
    progress(message: string, metadata?: Record<string, unknown>): Promise<void>;
    complete(executionResult: {
        summary: string;
        output: Record<string, unknown>;
        usage: Record<string, unknown>;
        turnCount: number;
        toolsUsed: string[];
        filesRead: string[];
        filesWritten: string[];
        commandsRun: string[];
    }): Promise<void>;
    fail(error: Error): Promise<void>;
    stop(): void;
    private startHeartbeat;
    private send;
    private scheduleDeferredRetry;
}
export {};
//# sourceMappingURL=reporter.d.ts.map