/**
 * One run as the server holds it, in memory or in SQLite.
 *
 * It lives apart from the stores because normalization has to name the shape
 * it normalizes, and both stores normalize through it. Holding the type here
 * keeps that from being a cycle.
 */
export type StoredRun = {
  runId: string;
  agentId: string;
  agentName: string;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  startedAt: Date;
  completedAt?: Date;
  summary?: string;
  error?: string;
  code?: string;
  turnCount: number;
  toolsUsed: string[];
  filesRead: string[];
  filesWritten: string[];
  commandsRun: string[];
  progressMessages: string[];
  conversationId?: string;
  conversationChannel?: 'slack' | 'telegram';
  // Populated from the executor's ExecutionResult.usage so clients
  // (the macOS app, the panel) can render per-run duration and cost
  // without waiting for panel-side hydration.
  durationMs?: number;
  estimatedCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
  mode?: 'normal' | 'safe_test';
  retryOfRunId?: string;
  repairId?: string;
};
