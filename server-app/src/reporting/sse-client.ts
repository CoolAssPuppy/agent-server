import { EventEmitter } from 'events';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname } from 'path';

export type RunTriggerEvent = {
  id: number;
  type: 'run_trigger';
  trigger_id: string;
  task_slug: string;
  input?: unknown;
};

export type DecisionResolvedEvent = {
  id: number;
  type: 'decision_resolved';
  decision_id: string;
  task_run_id: string;
  resolution: { action_id: string; input?: string };
};

export type AgentFilePokeEvent = {
  id: number;
  type: 'agent_file_poke';
  reason: 'sync_requested';
};

export type AgentServerEvent =
  | RunTriggerEvent
  | DecisionResolvedEvent
  | AgentFilePokeEvent;

const DEFAULT_INITIAL_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 45_000;

export type SseClientOptions = {
  panelUrl: string;
  panelApiKey: string;
  cursorPath: string;
  fetch?: typeof globalThis.fetch;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  idleTimeoutMs?: number;
  initialCursor?: number;
};

export interface SseEvents {
  on(event: 'run_trigger', listener: (e: RunTriggerEvent) => void): this;
  on(event: 'decision_resolved', listener: (e: DecisionResolvedEvent) => void): this;
  on(event: 'agent_file_poke', listener: (e: AgentFilePokeEvent) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
  emit(event: 'run_trigger', e: RunTriggerEvent): boolean;
  emit(event: 'decision_resolved', e: DecisionResolvedEvent): boolean;
  emit(event: 'agent_file_poke', e: AgentFilePokeEvent): boolean;
  emit(event: string, ...args: unknown[]): boolean;
}

function isAgentServerEvent(value: unknown): value is AgentServerEvent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'number') return false;
  if (v.type !== 'run_trigger' && v.type !== 'decision_resolved' && v.type !== 'agent_file_poke') return false;
  return true;
}

export class SseClient {
  readonly events: EventEmitter & SseEvents;
  private readonly options: SseClientOptions;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly idleTimeoutMs: number;
  private readonly fetchFn: typeof globalThis.fetch;
  private cursor: number;
  private stopped = false;
  private currentAbort: AbortController | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private backoffMs: number;
  private running = false;
  private currentReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  private idleTimedOut = false;

  constructor(options: SseClientOptions) {
    this.options = options;
    this.initialBackoffMs = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.backoffMs = this.initialBackoffMs;
    this.events = new EventEmitter() as EventEmitter & SseEvents;
    this.cursor = options.initialCursor ?? this.loadCursor();
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    void this.connectLoop();
  }

  stop(): void {
    this.stopped = true;
    this.running = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.clearIdleTimer();
    if (this.currentAbort) {
      this.currentAbort.abort();
      this.currentAbort = undefined;
    }
  }

  getCursor(): number {
    return this.cursor;
  }

  private loadCursor(): number {
    try {
      if (!existsSync(this.options.cursorPath)) return 0;
      const raw = readFileSync(this.options.cursorPath, 'utf-8').trim();
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    } catch {
      return 0;
    }
  }

  private persistCursor(): void {
    try {
      mkdirSync(dirname(this.options.cursorPath), { recursive: true });
      writeFileSync(this.options.cursorPath, String(this.cursor), 'utf-8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[sse-client] Failed to persist cursor: ${message}`);
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimedOut = true;
      if (this.currentReader) {
        void this.currentReader.cancel().catch(() => undefined);
      }
      if (this.currentAbort) {
        this.currentAbort.abort();
      }
    }, this.idleTimeoutMs);
  }

  private async connectLoop(): Promise<void> {
    while (!this.stopped) {
      const connected = await this.connectOnce();
      if (this.stopped) break;

      if (connected) {
        this.backoffMs = this.initialBackoffMs;
      } else {
        this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
      }

      const delay = connected ? this.initialBackoffMs : this.backoffMs;
      await this.delay(delay);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined;
        resolve();
      }, ms);
    });
  }

  private async connectOnce(): Promise<boolean> {
    this.idleTimedOut = false;
    const abort = new AbortController();
    this.currentAbort = abort;

    const url = `${this.options.panelUrl}/api/agent-server/events?since=${this.cursor}`;

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.options.panelApiKey}`,
          'Accept': 'text/event-stream',
        },
        signal: abort.signal,
      });
    } catch (err) {
      if (!this.stopped) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[sse-client] Connect failed: ${message}`);
      }
      return false;
    }

    if (!response.ok || !response.body) {
      console.error(`[sse-client] Panel responded ${response.status}`);
      return false;
    }

    this.resetIdleTimer();

    try {
      await this.consumeStream(response.body);
      return true;
    } catch (err) {
      if (!this.stopped) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[sse-client] Stream error: ${message}`);
      }
      return false;
    } finally {
      this.clearIdleTimer();
      this.currentAbort = undefined;
    }
  }

  private async consumeStream(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    this.currentReader = reader;
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (!this.stopped) {
        let chunk: { done: boolean; value?: Uint8Array };
        try {
          chunk = await reader.read();
        } catch (err) {
          if (this.idleTimedOut || this.stopped) return;
          throw err;
        }
        if (chunk.done) return;
        if (!chunk.value) continue;

        this.resetIdleTimer();
        buffer += decoder.decode(chunk.value, { stream: true });

        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIdx).replace(/\r$/, '');
          buffer = buffer.slice(newlineIdx + 1);
          this.handleLine(line);
        }
      }
    } finally {
      this.currentReader = undefined;
      try {
        await reader.cancel();
      } catch {
        // swallow cancel errors
      }
    }
  }

  private handleLine(line: string): void {
    if (line.length === 0) return;
    if (line.startsWith(':')) return;
    if (!line.startsWith('data:')) return;

    const payload = line.slice(5).trim();
    if (payload.length === 0) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[sse-client] Invalid JSON event: ${message}`);
      return;
    }

    if (!isAgentServerEvent(parsed)) {
      console.error('[sse-client] Dropping event with unknown shape');
      return;
    }

    this.cursor = parsed.id;
    this.persistCursor();
    this.events.emit(parsed.type, parsed);
  }
}
