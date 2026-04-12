import type { AgentConfig } from '../agents/config.js';
import type { ExecutionResult } from './executor.js';
export type RunResult = {
    runId?: string;
    status: 'completed' | 'failed' | 'skipped';
    error?: string;
    result?: ExecutionResult;
};
export type Reporter = {
    start: () => Promise<void> | void;
    progress: (message: string, metadata?: Record<string, unknown>) => Promise<void> | void;
    complete: (result: ExecutionResult) => Promise<void> | void;
    fail: (error: Error) => Promise<void> | void;
    stop: () => void;
};
type RunAgentOptions = {
    agent: AgentConfig;
    lockDir: string;
    execute: (agent: AgentConfig, reporter: Reporter) => Promise<ExecutionResult>;
    createReporter: (runId: string, agentName: string, conversationId?: string) => Reporter;
    promptSuffix?: string;
    conversationId?: string;
};
export declare function runAgent(options: RunAgentOptions): Promise<RunResult>;
export {};
//# sourceMappingURL=runner.d.ts.map