import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runAgent, type Reporter } from '../execution/runner.js';
import { TelemetryReporter, type StatusEvent } from '../reporting/reporter.js';
import { makeAgent } from '../test-factories.js';
import type { ExecutionResult } from '../execution/executor.js';

/**
 * Validates the SIGTERM-drain guarantee: when shutdown aborts an active run,
 * the reporter queues and emits the generic operational cancellation state.
 * Local abort details must not cross the Panel boundary.
 */
describe('active-run shutdown drain', () => {
  it('aborting the run controller causes a canceled terminal POST', async () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'drain-lock-'));
    try {
      const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const agent = makeAgent({ id: 'drain-agent', name: 'Drain Agent' });

      const abortController = new AbortController();

      // Build a real TelemetryReporter so we can inspect the outbound POST.
      const createReporter = (runId: string, name: string): Reporter => {
        return new TelemetryReporter({
          runId,
          agentName: name,
          endpoint: `https://panel.example/api/runs/${runId}/status`,
          apiKey: 'local-drain-test-key-123456',
          fetch: fetchImpl,
          heartbeatMs: 0,
          pendingTerminalsDir: join(lockDir, 'pending-terminals'),
        });
      };

      // Executor mimics a long-running agent that respects AbortController.
      const execute = async (
        _a: typeof agent,
        _reporter: Reporter,
      ): Promise<ExecutionResult> => {
        return new Promise((_resolve, reject) => {
          abortController.signal.addEventListener('abort', () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      };

      // Start the run but don't await yet.
      const runPromise = runAgent({
        agent,
        lockDir,
        execute,
        createReporter,
      });

      // Give the run a tick to call reporter.start() then enter execute().
      await new Promise((r) => setImmediate(r));

      // Daemon shutdown: abort the controller.
      abortController.abort();

      const result = await runPromise;
      expect(result.status).toBe('failed');

      const terminalCalls = fetchImpl.mock.calls.filter((call) => {
        const body = JSON.parse(call[1].body) as StatusEvent;
        return body.state === 'canceled';
      });
      expect(terminalCalls.length).toBe(1);
      const canceledBody = JSON.parse(terminalCalls[0][1].body) as StatusEvent;
      expect(canceledBody.state).toBe('canceled');
      expect(canceledBody.error).toEqual({
        message: 'Run canceled.',
        code: 'run_canceled',
      });
      expect(JSON.stringify(canceledBody)).not.toMatch(/abort/i);
    } finally {
      rmSync(lockDir, { recursive: true, force: true });
    }
  });
});
