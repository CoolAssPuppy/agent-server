import type { LogRecord, LogRunQuery } from './record.js';

/**
 * Abstract contract for one log driver.
 *
 * To add a driver — the Agent Panel, a hosted log service, anything — implement
 * this interface and append it to the array `AgentLogger` receives. That is the
 * only edit. No call site changes, because no call site knows a driver exists.
 *
 * `write` may throw or reject. The logger isolates every driver, so one that is
 * down or misconfigured never stops the rest.
 */
export interface LogDestination {
  /** Stable slug used in warnings. Never written into a record. */
  readonly name: string;
  write(record: LogRecord): void | Promise<void>;
}

/**
 * The driver a read comes back from.
 *
 * Writes fan out to every driver, but a read has to have one authority. Merging
 * N drivers would return entries that differ by delivery lag and duplicate each
 * other, and an agent reading its own last state needs one answer. So exactly
 * one driver is designated readable, and `read_log` never asks any other.
 */
export interface ReadableLogDestination extends LogDestination {
  readRun(query: LogRunQuery): LogRecord[];
  readAgent(agentId: string): LogRecord[];
}
