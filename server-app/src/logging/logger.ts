import type { LogDestination, ReadableLogDestination } from './destination.js';
import {
  buildLogRecord,
  LogEntryTooLargeError,
  serializeLogRecord,
  type LogAppendInput,
  type LogRecord,
  type LogRunQuery,
} from './record.js';

const DEFAULT_MAX_BYTES = 1_000_000;

export type AgentLoggerOptions = {
  /**
   * The driver every read comes back from. It receives every write too, so an
   * entry a caller just wrote is an entry it can read back.
   */
  readsFrom: ReadableLogDestination;
  /** Write-only drivers. The Agent Panel and hosted log services go here. */
  destinations?: readonly LogDestination[];
  machineId: string;
  hostname: string;
  /** Ceiling on one serialized entry. Rejected before any driver sees it. */
  maxBytes?: number;
  now?: () => Date;
};

/**
 * Agent logs, fanned out to N drivers.
 *
 * Callers pass a message, never a path or a provider. The server owns where
 * entries go, so an agent needs no file access to leave a record behind, and
 * cannot write anywhere else by asking.
 *
 * Every driver is isolated: one that throws or rejects does not stop the rest.
 * The one exception is the designated readable driver, whose failure is
 * reported to the caller, because a caller that is told the entry was written
 * expects to be able to read it back.
 */
export class AgentLogger {
  private readonly readsFrom: ReadableLogDestination;
  private readonly destinations: readonly LogDestination[];
  private readonly machineId: string;
  private readonly hostname: string;
  private readonly maxBytes: number;
  private readonly now: () => Date;

  constructor(options: AgentLoggerOptions) {
    this.readsFrom = options.readsFrom;
    this.destinations = options.destinations ?? [];
    this.machineId = options.machineId;
    this.hostname = options.hostname;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.now = options.now ?? (() => new Date());
  }

  append(input: LogAppendInput): LogRecord {
    const record = buildLogRecord(input, {
      machineId: this.machineId,
      hostname: this.hostname,
      at: this.now(),
    });
    const bytes = Buffer.byteLength(serializeLogRecord(record), 'utf8');
    if (bytes > this.maxBytes) throw new LogEntryTooLargeError(bytes, this.maxBytes);

    // The readable driver is attempted first so its record lands before a slow
    // driver can delay it, and its failure is held rather than thrown, so one
    // dead driver never costs the others their copy.
    const readableFailure = this.dispatch(this.readsFrom, record);
    for (const destination of this.destinations) {
      const failure = this.dispatch(destination, record);
      if (failure) this.warn(destination, failure);
    }
    if (readableFailure) throw readableFailure;
    return record;
  }

  /**
   * Lets every driver deliver what it is holding. A driver that fails here is
   * reported and the rest still get their turn, because a shutdown that throws
   * would cost the others theirs.
   */
  async shutdown(): Promise<void> {
    for (const destination of [this.readsFrom, ...this.destinations]) {
      try {
        await destination.shutdown?.();
      } catch (error) {
        this.warn(destination, error);
      }
    }
  }

  readRun(query: LogRunQuery): LogRecord[] {
    return this.readsFrom.readRun(query);
  }

  readAgent(agentId: string): LogRecord[] {
    return this.readsFrom.readAgent(agentId);
  }

  /** Returns what the driver threw, and reports a late rejection out of band. */
  private dispatch(destination: LogDestination, record: LogRecord): unknown {
    try {
      const settled = destination.write(record);
      // An entry is written for its own sake, so nothing waits on delivery. A
      // driver that rejects after the call returns is reported, not raised.
      if (settled) void settled.catch((error: unknown) => this.warn(destination, error));
      return undefined;
    } catch (error) {
      return error;
    }
  }

  private warn(destination: LogDestination, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[logging] ${destination.name} did not record an entry: ${message}`);
  }
}
