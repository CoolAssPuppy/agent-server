/** Executor identifiers accepted in agent definitions and reviewed patches. */
export const EXECUTOR_NAMES = ['claude-code', 'codex', 'kimi-code'] as const;

export type AgentExecutor = typeof EXECUTOR_NAMES[number];
