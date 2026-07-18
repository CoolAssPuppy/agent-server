import { mkdirSync, openSync, writeSync, closeSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { inspect } from 'util';
import { sanitizeText } from '../server/security-utils.js';

/**
 * Mirrors console.{log,warn,error} into a daily-rotated file sink. Does not
 * replace the original methods — output still reaches stdout/stderr for any
 * parent process (launchd redirects, macOS app debug console, etc).
 *
 * Files: `{logsDir}/agent-server-YYYYMMDD.log`. Retention: last 7 days.
 * Format: `[ISO timestamp] [level] message`.
 */

export const DEFAULT_LOGS_DIR = join(homedir(), '.agent-server', 'logs');
const DEFAULT_RETENTION_DAYS = 7;

export type FileLoggerOptions = {
  logsDir?: string;
  retentionDays?: number;
  now?: () => Date;
};

export type FileLoggerHandle = {
  stop: () => void;
  /** Current log file path (updates on day change). Exposed for tests. */
  currentPath: () => string;
};

type ConsoleLevel = 'log' | 'warn' | 'error';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function dayStamp(date: Date): string {
  // Local-time day. Using the user's local timezone matches expectations for
  // "yesterday's log file" when reading logs on the same machine.
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

export function logFilePath(logsDir: string, date: Date): string {
  return join(logsDir, `agent-server-${dayStamp(date)}.log`);
}

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack ?? arg.message;
  return inspect(arg, { depth: 4, breakLength: 120 });
}

function formatLine(level: ConsoleLevel, args: readonly unknown[], now: Date): string {
  const message = sanitizeText(args.map(formatArg).join(' '), 8_000);
  return `[${now.toISOString()}] [${level}] ${message}\n`;
}

/**
 * Deletes log files older than `retentionDays`. Filenames must match
 * `agent-server-YYYYMMDD.log`. Uses file mtime as the age anchor so
 * out-of-band backups don't get wiped.
 */
export function pruneOldLogs(
  logsDir: string,
  retentionDays: number,
  now: Date = new Date(),
): void {
  let entries: string[];
  try {
    entries = readdirSync(logsDir);
  } catch {
    return;
  }
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  for (const name of entries) {
    if (!/^agent-server-\d{8}\.log$/.test(name)) continue;
    const full = join(logsDir, name);
    try {
      const stats = statSync(full);
      if (stats.mtime.getTime() < cutoff) {
        unlinkSync(full);
      }
    } catch {
      // best-effort
    }
  }
}

export function startFileLogger(options: FileLoggerOptions = {}): FileLoggerHandle {
  const logsDir = options.logsDir ?? DEFAULT_LOGS_DIR;
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const nowFn = options.now ?? (() => new Date());

  mkdirSync(logsDir, { recursive: true });
  pruneOldLogs(logsDir, retentionDays, nowFn());

  let currentDay = dayStamp(nowFn());
  let fd = openSync(logFilePath(logsDir, nowFn()), 'a', 0o600);

  const write = (level: ConsoleLevel, args: readonly unknown[]): void => {
    const now = nowFn();
    const day = dayStamp(now);
    if (day !== currentDay) {
      try { closeSync(fd); } catch { /* ignore */ }
      currentDay = day;
      fd = openSync(logFilePath(logsDir, now), 'a', 0o600);
      // Opportunistically prune on rotation so a long-lived daemon eventually
      // clears history without a restart.
      pruneOldLogs(logsDir, retentionDays, now);
    }
    try {
      writeSync(fd, formatLine(level, args, now));
    } catch {
      // Never let a logger crash the daemon.
    }
  };

  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.log = (...args: unknown[]): void => {
    write('log', args);
    originalLog(...args);
  };
  console.warn = (...args: unknown[]): void => {
    write('warn', args);
    originalWarn(...args);
  };
  console.error = (...args: unknown[]): void => {
    write('error', args);
    originalError(...args);
  };

  return {
    stop: (): void => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      try { closeSync(fd); } catch { /* ignore */ }
    },
    currentPath: (): string => logFilePath(logsDir, nowFn()),
  };
}
