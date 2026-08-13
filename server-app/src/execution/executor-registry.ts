import type { AgentConfig } from '../agents/config.js';
import type { Reporter } from './runner.js';
import type { ExecutionResult } from './executor.js';
import type { DecisionContext } from './decision-handler.js';
import type { AgentLogStore } from '../logging/index.js';

export type ExecutorFnOptions = {
  abortController?: AbortController;
  runId?: string;
  decisionContext?: DecisionContext;
  /**
   * Path to the user's installed Claude executable (from runtime discovery).
   */
  claudeExecutablePath?: string;
  /** Path to the user's installed Codex executable, or undefined when unavailable. */
  codexExecutablePath?: string;
  /** Path to the user's installed Kimi Code executable. */
  kimiExecutablePath?: string;
  /** Disable user-level MCP configuration for a restricted safe test. */
  disableMcpServers?: boolean;
  /** Server-owned log destination, exposed to the agent as a tool. */
  logStore?: AgentLogStore;
};

export type ExecutorFn = (agent: AgentConfig, reporter: Reporter, options?: ExecutorFnOptions) => Promise<ExecutionResult>;

export class ExecutorRegistry {
  private readonly executors = new Map<string, ExecutorFn>();
  private defaultName: string | null = null;

  register(name: string, executor: ExecutorFn): void {
    this.executors.set(name, executor);
  }

  setDefault(name: string): void {
    this.defaultName = name;
  }

  get(name?: string): ExecutorFn {
    const resolvedName = name ?? this.defaultName;
    if (!resolvedName) throw new Error('No default executor configured');

    const executor = this.executors.get(resolvedName);
    if (!executor) throw new Error(`Unknown executor: ${resolvedName}`);
    return executor;
  }

  resolve(agent: AgentConfig): ExecutorFn {
    return this.get(agent.executor);
  }

  list(): string[] {
    return [...this.executors.keys()];
  }
}
