export type StatusState =
  | 'submitted'
  | 'working'
  | 'input_required'
  | 'completed'
  | 'failed'
  | 'canceled';

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
};

const DEFAULT_HEARTBEAT_MS = 30_000;

export class TelemetryReporter {
  private readonly config: Required<Omit<ReporterConfig, 'fetch' | 'heartbeatMs'>> & {
    fetch: typeof globalThis.fetch;
    heartbeatMs: number;
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
  }): Promise<void> {
    this.stop();
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

    await this.send({
      state: 'completed',
      result: {
        summary: executionResult.summary,
        accomplishments,
        usage: executionResult.usage,
        output: {
          turn_count: executionResult.turnCount,
          tools_used: executionResult.toolsUsed,
          files_read: executionResult.filesRead,
          files_written: executionResult.filesWritten,
          commands_run: executionResult.commandsRun,
        },
      },
    });
  }

  async fail(error: Error): Promise<void> {
    this.stop();
    await this.send({
      state: 'failed',
      error: { message: error.message },
    });
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
    const body: StatusEvent = {
      agent: this.config.agentName,
      timestamp: new Date().toISOString(),
      ...event,
    };

    try {
      const response = await this.config.fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        console.error(`[telemetry] POST ${this.config.endpoint} returned ${response.status}: ${response.statusText}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[telemetry] Failed to send ${event.state} event for "${this.config.agentName}": ${message}`);
    }
  }
}
