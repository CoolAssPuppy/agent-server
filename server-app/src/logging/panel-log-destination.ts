import { toErrorMessage } from '../util/errors.js';
import { withTimeout } from '../util/with-timeout.js';
import type { LogDestination } from './destination.js';
import { LOG_LEVELS, type LogRecord, type LogSource } from './record.js';

/** The log protocol Panel speaks. Same version the status route sends. */
const PROTOCOL_VERSION = 2;
/** Panel's own limits. Exceeding any of them is a rejected request, not a retry. */
const MAX_ENTRIES_PER_REQUEST = 200;
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_MESSAGE_CHARS = 10_000;
const MAX_METADATA_BYTES = 8 * 1024;
/** Room for the envelope around the entries: protocol version, machine id, braces. */
const REQUEST_ENVELOPE_BYTES = 1024;
const MAX_ENTRIES_BYTES = MAX_REQUEST_BYTES - REQUEST_ENVELOPE_BYTES;

const DEFAULT_FLUSH_INTERVAL_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
/**
 * Ceiling on entries held for delivery. A daemon that runs for weeks behind a
 * broken network must not grow a queue until it is killed.
 */
const DEFAULT_MAX_QUEUED_ENTRIES = 2_000;
const RETRY_BASE_MS = 5_000;
const RETRY_CEILING_MS = 5 * 60_000;
const MAX_RETRY_ATTEMPTS = 6;
/** A body shorter than this is not worth the metadata budget it would cost. */
const MIN_BODY_BYTES = 64;

/** Levels Panel accepts. The local store emits four of them. */
const PANEL_LEVELS: ReadonlySet<string> = new Set([...LOG_LEVELS, 'reasoning', 'fatal']);
/** Fields that are either a column already or identity Panel takes from elsewhere. */
const NOT_METADATA: ReadonlySet<string> = new Set([
  'timestamp',
  'level',
  'message',
  'agent_id',
  'run_id',
  'machine_id',
  'hostname',
  'source',
  'body',
]);

export type PanelLogDestinationOptions = {
  panelUrl: string;
  /** Machine credential. Sent as a bearer token and held nowhere else. */
  panelApiKey: string;
  /** The paired machine UUID, the same identity the status route claims. */
  machineId: string;
  fetchImpl?: typeof globalThis.fetch;
  flushIntervalMs?: number;
  requestTimeoutMs?: number;
  maxQueuedEntries?: number;
  now?: () => number;
  onWarn?: (message: string) => void;
};

type PanelLogEntry = {
  timestamp: string;
  level: string;
  message: string;
  source: LogSource;
  metadata: Record<string, unknown>;
};

/** One entry waiting for delivery, measured once so batching stays cheap. */
type QueuedEntry = { runId: string; entry: PanelLogEntry; bytes: number };

type DeliveryOutcome =
  | { kind: 'delivered' }
  | { kind: 'discarded' }
  | { kind: 'retry'; reason: string; delayMs?: number };

/**
 * The Agent Panel log driver.
 *
 * `write` only appends to a bounded queue, so a panel that is down or slow can
 * never delay or fail a run. Delivery happens on a timer, grouped by run
 * because one request carries one run's entries.
 *
 * Panel has no idempotency key, so a retried batch inserts duplicates. Only the
 * failures that say nothing was written are retried: rate limits, server
 * errors, network errors, and the 404 that means the run's status event has not
 * landed yet. A batch is removed from the queue only once Panel has accepted it
 * or refused it in a way that resending cannot fix.
 */
export class PanelLogDestination implements LogDestination {
  readonly name = 'agent_panel';

  private readonly panelUrl: string;
  private readonly panelApiKey: string;
  private readonly machineId: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly flushIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly maxQueuedEntries: number;
  private readonly now: () => number;
  private readonly warn: (message: string) => void;

  private queue: QueuedEntry[] = [];
  private readonly retries = new Map<string, { notBefore: number; attempts: number }>();
  private inFlight: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | undefined;
  private droppedForCapacity = 0;
  private isRefused = false;
  private isStopped = false;

  constructor(options: PanelLogDestinationOptions) {
    this.panelUrl = options.panelUrl.replace(/\/+$/, '');
    this.panelApiKey = options.panelApiKey;
    this.machineId = options.machineId;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxQueuedEntries = options.maxQueuedEntries ?? DEFAULT_MAX_QUEUED_ENTRIES;
    this.now = options.now ?? (() => Date.now());
    this.warn = options.onWarn ?? ((message) => console.warn(message));
  }

  write(record: LogRecord): void {
    if (this.isRefused || this.isStopped) return;
    const runId = typeof record.run_id === 'string' ? record.run_id.trim() : '';
    // Panel addresses logs by run. An entry with no run has nowhere to go, and
    // the local driver still holds it.
    if (runId.length === 0) return;

    const entry = toPanelEntry(record);
    this.queue.push({ runId, entry, bytes: byteLength(JSON.stringify(entry)) + 1 });
    this.trimQueue();
    this.startTimer();
  }

  /** Delivers everything currently deliverable. Never rejects. */
  flush(): Promise<void> {
    // Serialized so two flushes cannot send the same batch twice.
    this.inFlight = this.inFlight.then(() => this.deliverReadyRuns());
    return this.inFlight;
  }

  async shutdown(): Promise<void> {
    this.stopTimer();
    await this.flush();
    this.isStopped = true;
  }

  private startTimer(): void {
    if (this.timer || this.isStopped) return;
    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
    // Logs must never be the reason a one-shot command stays alive.
    this.timer.unref?.();
  }

  private stopTimer(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private trimQueue(): void {
    if (this.queue.length <= this.maxQueuedEntries) return;
    // The oldest entries go first. Panel is a live view of a run, so the newest
    // lines are the ones somebody is waiting on, and every dropped line is
    // still on disk in the local driver, which is where reads come from.
    this.droppedForCapacity += this.queue.length - this.maxQueuedEntries;
    this.queue = this.queue.slice(this.queue.length - this.maxQueuedEntries);
  }

  private async deliverReadyRuns(): Promise<void> {
    if (this.isRefused) return;
    this.reportCapacityDrops();

    const now = this.now();
    const ready = new Set<string>();
    for (const item of this.queue) {
      const retry = this.retries.get(item.runId);
      if (!retry || retry.notBefore <= now) ready.add(item.runId);
    }

    for (const runId of ready) {
      if (this.isRefused) return;
      await this.deliverRun(runId);
    }
  }

  private reportCapacityDrops(): void {
    if (this.droppedForCapacity === 0) return;
    this.warn(
      `[logging] ${this.name} dropped ${this.droppedForCapacity} queued entr`
      + `${this.droppedForCapacity === 1 ? 'y' : 'ies'} it could not deliver in time.`,
    );
    this.droppedForCapacity = 0;
  }

  private async deliverRun(runId: string): Promise<void> {
    const batch = this.takeBatch(runId);
    if (batch.length === 0) return;

    const outcome = await this.post(runId, batch);
    if (outcome.kind === 'retry') {
      this.scheduleRetry(runId, batch, outcome);
      return;
    }
    this.retries.delete(runId);
  }

  /** Takes one run's entries, in order, up to Panel's entry and byte limits. */
  private takeBatch(runId: string): QueuedEntry[] {
    const batch: QueuedEntry[] = [];
    const remaining: QueuedEntry[] = [];
    let bytes = 0;

    for (const item of this.queue) {
      const fits = batch.length < MAX_ENTRIES_PER_REQUEST && bytes + item.bytes <= MAX_ENTRIES_BYTES;
      if (item.runId !== runId || !fits) {
        remaining.push(item);
        continue;
      }
      batch.push(item);
      bytes += item.bytes;
    }

    this.queue = remaining;
    return batch;
  }

  private async post(runId: string, batch: readonly QueuedEntry[]): Promise<DeliveryOutcome> {
    const url = `${this.panelUrl}/api/runs/${encodeURIComponent(runId)}/logs`;
    const body = JSON.stringify({
      protocol_version: PROTOCOL_VERSION,
      machine_id: this.machineId,
      entries: batch.map((item) => item.entry),
    });

    let response: Response;
    try {
      response = await withTimeout(
        this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.panelApiKey}`,
          },
          body,
        }),
        {
          timeoutMs: this.requestTimeoutMs,
          createError: () => new Error('Agent Panel did not answer in time.'),
        },
      );
    } catch (error) {
      // The request may or may not have landed. Panel has no idempotency key,
      // so this retry can duplicate; losing the entry is the worse outcome.
      return { kind: 'retry', reason: toErrorMessage(error) };
    }

    if (response.ok) return { kind: 'delivered' };
    return this.classify(response);
  }

  private classify(response: Response): DeliveryOutcome {
    const status = response.status;

    if (status === 401) {
      // The credential cannot change without a restart, so every later request
      // would be refused the same way.
      this.isRefused = true;
      this.queue = [];
      this.warn(`[logging] ${this.name} stopped: Agent Panel rejected the machine credential.`);
      return { kind: 'discarded' };
    }

    // A 404 is the ordinary race with the run's status event, so it is quiet.
    if (status === 404) return { kind: 'retry', reason: 'Agent Panel does not know this run yet' };
    if (status === 429) {
      return { kind: 'retry', reason: 'Agent Panel is rate limiting', delayMs: retryAfterMs(response) };
    }
    if (status >= 500) return { kind: 'retry', reason: `Agent Panel answered ${status}` };

    this.warn(`[logging] ${this.name} discarded a batch Agent Panel answered ${status}.`);
    return { kind: 'discarded' };
  }

  private scheduleRetry(
    runId: string,
    batch: QueuedEntry[],
    outcome: { reason: string; delayMs?: number },
  ): void {
    const attempts = (this.retries.get(runId)?.attempts ?? 0) + 1;
    if (attempts > MAX_RETRY_ATTEMPTS) {
      this.retries.delete(runId);
      this.warn(
        `[logging] ${this.name} gave up on ${batch.length} entries for one run after `
        + `${MAX_RETRY_ATTEMPTS} attempts: ${outcome.reason}. They are still in the local log.`,
      );
      return;
    }

    this.retries.set(runId, {
      attempts,
      notBefore: this.now() + (outcome.delayMs ?? backoffMs(attempts)),
    });
    // Back at the head, so the run's entries keep the order they were written in.
    this.queue = [...batch, ...this.queue];
    this.trimQueue();
  }
}

function backoffMs(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_CEILING_MS);
}

function retryAfterMs(response: Response): number | undefined {
  const header = Number(response.headers.get('retry-after'));
  if (!Number.isFinite(header) || header <= 0) return undefined;
  return Math.min(header * 1000, RETRY_CEILING_MS);
}

function toPanelEntry(record: LogRecord): PanelLogEntry {
  return {
    timestamp: record.timestamp,
    level: PANEL_LEVELS.has(record.level) ? record.level : 'info',
    message: record.message.slice(0, MAX_MESSAGE_CHARS),
    source: record.source === 'server' ? 'server' : 'agent',
    metadata: buildMetadata(record),
  };
}

/**
 * Everything worth keeping that Panel has no column for. The row's machine and
 * run come from the credential and the URL, so repeating them here would only
 * spend the metadata budget.
 */
function buildMetadata(record: LogRecord): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    agent_id: record.agent_id,
    hostname: record.hostname,
  };
  let bytes = byteLength(JSON.stringify(metadata));

  for (const [key, value] of Object.entries(record)) {
    if (NOT_METADATA.has(key) || value === undefined) continue;
    const cost = byteLength(JSON.stringify({ [key]: value }));
    if (bytes + cost > MAX_METADATA_BYTES) continue;
    metadata[key] = value;
    bytes += cost;
  }

  const body = typeof record.body === 'string' ? record.body : undefined;
  if (body) appendBody(metadata, body, MAX_METADATA_BYTES - bytes);
  return metadata;
}

function appendBody(
  metadata: Record<string, unknown>,
  body: string,
  budgetBytes: number,
): void {
  // What `,"body":` costs on top of the value itself.
  const budget = budgetBytes - 8;
  if (budget < MIN_BODY_BYTES) return;

  let candidate = truncateToBytes(body, budget);
  // Escaping costs more than the raw bytes, so give back exactly the overflow
  // rather than halving: a body that is mostly plain text keeps nearly all of
  // itself.
  for (let overflow = byteLength(JSON.stringify(candidate)) - budget; overflow > 0;) {
    candidate = candidate.slice(0, Math.max(0, candidate.length - overflow));
    if (candidate.length === 0) return;
    overflow = byteLength(JSON.stringify(candidate)) - budget;
  }
  metadata.body = candidate;
}

function truncateToBytes(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.length <= maxBytes) return value;
  // A cut can land mid-character, and the replacement it decodes to is noise.
  return buffer.subarray(0, maxBytes).toString('utf8').replace(/�+$/, '');
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}
