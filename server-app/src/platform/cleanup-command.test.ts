import { describe, expect, it, vi } from 'vitest';
import { PanelCleanupError } from '../reporting/panel-client.js';
import { runCleanupCommand } from './cleanup-command.js';

function createOutput() {
  return {
    log: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
  };
}

describe('cleanup command', () => {
  it('reports the cleaned count and returns success', async () => {
    const output = createOutput();
    const client = { failOrphanedRuns: vi.fn().mockResolvedValue(3) };

    const exitCode = await runCleanupCommand(client, output);

    expect(exitCode).toBe(0);
    expect(output.log).toHaveBeenCalledWith('Cleaned up 3 orphaned run(s).');
    expect(output.error).not.toHaveBeenCalled();
  });

  it('reports missing panel configuration without exiting inside the action', async () => {
    const output = createOutput();

    const exitCode = await runCleanupCommand(null, output);

    expect(exitCode).toBe(1);
    expect(output.error).toHaveBeenCalledWith(
      'No panel URL configured. Set AGENT_SERVER_PANEL_URL and AGENT_SERVER_PANEL_API_KEY.',
    );
  });

  it('turns panel cleanup failures into a concise nonzero outcome', async () => {
    const output = createOutput();
    const client = {
      failOrphanedRuns: vi.fn().mockRejectedValue(
        new PanelCleanupError('Panel cleanup returned 503', 503),
      ),
    };

    const exitCode = await runCleanupCommand(client, output);

    expect(exitCode).toBe(1);
    expect(output.error).toHaveBeenCalledWith('Cleanup failed: Panel cleanup returned 503');
    expect(output.log).not.toHaveBeenCalled();
  });
});
