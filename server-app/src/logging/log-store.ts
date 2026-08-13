import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { ReadableLogDestination } from './destination.js';
import { serializeLogRecord, slugAgentId, type LogRecord, type LogRunQuery } from './record.js';

const DEFAULT_RETENTION_DAYS = 30;
const FOLDER_MODE = 0o700;
const FILE_MODE = 0o600;
const LOG_EXTENSION = '.jsonl';

/**
 * The local JSON Lines driver: one file per agent per day under the log root,
 * one object per line.
 *
 * It is the driver reads come back from. The file is on the same machine as the
 * run, needs no network, and holds the entry the moment `write` returns, which
 * is what an agent asking for its own last state needs.
 */
export class AgentLogStore implements ReadableLogDestination {
  readonly name = 'local_jsonl';
  private readonly root: string;
  private readonly retentionDays: number;

  constructor(options: { root: string; retentionDays?: number }) {
    this.root = resolve(options.root);
    this.retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  }

  write(record: LogRecord): void {
    const at = parseTimestamp(record.timestamp);
    const folder = this.resolveWithin(this.root, slugAgentId(record.agent_id));
    mkdirSync(folder, { recursive: true, mode: FOLDER_MODE });
    appendFileSync(this.dayFile(folder, at), serializeLogRecord(record), { mode: FILE_MODE });
    this.prune(folder, at);
  }

  readRun(query: LogRunQuery): LogRecord[] {
    return this.readAgent(query.agentId).filter((record) => record.run_id === query.runId);
  }

  readAgent(agentId: string): LogRecord[] {
    const folder = this.resolveWithin(this.root, slugAgentId(agentId));
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

function parseTimestamp(value: string): Date {
  const at = new Date(value);
  // A record with an unreadable timestamp still belongs on disk somewhere, and
  // today's file is the only place a reader would think to look for it.
  return Number.isNaN(at.getTime()) ? new Date() : at;
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
