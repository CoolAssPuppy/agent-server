import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { filterLogInput } from './log-filter.js';

const DEFAULT_MAX_BYTES = 1_000_000;
const DEFAULT_RETENTION_DAYS = 30;
const MAX_SLUG_LENGTH = 80;
const FOLDER_MODE = 0o700;
const FILE_MODE = 0o600;
const LOG_EXTENSION = '.jsonl';

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

export class LogEntryTooLargeError extends Error {
  constructor(bytes: number, maxBytes: number) {
    super(`The log entry is ${bytes} bytes and the limit is ${maxBytes}. Save a shorter version.`);
    this.name = 'LogEntryTooLargeError';
  }
}

/**
 * Agent logs as JSON Lines: one object per line, ISO-8601 `timestamp`, string
 * `level`, string `message`. That is the shape jq, lnav, Vector, and the hosted
 * log tools all read without configuration.
 *
 * Callers pass a message, never a path. The server owns the location, so an
 * agent needs no file access to leave a record behind, and cannot write
 * anywhere else by asking.
 */
export class AgentLogStore {
  private readonly root: string;
  private readonly machineId: string;
  private readonly hostname: string;
  private readonly maxBytes: number;
  private readonly retentionDays: number;
  private readonly now: () => Date;

  constructor(options: {
    root: string;
    machineId: string;
    hostname: string;
    maxBytes?: number;
    retentionDays?: number;
    now?: () => Date;
  }) {
    this.root = resolve(options.root);
    this.machineId = options.machineId;
    this.hostname = options.hostname;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this.now = options.now ?? (() => new Date());
  }

  append(input: LogAppendInput): LogRecord {
    const agentId = slug(input.agentId, 'agent');
    const at = this.now();
    const filtered = filterLogInput({
      message: input.message,
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.data !== undefined ? { data: input.data } : {}),
    });
    const record: LogRecord = {
      ...(filtered.data ?? {}),
      timestamp: at.toISOString(),
      level: input.level ?? 'info',
      message: filtered.message,
      agent_id: agentId,
      run_id: input.runId,
      machine_id: this.machineId,
      hostname: this.hostname,
      source: input.source ?? 'agent',
      ...(filtered.body !== undefined ? { body: filtered.body } : {}),
    };
    const line = `${JSON.stringify(orderStandardFieldsFirst(record))}\n`;
    const bytes = Buffer.byteLength(line, 'utf8');
    if (bytes > this.maxBytes) throw new LogEntryTooLargeError(bytes, this.maxBytes);

    const folder = this.resolveWithin(this.root, agentId);
    mkdirSync(folder, { recursive: true, mode: FOLDER_MODE });
    appendFileSync(this.dayFile(folder, at), line, { mode: FILE_MODE });
    this.prune(folder, at);
    return record;
  }

  readRun(query: { agentId: string; runId: string }): LogRecord[] {
    return this.readAgent(query.agentId).filter((record) => record.run_id === query.runId);
  }

  readAgent(agentId: string): LogRecord[] {
    const folder = this.resolveWithin(this.root, slug(agentId, 'agent'));
    return this.dayFiles(folder)
      .sort((left, right) => left.name.localeCompare(right.name))
      .flatMap((file) => parseLines(file.path));
  }

  private dayFile(folder: string, at: Date): string {
    return join(folder, `${at.toISOString().slice(0, 10)}${LOG_EXTENSION}`);
  }

  private prune(folder: string, at: Date): void {
    const cutoff = at.getTime() - this.retentionDays * 24 * 60 * 60 * 1000;
    for (const file of this.dayFiles(folder)) {
      if (file.modifiedAt.getTime() >= cutoff) continue;
      try {
        unlinkSync(file.path);
      } catch {
        // A log we could not remove is not worth failing the run over.
      }
    }
  }

  private dayFiles(folder: string): Array<{ name: string; path: string; modifiedAt: Date }> {
    let names: string[];
    try {
      names = readdirSync(folder);
    } catch {
      return [];
    }
    return names
      .filter((name) => name.endsWith(LOG_EXTENSION))
      .flatMap((name) => {
        const path = join(folder, name);
        try {
          const stats = statSync(path);
          return stats.isFile() ? [{ name, path, modifiedAt: stats.mtime }] : [];
        } catch {
          return [];
        }
      });
  }

  private resolveWithin(parent: string, child: string): string {
    const path = resolve(parent, child);
    if (path !== parent && !path.startsWith(parent + sep)) {
      throw new Error('Refused a log path outside the log folder.');
    }
    return path;
  }
}

function orderStandardFieldsFirst(record: LogRecord): Record<string, unknown> {
  const { timestamp, level, message, ...rest } = record;
  return { timestamp, level, message, ...rest };
}

function parseLines(path: string): LogRecord[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').flatMap((line) => {
    if (line.trim().length === 0) return [];
    try {
      return [JSON.parse(line) as LogRecord];
    } catch {
      return [];
    }
  });
}

function slug(value: string, fallback: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
  return cleaned.length > 0 ? cleaned : fallback;
}
