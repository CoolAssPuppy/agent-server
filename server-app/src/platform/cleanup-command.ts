import { PanelCleanupError, type PanelClient } from '../reporting/panel-client.js';

type CleanupClient = Pick<PanelClient, 'failOrphanedRuns'>;

type CleanupCommandOutput = {
  log: (message: string) => void;
  error: (message: string) => void;
};

export async function runCleanupCommand(
  client: CleanupClient | null,
  output: CleanupCommandOutput,
): Promise<0 | 1> {
  if (!client) {
    output.error(
      'No panel URL configured. Set AGENT_SERVER_PANEL_URL and AGENT_SERVER_PANEL_API_KEY.',
    );
    return 1;
  }

  try {
    const cleaned = await client.failOrphanedRuns();
    output.log(`Cleaned up ${cleaned} orphaned run(s).`);
    return 0;
  } catch (error) {
    if (!(error instanceof PanelCleanupError)) throw error;
    output.error(`Cleanup failed: ${error.message}`);
    return 1;
  }
}
