import type { AgentConfig } from '../agents/config.js';
import type { Reporter } from './runner.js';
import type { ExecutionResult } from './executor.js';
export type ExecutorFnOptions = {
    abortController?: AbortController;
};
export type ExecutorFn = (agent: AgentConfig, reporter: Reporter, options?: ExecutorFnOptions) => Promise<ExecutionResult>;
export declare class ExecutorRegistry {
    private readonly executors;
    private defaultName;
    register(name: string, executor: ExecutorFn): void;
    setDefault(name: string): void;
    get(name?: string): ExecutorFn;
    resolve(agent: AgentConfig): ExecutorFn;
    list(): string[];
}
//# sourceMappingURL=executor-registry.d.ts.map