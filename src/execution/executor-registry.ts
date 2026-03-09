import type { AgentConfig } from '../agents/config.js';
import type { Reporter } from './runner.js';
import type { ExecutionResult } from './executor.js';

export type ExecutorFn = (agent: AgentConfig, reporter: Reporter) => Promise<ExecutionResult>;

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
