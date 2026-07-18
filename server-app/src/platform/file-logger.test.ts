import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  startFileLogger,
  dayStamp,
  logFilePath,
  pruneOldLogs,
} from './file-logger.js';

describe('file-logger', () => {
  let tmp: string;
  let originalLog: typeof console.log;
  let originalWarn: typeof console.warn;
  let originalError: typeof console.error;
  let stdoutLog: string[];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'file-logger-'));
    originalLog = console.log;
    originalWarn = console.warn;
    originalError = console.error;
    stdoutLog = [];
    console.log = (...args: unknown[]): void => { stdoutLog.push(`log:${args.join(' ')}`); };
    console.warn = (...args: unknown[]): void => { stdoutLog.push(`warn:${args.join(' ')}`); };
    console.error = (...args: unknown[]): void => { stdoutLog.push(`error:${args.join(' ')}`); };
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('writes log, warn, and error to the day file with ISO timestamps', () => {
    const handle = startFileLogger({ logsDir: tmp });
    try {
      console.log('hello', 'world');
      console.warn('careful');
      console.error('bad', new Error('oops'));
    } finally {
      handle.stop();
    }

    const path = logFilePath(tmp, new Date());
    const contents = readFileSync(path, 'utf8');
    expect(contents).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(contents).toContain('[log] hello world');
    expect(contents).toContain('[warn] careful');
    expect(contents).toContain('[error] bad');
  });

  it('mirrors output to the original console methods (does not swallow)', () => {
    const handle = startFileLogger({ logsDir: tmp });
    try {
      console.log('mirrored');
      console.error('also mirrored');
    } finally {
      handle.stop();
    }
    expect(stdoutLog).toContain('log:mirrored');
    expect(stdoutLog).toContain('error:also mirrored');
  });

  it('redacts secrets before writing console arguments to disk', () => {
    const handle = startFileLogger({ logsDir: tmp });
    try {
      console.error('request failed', {
        authorization: 'Bearer hidden-token-value',
        password: 'correct-horse-battery-staple',
      });
    } finally {
      handle.stop();
    }

    const contents = readFileSync(logFilePath(tmp, new Date()), 'utf8');
    expect(contents).toContain('[REDACTED]');
    expect(contents).not.toContain('hidden-token-value');
    expect(contents).not.toContain('correct-horse-battery-staple');
  });

  it('rotates to a new file when the day changes', () => {
    // Dates are compared by local-time day, so use noon to avoid tz edge cases.
    const day1 = new Date(2026, 3, 14, 12, 0, 0);
    const day2 = new Date(2026, 3, 15, 12, 0, 0);
    let current = day1;
    const handle = startFileLogger({ logsDir: tmp, now: () => current });

    try {
      console.log('before midnight');
      current = day2;
      console.log('after midnight');
    } finally {
      handle.stop();
    }

    const files = readdirSync(tmp).filter((n) => n.endsWith('.log')).sort();
    expect(files).toHaveLength(2);
    expect(files[0]).toContain(dayStamp(day1));
    expect(files[1]).toContain(dayStamp(day2));

    expect(readFileSync(join(tmp, files[0]), 'utf8')).toContain('before midnight');
    expect(readFileSync(join(tmp, files[1]), 'utf8')).toContain('after midnight');
  });

  it('prunes files older than the retention window', () => {
    const now = new Date('2026-04-15T12:00:00Z');
    const oldFile = join(tmp, 'agent-server-20260401.log');
    writeFileSync(oldFile, 'old content');
    // Set mtime to 14 days ago.
    const oldTime = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    utimesSync(oldFile, oldTime, oldTime);

    const recentFile = join(tmp, 'agent-server-20260414.log');
    writeFileSync(recentFile, 'recent');

    pruneOldLogs(tmp, 7, now);

    const remaining = readdirSync(tmp).filter((n) => n.endsWith('.log'));
    expect(remaining).toContain('agent-server-20260414.log');
    expect(remaining).not.toContain('agent-server-20260401.log');
  });
});
