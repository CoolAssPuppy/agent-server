import { mkdir, writeFile, readdir, readFile, unlink } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { sanitizeText } from '../server/security-utils.js';
import { toErrorMessage } from '../util/errors.js';
import { withTimeout } from '../util/with-timeout.js';

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
  /** Maximum duration for one panel HTTP request. */
  requestTimeoutMs?: number;
  serverId?: string;
  conversationId?: string;
  /** Override the pending-terminals directory (tests only). */
  pendingTerminalsDir?: string;
};

const DEFAULT_HEARTBEAT_MS = 60_000;
const DEFAULT_PROGRESS_SAMPLE_MS = 5_000;
const DEFAULT_MAX_PROGRESS_ENTRIES = 50;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const TERMINAL_STATES: ReadonlySet<string> = new Set(['completed', 'failed', 'canceled', 'rejected']);
const TERMINAL_RETRY_COUNT = 3;
const TERMINAL_RETRY_BASE_MS = 500;
const DEFERRED_RETRY_COUNT = 5;
const DEFERRED_RETRY_BASE_MS = 5_000;
const STABLE_REASON_CODE = /^[a-z][a-z0-9_]{0,119}$/;
const ZERO_USAGE = Object.freeze({
  input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
  estimated_cost_usd: 0,
});

/**
 * Reduce legacy status payloads to the operational fields approved for
 * default Panel delivery. This also protects replay of older rich outbox
 * files that may contain local paths, commands, result text, or tool names.
 */
export function toOperationalStatusEvent(event: StatusEvent): StatusEvent {
  const metadata: Record<string, unknown> = {};
  if (typeof event.metadata?.worker_id === 'string') {
    metadata.worker_id = event.metadata.worker_id;
  }
  if (typeof event.metadata?.conversation_id === 'string') {
    metadata.conversation_id = event.metadata.conversation_id;
  }

  const projected: StatusEvent = {
    agent: event.agent,
    state: event.state,
    ...(event.timestamp ? { timestamp: event.timestamp } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };

  if (event.state === 'completed') {
    projected.result = {
      summary: 'Run completed.',
      accomplishments: ['Run completed.'],
      usage: { ...ZERO_USAGE },
      model: 'not_shared',
    };
  } else if (event.state === 'failed' || event.state === 'rejected' || event.state === 'canceled') {
    const code = event.error?.code;
    projected.error = {
      message: event.state === 'canceled' ? 'Run canceled.' : 'Run failed.',
      ...(typeof code === 'string' && STABLE_REASON_CODE.test(code) ? { code } : {}),
    };
  } else if (event.state === 'input_required') {
    projected.message = 'Input required.';
  }

  return projected;
}

/**
 * HTTP status 409 from the panel means "run is already in a terminal state".
 * The panel has the information; retrying accomplishes nothing. Treat as success
 * everywhere (main send loop, deferred retries, replay).
 */
function isTerminalAcceptedStatus(response: { ok: boolean; status: number }): boolean {
  return response.ok || response.status === 409;
}

async function fetchWithTimeout(
  fetchImpl: typeof globalThis.fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  if (timeoutMs <= 0) return fetchImpl(input, init);

  const controller = new AbortController();
  return withTimeout(fetchImpl(input, { ...init, signal: controller.signal }), {
    timeoutMs,
    createError: () => new Error(`Panel request exceeded timeout of ${timeoutMs}ms`),
    onTimeout: () => controller.abort(),
  });
}

export class TelemetryReporter {
  private readonly config: Required<Omit<ReporterConfig, 'fetch' | 'heartbeatMs' | 'serverId' | 'conversationId' | 'pendingTerminalsDir'>> & {
    fetch: typeof globalThis.fetch;
    heartbeatMs: number;
    progressMode: 'live' | 'batched';
    progressSampleMs: number;
    maxProgressEntries: number;
    includeProgressMetadata: boolean;
    requestTimeoutMs: number;
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
      requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
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
    this.throttledProgressCount = 0;
    this.lastProgressSentAt = now;
    await this.send({ state: 'working' });
  }

  async complete(_executionResult: {
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
    try {
      await this.send({
        state: 'completed',
        result: {
          summary: 'Run completed.',
          accomplishments: ['Run completed.'],
          usage: { ...ZERO_USAGE },
          model: 'not_shared',
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
    const errorCode = 'code' in error && typeof error.code === 'string'
      ? sanitizeText(error.code, 120)
      : undefined;
    try {
      await this.send({
        state: 'failed',
        error: {
          message: 'Run failed.',
          ...(errorCode ? { code: errorCode } : {}),
        },
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
          message: 'Run canceled.',
          ...(code ? { code } : {}),
        },
      });
    } finally {
      this.stopHeartbeat();
    }
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
      void this.send({ state: 'working' });
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

    const body = toOperationalStatusEvent({
      agent: this.config.agentName,
      timestamp: new Date().toISOString(),
      ...event,
      metadata: { ...workerMetadata, ...event.metadata },
    });

    const maxAttempts = TERMINAL_STATES.has(event.state) ? TERMINAL_RETRY_COUNT : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetchWithTimeout(this.config.fetch, this.config.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
        }, this.config.requestTimeoutMs);
        if (isTerminalAcceptedStatus(response)) {
          if (TERMINAL_STATES.has(event.state)) {
            await removePendingTerminal(this.config.runId, this.config.pendingTerminalsDir);
          }
          console.log(`[telemetry] Successfully sent ${event.state} event for "${this.config.agentName}" (${response.status})`);
          return;
        }

        console.error(
          `[telemetry] POST ${this.config.endpoint} returned ${response.status} ${response.statusText} ` +
          `for ${event.state} event of "${this.config.agentName}" (attempt ${attempt}/${maxAttempts})`
        );
      } catch (err) {
        const message = sanitizeText(toErrorMessage(err), 300);
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
      await persistPendingTerminal({
        runId: this.config.runId,
        endpoint: this.config.endpoint,
        body,
      }, this.config.pendingTerminalsDir);
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
        const response = await fetchWithTimeout(this.config.fetch, this.config.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
        }, this.config.requestTimeoutMs);
        if (isTerminalAcceptedStatus(response)) {
          await removePendingTerminal(this.config.runId, this.config.pendingTerminalsDir);
          return;
        }
        console.error(
          `[telemetry] Deferred retry ${attempt}/${DEFERRED_RETRY_COUNT} for ` +
          `${body.state} "${this.config.agentName}": HTTP ${response.status}`
        );
      } catch (err) {
        const message = sanitizeText(toErrorMessage(err), 300);
        console.error(
          `[telemetry] Deferred retry ${attempt}/${DEFERRED_RETRY_COUNT} for ` +
          `${body.state} "${this.config.agentName}": ${message}`
        );
      }
      this.scheduleDeferredRetry(body, attempt + 1);
    }, delayMs);

    // Don't block process exit on deferred retries. The pending-terminal file
    // was written before this timer was scheduled and is the durable fallback.
    if (typeof timer.unref === 'function') timer.unref();
    this.deferredRetryTimer = timer;
  }

  private recordProgress(_message: string, _metadata?: Record<string, unknown>): void {
    if (this.progressEntries.length >= this.config.maxProgressEntries) {
      this.progressEntriesDropped += 1;
      return;
    }
    this.progressEntries.push({ timestamp: new Date().toISOString() });
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
    const message = toErrorMessage(err);
    console.error(`[telemetry] Failed to persist pending terminal for ${entry.runId}: ${message}`);
  }
}

async function removePendingTerminal(runId: string, dir?: string): Promise<void> {
  try {
    await unlink(join(dir ?? PENDING_TERMINALS_DIR, `${runId}.json`));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`[telemetry] Failed to remove pending terminal for ${runId}: ${toErrorMessage(err)}`);
    }
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
  /** Maximum duration for one replay HTTP request. */
  requestTimeoutMs?: number;
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
    const message = toErrorMessage(err);
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
      const response = await fetchWithTimeout(fetchImpl, entry.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(toOperationalStatusEvent(entry.body)),
      }, options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
      if (isTerminalAcceptedStatus(response)) {
        await unlink(path);
        console.log(`[telemetry] Replayed pending terminal ${entry.runId} (${response.status})`);
      } else {
        console.error(`[telemetry] Replay failed for ${entry.runId}: ${response.status}`);
      }
    } catch (err) {
      const message = toErrorMessage(err);
      console.error(`[telemetry] Replay error for ${name}: ${message}`);
    }
  }
}
