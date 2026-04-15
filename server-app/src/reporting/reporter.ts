import { mkdir, writeFile, readdir, readFile, unlink } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

export type StatusState =
  | 'submitted'
  | 'working'
  | 'input_required'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'rejected';

export type StatusEvent = {
  agent: string;
  state: StatusState;
  message?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
  result?: {
    summary: string;
    accomplishments: string[];
    observations?: string[];
    output?: Record<string, unknown>;
    usage: Record<string, unknown>;
    model: string;
    schema_valid?: boolean;
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

const DEFAULT_HEARTBEAT_MS = 30_000;
const TERMINAL_STATES: ReadonlySet<string> = new Set(['completed', 'failed', 'canceled', 'rejected']);
const TERMINAL_RETRY_COUNT = 3;
const TERMINAL_RETRY_BASE_MS = 500;
const DEFERRED_RETRY_COUNT = 5;
const DEFERRED_RETRY_BASE_MS = 5_000;

export class TelemetryReporter {
  private readonly config: Required<Omit<ReporterConfig, 'fetch' | 'heartbeatMs' | 'serverId' | 'conversationId'>> & {
    fetch: typeof globalThis.fetch;
    heartbeatMs: number;
    serverId?: string;
    conversationId?: string;
  };
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: ReporterConfig) {
    this.config = {
      ...config,
      fetch: config.fetch ?? globalThis.fetch,
      heartbeatMs: config.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
    };
  }

  async start(): Promise<void> {
    await this.send({ state: 'working' });
    this.startHeartbeat();
  }

  async progress(message: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.send({ state: 'working', message, metadata });
  }

  async complete(executionResult: {
    summary: string;
    output: Record<string, unknown>;
    usage: Record<string, unknown>;
    turnCount: number;
    toolsUsed: string[];
    filesRead: string[];
    filesWritten: string[];
    commandsRun: string[];
    model?: string;
  }): Promise<void> {
    console.log(`[telemetry] Sending completion for "${this.config.agentName}" to ${this.config.endpoint}`);
    const accomplishments: string[] = [];
    if (executionResult.filesWritten.length > 0) {
      accomplishments.push(`Wrote ${executionResult.filesWritten.length} file(s): ${executionResult.filesWritten.join(', ')}`);
    }
    if (executionResult.commandsRun.length > 0) {
      accomplishments.push(`Ran ${executionResult.commandsRun.length} command(s)`);
    }
    if (executionResult.filesRead.length > 0) {
      accomplishments.push(`Read ${executionResult.filesRead.length} file(s)`);
    }
    // AgentResultSchema requires accomplishments.min(1). When a run produced
    // no observable side-effects we still need one non-empty entry. (Fix 1)
    if (accomplishments.length === 0) {
      accomplishments.push(`Completed in ${executionResult.turnCount} turn(s)`);
    }

    const usage = this.normalizeUsage(executionResult.usage);
    const model = executionResult.model
      ?? (typeof executionResult.usage.model === 'string' ? executionResult.usage.model : undefined)
      ?? 'unknown';

    try {
      await this.send({
        state: 'completed',
        result: {
          summary: executionResult.summary,
          accomplishments,
          usage,
          model,
          output: {
            turn_count: executionResult.turnCount,
            tools_used: executionResult.toolsUsed,
            files_read: executionResult.filesRead,
            files_written: executionResult.filesWritten,
            commands_run: executionResult.commandsRun,
          },
        },
      });
    } finally {
      this.stop();
    }
  }

  async fail(error: Error): Promise<void> {
    try {
      await this.send({
        state: 'failed',
        error: { message: error.message },
      });
    } finally {
      this.stop();
    }
  }

  async cancel(reason?: string, code?: string): Promise<void> {
    try {
      await this.send({
        state: 'canceled',
        error: { message: reason ?? 'Canceled', ...(code ? { code } : {}) },
      });
    } finally {
      this.stop();
    }
  }

  /**
   * AgentResultSchema requires numeric input_tokens, output_tokens,
   * total_tokens, and estimated_cost_usd. Older callers send only legacy
   * counters. Coalesce to the required shape while keeping extra fields.
   */
  private normalizeUsage(raw: Record<string, unknown>): Record<string, unknown> {
    const coerceNonNeg = (value: unknown): number => {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
      return 0;
    };
    const input = coerceNonNeg(raw.input_tokens);
    const output = coerceNonNeg(raw.output_tokens);
    const totalCandidate = raw.total_tokens;
    const total = typeof totalCandidate === 'number' && Number.isFinite(totalCandidate)
      ? totalCandidate
      : input + output;
    const cost = coerceNonNeg(raw.estimated_cost_usd);
    return {
      ...raw,
      input_tokens: Math.trunc(input),
      output_tokens: Math.trunc(output),
      total_tokens: Math.trunc(total),
      estimated_cost_usd: cost,
    };
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private startHeartbeat(): void {
    if (this.config.heartbeatMs <= 0) return;

    this.heartbeatTimer = setInterval(() => {
      void this.send({ state: 'working', message: 'heartbeat' });
    }, this.config.heartbeatMs);
  }

  private async send(event: Omit<StatusEvent, 'agent' | 'timestamp'>): Promise<void> {
    const workerMetadata: Record<string, unknown> = {};
    if (this.config.serverId) {
      workerMetadata.worker_id = this.config.serverId;
    }
    if (this.config.conversationId) {
      workerMetadata.conversation_id = this.config.conversationId;
    }

    const body: StatusEvent = {
      agent: this.config.agentName,
      timestamp: new Date().toISOString(),
      ...event,
      metadata: { ...workerMetadata, ...event.metadata },
    };

    const maxAttempts = TERMINAL_STATES.has(event.state) ? TERMINAL_RETRY_COUNT : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.config.fetch(this.config.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
        });
        if (response.ok) {
          console.log(`[telemetry] Successfully sent ${event.state} event for "${this.config.agentName}"`);
          return;
        }

        console.error(`[telemetry] POST ${this.config.endpoint} returned ${response.status}: ${response.statusText}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[telemetry] Failed to send ${event.state} event for "${this.config.agentName}": ${message}`);
      }

      if (attempt < maxAttempts) {
        const delayMs = TERMINAL_RETRY_BASE_MS * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    if (TERMINAL_STATES.has(event.state)) {
      this.scheduleDeferredRetry(body);
    }
  }

  private scheduleDeferredRetry(body: StatusEvent, attempt = 1): void {
    if (attempt > DEFERRED_RETRY_COUNT) {
      console.error(`[telemetry] Abandoned ${body.state} event for "${this.config.agentName}" after all retries; persisting for replay`);
      void persistPendingTerminal({
        runId: this.config.runId,
        endpoint: this.config.endpoint,
        apiKey: this.config.apiKey,
        body,
      });
      return;
    }

    const delayMs = DEFERRED_RETRY_BASE_MS * 2 ** (attempt - 1);

    setTimeout(async () => {
      try {
        const response = await this.config.fetch(this.config.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
        });
        if (response.ok) return;
        console.error(`[telemetry] Deferred retry ${attempt} for ${body.state}: ${response.status}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[telemetry] Deferred retry ${attempt} for ${body.state}: ${message}`);
      }
      this.scheduleDeferredRetry(body, attempt + 1);
    }, delayMs);
  }
}

type PendingTerminal = {
  runId: string;
  endpoint: string;
  apiKey: string;
  body: StatusEvent;
};

export const PENDING_TERMINALS_DIR = join(homedir(), '.agent-server', 'pending-terminals');

async function persistPendingTerminal(entry: PendingTerminal): Promise<void> {
  try {
    await mkdir(PENDING_TERMINALS_DIR, { recursive: true });
    const file = join(PENDING_TERMINALS_DIR, `${entry.runId}.json`);
    await writeFile(file, JSON.stringify(entry), 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[telemetry] Failed to persist pending terminal for ${entry.runId}: ${message}`);
  }
}

export async function replayPendingTerminals(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<void> {
  let files: string[];
  try {
    files = await readdir(PENDING_TERMINALS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[telemetry] Failed to read pending terminals dir: ${message}`);
    return;
  }

  for (const name of files) {
    if (!name.endsWith('.json')) continue;
    const path = join(PENDING_TERMINALS_DIR, name);
    try {
      const raw = await readFile(path, 'utf8');
      const entry = JSON.parse(raw) as PendingTerminal;
      const response = await fetchImpl(entry.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${entry.apiKey}`,
        },
        body: JSON.stringify(entry.body),
      });
      // Treat 2xx and 409 (already terminal) as success — the panel has the state.
      if (response.ok || response.status === 409) {
        await unlink(path);
        console.log(`[telemetry] Replayed pending terminal ${entry.runId} (${response.status})`);
      } else {
        console.error(`[telemetry] Replay failed for ${entry.runId}: ${response.status}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[telemetry] Replay error for ${name}: ${message}`);
    }
  }
}
