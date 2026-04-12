import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { AgentConfig } from '../agents/config.js';
import type { Reporter } from '../execution/runner.js';
import { type ExecutionResult } from '../execution/executor.js';
type ExecuteAgentExtra = {
    abortController?: AbortController;
};
export declare function executeAgent(agent: AgentConfig, reporter: Reporter, extra?: ExecuteAgentExtra): Promise<ExecutionResult>;
export declare const RECONNECT_DELAY_MS = 3000;
export declare const MAX_RECONNECT_ATTEMPTS = 2;
export declare function buildMcpServers(agent: AgentConfig): Options['mcpServers'];
export {};
//# sourceMappingURL=claude-code.d.ts.map