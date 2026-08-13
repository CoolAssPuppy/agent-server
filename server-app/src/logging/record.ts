import { filterLogInput } from './log-filter.js';

const MAX_SLUG_LENGTH = 80;

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = typeof LOG_LEVELS[number];

/** An agent can say anything in a message, but it cannot claim to be the server. */
export type LogSource = 'agent' | 'server';

export type LogAppendInput = {
  agentId: string;
  runId: string;
  message: string;
  level?: LogLevel;
  /** Long text, such as a document that could not be delivered. */
  body?: string;
  /** Extra fields. Standard fields win, so a caller cannot rewrite its own identity. */
  data?: Record<string, unknown>;
  /** Who wrote the entry. Defaults to the agent; the runner marks its own. */
  source?: LogSource;
};

export type LogRecord = {
  timestamp: string;
  level: LogLevel;
  message: string;
  agent_id: string;
  run_id: string;
  machine_id: string;
  hostname: string;
  source: LogSource;
  body?: string;
  [field: string]: unknown;
};

export type LogRunQuery = { agentId: string; runId: string };

/** Where the entry was written from. Stamped once so every driver agrees. */
export type LogIdentity = {
  machineId: string;
  hostname: string;
  at: Date;
};

export class LogEntryTooLargeError extends Error {
  constructor(bytes: number, maxBytes: number) {
    super(`The log entry is ${bytes} bytes and the limit is ${maxBytes}. Save a shorter version.`);
    this.name = 'LogEntryTooLargeError';
  }
}

/**
 * Cleans and stamps one entry. Every driver receives the result of this, so a
 * record kept locally and a record sent onward are the same record: same
 * timestamp, same identity, same filtering.
 */
export function buildLogRecord(input: LogAppendInput, identity: LogIdentity): LogRecord {
  const filtered = filterLogInput({
    message: input.message,
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.data !== undefined ? { data: input.data } : {}),
  });
  return {
    ...(filtered.data ?? {}),
    timestamp: identity.at.toISOString(),
    level: input.level ?? 'info',
    message: filtered.message,
    agent_id: slugAgentId(input.agentId),
    run_id: input.runId,
    machine_id: identity.machineId,
    hostname: identity.hostname,
    source: input.source ?? 'agent',
    ...(filtered.body !== undefined ? { body: filtered.body } : {}),
  };
}

/**
 * One JSON Lines record: a single object, ISO-8601 `timestamp`, string `level`,
 * string `message`, newline terminated. That is the shape jq, lnav, Vector, and
 * the hosted log tools all read without configuration, so it is also the shape
 * an entry is measured in before it is accepted.
 */
export function serializeLogRecord(record: LogRecord): string {
  const { timestamp, level, message, ...rest } = record;
  return `${JSON.stringify({ timestamp, level, message, ...rest })}\n`;
}

/** Folder-safe agent id. Also what the record reports, so the two never differ. */
export function slugAgentId(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'agent';
}
