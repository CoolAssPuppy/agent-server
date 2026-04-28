import { mkdir, writeFile, readdir, readFile, unlink } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { sanitizeText } from '../server/security-utils.js';

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
  progressMode?: 'live' | 'batched';
  progressSampleMs?: number;
  maxProgressEntries?: number;
  includeProgressMetadata?: boolean;
  serverId?: string;
  conversationId?: string;
  /** Override the pending-terminals directory (tests only). */
  pendingTerminalsDir?: string;
};

const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_PROGRESS_SAMPLE_MS = 5_000;
const DEFAULT_MAX_PROGRESS_ENTRIES = 50;
const TERMINAL_STATES: ReadonlySet<string> = new Set(['completed', 'failed', 'canceled', 'rejected']);
const TERMINAL_RETRY_COUNT = 3;
const TERMINAL_RETRY_BASE_MS = 500;
const DEFERRED_RETRY_COUNT = 5;
const DEFERRED_RETRY_BASE_MS = 5_000;

/**
 * HTTP status 409 from the panel means "run is already in a terminal state".
 * The panel has the information; retrying accomplishes nothing. Treat as success
 * everywhere (main send loop, deferred retries, replay).
 */
function isTerminalAcceptedStatus(response: { ok: boolean; status: number }): boolean {
  return response.ok || response.status === 409;
}

export class TelemetryReporter {
  private readonly config: Required<Omit<ReporterConfig, 'fetch' | 'heartbeatMs' | 'serverId' | 'conversationId' | 'pendingTerminalsDir'>> & {
    fetch: typeof globalThis.fetch;
    heartbeatMs: number;
    progressMode: 'live' | 'batched';
    progressSampleMs: number;
    maxProgressEntries: number;
    includeProgressMetadata: boolean;
    serverId?: string;
    conversationId?: string;
    pendingTerminalsDir?: string;
  };
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private deferredRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private terminalSent = false;
  private stopped = false;
  private readonly progressEntries: Array<Record<string, unknown>> = [];
  private progressEntriesDropped = 0;
  private lastProgressSentAt = 0;
  private throttledProgressCount = 0;

  constructor(config: ReporterConfig) {
    this.config = {
      ...config,
      fetch: config.fetch ?? globalThis.fetch,
      heartbeatMs: config.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
      progressMode: config.progressMode ?? 'live',
      progressSampleMs: config.progressSampleMs ?? DEFAULT_PROGRESS_SAMPLE_MS,
      maxProgressEntries: config.maxProgressEntries ?? DEFAULT_MAX_PROGRESS_ENTRIES,
      includeProgressMetadata: config.includeProgressMetadata ?? false,
    };
  }

  async start(): Promise<void> {
    await this.send({ state: 'working' });
    this.startHeartbeat();
  }

  async progress(message: string, metadata?: Record<string, unknown>): Promise<void> {
    this.recordProgress(message, metadata);
    if (this.config.progressMode === 'batched') return;

    const now = Date.now();
    if (this.lastProgressSentAt > 0 && (now - this.lastProgressSentAt) < this.config.progressSampleMs) {
      this.throttledProgressCount += 1;
      return;
    }
    const throttled = this.throttledProgressCount;
    this.throttledProgressCount = 0;
    this.lastProgressSentAt = now;
    const safeMessage = sanitizeText(message, 1_000);
    await this.send({
      state: 'working',
      message: throttled > 0
        ? `[batched ${throttled + 1} updates] ${safeMessage}`
        : safeMessage,
      metadata: {
        ...(metadata ?? {}),
        ...(throttled > 0 ? { batched_progress_updates: throttled } : {}),
      },
    });
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
    if (this.terminalSent) {
      console.warn(`[telemetry] complete() called after terminal already sent for run=${this.config.runId}; ignoring`);
      return;
    }
    this.terminalSent = true;
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
            ...(this.progressEntries.length > 0
              ? { progress_updates: this.progressEntries, progress_updates_dropped: this.progressEntriesDropped }
              : {}),
          },
        },
      });
    } finally {
      // Stop the heartbeat only. Deferred retries (if any were scheduled)
      // continue in the background with .unref()'d timers so that a late
      // panel recovery still gets the terminal event. Full teardown happens
      // in the explicit .stop() call from the runner.
      this.stopHeartbeat();
    }
  }

  async fail(error: Error): Promise<void> {
    if (this.terminalSent) {
      console.warn(`[telemetry] fail() called after terminal already sent for run=${this.config.runId}; ignoring (error=${error.message})`);
      return;
    }
    this.terminalSent = true;
    try {
      await this.send({
        state: 'failed',
        error: { message: sanitizeText(error.message, 1_000) },
      });
    } finally {
      this.stopHeartbeat();
    }
  }

  async cancel(reason?: string, code?: string): Promise<void> {
    if (this.terminalSent) {
      console.warn(`[telemetry] cancel() called after terminal already sent for run=${this.config.runId}; ignoring (reason=${reason ?? 'Canceled'})`);
      return;
    }
    this.terminalSent = true;
    try {
      await this.send({
        state: 'canceled',
        error: {
          message: sanitizeText(reason ?? 'Canceled', 1_000),
          ...(code ? { code } : {}),
        },
      });
    } finally {
      this.stopHeartbeat();
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
    this.stopped = true;
    this.stopHeartbeat();
    if (this.deferredRetryTimer) {
      clearTimeout(this.deferredRetryTimer);
      this.deferredRetryTimer = null;
    }
  }

  private stopHeartbeat(): void {
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
        if (isTerminalAcceptedStatus(response)) {
          console.log(`[telemetry] Successfully sent ${event.state} event for "${this.config.agentName}" (${response.status})`);
          return;
        }

        console.error(
          `[telemetry] POST ${this.config.endpoint} returned ${response.status} ${response.statusText} ` +
          `for ${event.state} event of "${this.config.agentName}" (attempt ${attempt}/${maxAttempts})`
        );
      } catch (err) {
        const message = sanitizeText(err instanceof Error ? err.message : String(err), 300);
        console.error(
          `[telemetry] Failed to send ${event.state} event for "${this.config.agentName}" ` +
          `(attempt ${attempt}/${maxAttempts}): ${message}`
        );
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
    if (this.stopped) return;
    if (attempt > DEFERRED_RETRY_COUNT) {
      console.error(`[telemetry] Abandoned ${body.state} event for "${this.config.agentName}" after all retries; persisting for replay`);
      void persistPendingTerminal({
        runId: this.config.runId,
        endpoint: this.config.endpoint,
        body,
      }, this.config.pendingTerminalsDir);
      return;
    }

    const delayMs = DEFERRED_RETRY_BASE_MS * 2 ** (attempt - 1);

    const timer = setTimeout(async () => {
      this.deferredRetryTimer = null;
      if (this.stopped) return;
      try {
        const response = await this.config.fetch(this.config.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
        });
        if (isTerminalAcceptedStatus(response)) return;
        console.error(
          `[telemetry] Deferred retry ${attempt}/${DEFERRED_RETRY_COUNT} for ` +
          `${body.state} "${this.config.agentName}": HTTP ${response.status}`
        );
      } catch (err) {
        const message = sanitizeText(err instanceof Error ? err.message : String(err), 300);
        console.error(
          `[telemetry] Deferred retry ${attempt}/${DEFERRED_RETRY_COUNT} for ` +
          `${body.state} "${this.config.agentName}": ${message}`
        );
      }
      this.scheduleDeferredRetry(body, attempt + 1);
    }, delayMs);

    // Don't block process exit on deferred retries. The pending-terminal file
    // (written when all retries exhaust) is the durable fallback.
    if (typeof timer.unref === 'function') timer.unref();
    this.deferredRetryTimer = timer;
  }

  private recordProgress(message: string, metadata?: Record<string, unknown>): void {
    if (this.progressEntries.length >= this.config.maxProgressEntries) {
      this.progressEntriesDropped += 1;
      return;
    }
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      message: sanitizeText(message, 280),
    };
    if (this.config.includeProgressMetadata && metadata) {
      entry.metadata = metadata;
    } else if (metadata) {
      const compact: Record<string, unknown> = {};
      if (typeof metadata.turns_completed === 'number') compact.turns_completed = metadata.turns_completed;
      if (Array.isArray(metadata.tools_used)) compact.tools_used = metadata.tools_used;
      if (Object.keys(compact).length > 0) entry.metadata = compact;
    }
    this.progressEntries.push(entry);
  }
}

/**
 * Persisted pending-terminal shape. The API key is intentionally NOT stored
 * here — pending-terminal files live in `~/.agent-server/pending-terminals/`
 * which any process running as the user can read. The key is re-read from
 * config at replay time.
 */
type PendingTerminal = {
  runId: string;
  endpoint: string;
  body: StatusEvent;
};

/**
 * Legacy shape (pre-2026-04) that included the API key. Replay accepts this
 * shape for backwards compatibility but strips the field from new writes.
 */
type LegacyPendingTerminal = PendingTerminal & { apiKey?: string };

export const PENDING_TERMINALS_DIR = join(homedir(), '.agent-server', 'pending-terminals');

async function persistPendingTerminal(entry: PendingTerminal, dir?: string): Promise<void> {
  const targetDir = dir ?? PENDING_TERMINALS_DIR;
  try {
    await mkdir(targetDir, { recursive: true });
    const file = join(targetDir, `${entry.runId}.json`);
    // 0600 — only the current user can read. These files contain the panel
    // endpoint and the full terminal payload including run output.
    await writeFile(file, JSON.stringify(entry), { encoding: 'utf8', mode: 0o600 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[telemetry] Failed to persist pending terminal for ${entry.runId}: ${message}`);
  }
}

export type ReplayOptions = {
  fetchImpl?: typeof globalThis.fetch;
  /** Resolve the current panel API key. Required; replay is a no-op if it returns undefined. */
  getApiKey?: () => string | undefined;
  /**
   * Optional panel base URL. When provided, replay only posts to endpoints
   * that share the same origin and match the expected run-status route.
   */
  panelUrl?: string;
};

function isValidReplayEndpoint(endpoint: string, panelUrl?: string): boolean {
  if (!panelUrl) return true;
  try {
    const target = new URL(endpoint);
    const panel = new URL(panelUrl);
    if (target.origin !== panel.origin) return false;
    return /^\/api\/runs\/[^/]+\/status$/.test(target.pathname);
  } catch {
    return false;
  }
}

export async function replayPendingTerminals(
  options: ReplayOptions = {},
  dir: string = PENDING_TERMINALS_DIR,
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const getApiKey = options.getApiKey;

  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[telemetry] Failed to read pending terminals dir: ${message}`);
    return;
  }

  for (const name of files) {
    if (!name.endsWith('.json')) continue;
    const path = join(dir, name);
    try {
      const raw = await readFile(path, 'utf8');
      const entry = JSON.parse(raw) as LegacyPendingTerminal;
      if (!isValidReplayEndpoint(entry.endpoint, options.panelUrl)) {
        console.error(
          `[telemetry] Refusing to replay ${entry.runId}: endpoint does not match configured panel origin/route`,
        );
        continue;
      }
      // Prefer current config API key; fall back to legacy embedded key for
      // forward-migration of old files written before the security fix.
      const apiKey = getApiKey?.() ?? entry.apiKey;
      if (!apiKey) {
        console.error(`[telemetry] Cannot replay ${entry.runId}: no API key available (set AGENT_SERVER_PANEL_API_KEY)`);
        continue;
      }
      const response = await fetchImpl(entry.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(entry.body),
      });
      if (isTerminalAcceptedStatus(response)) {
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
