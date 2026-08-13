import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentLogger, type AgentLoggerOptions } from './logger.js';
import { AgentLogStore } from './log-store.js';
import type { LogDestination, ReadableLogDestination } from './destination.js';
import { LogEntryTooLargeError, type LogRecord } from './record.js';

type RecordingDestination = LogDestination & { readonly records: LogRecord[] };

function createRecordingDestination(name = 'recorder'): RecordingDestination {
  const records: LogRecord[] = [];
  return { name, records, write: (record) => { records.push(record); } };
}

function createThrowingDestination(name = 'broken'): LogDestination {
  return {
    name,
    write: () => {
      throw new Error('driver is down');
    },
  };
}

function createRejectingDestination(name = 'slow'): LogDestination {
  return { name, write: async () => Promise.reject(new Error('driver is unreachable')) };
}

/**
 * A second driver that also holds entries and would happily answer a read. It
 * exists to prove the logger asks the designated driver and only that one.
 */
function createDecoyReadableDestination(name = 'decoy'): ReadableLogDestination {
  const decoy: LogRecord = {
    timestamp: '2020-01-01T00:00:00.000Z',
    level: 'info',
    message: 'from the decoy driver',
    agent_id: 'daily-focus',
    run_id: 'run-1',
    machine_id: 'other-machine',
    hostname: 'other-host',
    source: 'agent',
  };
  return {
    name,
    write: () => {},
    readRun: () => [decoy],
    readAgent: () => [decoy],
  };
}

function createLocalStore(): AgentLogStore {
  return new AgentLogStore({ root: mkdtempSync(join(tmpdir(), 'agent-logger-')) });
}

function createLogger(overrides: Partial<AgentLoggerOptions> = {}): AgentLogger {
  return new AgentLogger({
    readsFrom: createLocalStore(),
    machineId: 'machine-uuid',
    hostname: 'test-mac',
    now: () => new Date('2026-08-13T06:45:00.000Z'),
    ...overrides,
  });
}

describe('agent logger', () => {
  it('hands the same stamped record to every driver', () => {
    const first = createRecordingDestination('first');
    const second = createRecordingDestination('second');
    const logger = createLogger({ destinations: [first, second] });

    logger.append({ agentId: 'daily-focus', runId: 'run-1', message: 'Notion write failed' });

    expect(first.records).toEqual(second.records);
    expect(first.records[0]).toMatchObject({
      timestamp: '2026-08-13T06:45:00.000Z',
      level: 'info',
      message: 'Notion write failed',
      agent_id: 'daily-focus',
      run_id: 'run-1',
      machine_id: 'machine-uuid',
      hostname: 'test-mac',
      source: 'agent',
    });
  });

  it('writes to the designated driver as well as the extra ones', () => {
    const store = createLocalStore();
    const extra = createRecordingDestination();
    const logger = createLogger({ readsFrom: store, destinations: [extra] });

    logger.append({ agentId: 'daily-focus', runId: 'run-1', message: 'Started' });

    expect(store.readRun({ agentId: 'daily-focus', runId: 'run-1' })).toHaveLength(1);
    expect(extra.records).toHaveLength(1);
  });

  it('keeps the other drivers writing when one of them throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const healthy = createRecordingDestination('healthy');
      const logger = createLogger({ destinations: [createThrowingDestination(), healthy] });

      expect(() => logger.append({ agentId: 'daily-focus', runId: 'run-1', message: 'Started' }))
        .not.toThrow();
      expect(healthy.records).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps the other drivers writing when one of them rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const healthy = createRecordingDestination('healthy');
      const logger = createLogger({ destinations: [createRejectingDestination(), healthy] });

      logger.append({ agentId: 'daily-focus', runId: 'run-1', message: 'Started' });
      await Promise.resolve();

      expect(healthy.records).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('reports a failure of the driver reads come from, because a caller expects to read the entry back', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const healthy = createRecordingDestination('healthy');
      const logger = createLogger({
        readsFrom: { ...createDecoyReadableDestination(), write: () => { throw new Error('disk is full'); } },
        destinations: [healthy],
      });

      expect(() => logger.append({ agentId: 'daily-focus', runId: 'run-1', message: 'Started' }))
        .toThrow('disk is full');
      expect(healthy.records).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('reads only from the designated driver, never from another one holding entries', () => {
    const store = createLocalStore();
    const logger = createLogger({ readsFrom: store, destinations: [createDecoyReadableDestination()] });
    logger.append({ agentId: 'daily-focus', runId: 'run-1', message: 'the real entry' });

    expect(logger.readAgent('daily-focus').map((entry) => entry.message)).toEqual(['the real entry']);
    expect(logger.readRun({ agentId: 'daily-focus', runId: 'run-1' }).map((entry) => entry.message))
      .toEqual(['the real entry']);
  });

  it('returns entries for one run, oldest first', () => {
    const logger = createLogger();

    logger.append({ agentId: 'daily-focus', runId: 'run-1', message: 'first' });
    logger.append({ agentId: 'daily-focus', runId: 'run-2', message: 'other run' });
    logger.append({ agentId: 'daily-focus', runId: 'run-1', message: 'second' });

    expect(logger.readRun({ agentId: 'daily-focus', runId: 'run-1' }).map((entry) => entry.message))
      .toEqual(['first', 'second']);
  });

  it('rejects an oversized entry before any driver sees it', () => {
    const destination = createRecordingDestination();
    const logger = createLogger({ destinations: [destination], maxBytes: 64 });

    expect(() => logger.append({
      agentId: 'daily-focus', runId: 'run-1', message: 'big', body: 'x'.repeat(200),
    })).toThrow(LogEntryTooLargeError);
    expect(destination.records).toEqual([]);
  });

  it('carries caller supplied fields without letting them overwrite the standard ones', () => {
    const destination = createRecordingDestination();
    const logger = createLogger({ destinations: [destination] });

    logger.append({
      agentId: 'daily-focus',
      runId: 'run-1',
      message: 'Spend check',
      data: { spend: 42, agent_id: 'spoofed', level: 'debug' },
    });

    expect(destination.records[0]).toMatchObject({ spend: 42, agent_id: 'daily-focus', level: 'info' });
  });

  it('gives every driver that queues a last chance to deliver', async () => {
    const delivered: string[] = [];
    const queueing = (name: string): LogDestination => ({
      name,
      write: () => {},
      shutdown: async () => { delivered.push(name); },
    });
    const logger = createLogger({ destinations: [queueing('first'), queueing('second')] });

    await logger.shutdown();

    expect(delivered).toEqual(['first', 'second']);
  });

  it('shuts the remaining drivers down when one of them fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const delivered: string[] = [];
      const logger = createLogger({
        destinations: [
          { name: 'broken', write: () => {}, shutdown: async () => { throw new Error('no route'); } },
          { name: 'healthy', write: () => {}, shutdown: async () => { delivered.push('healthy'); } },
        ],
      });

      await expect(logger.shutdown()).resolves.toBeUndefined();
      expect(delivered).toEqual(['healthy']);
    } finally {
      warn.mockRestore();
    }
  });

  it('marks who wrote the entry so the server cannot be impersonated', () => {
    const destination = createRecordingDestination();
    const logger = createLogger({ destinations: [destination] });

    logger.append({ agentId: 'daily-focus', runId: 'run-1', message: 'agent said so' });
    logger.append({ agentId: 'daily-focus', runId: 'run-1', message: 'server said so', source: 'server' });

    expect(destination.records.map((record) => record.source)).toEqual(['agent', 'server']);
  });
});
