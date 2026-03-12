type PanelClientConfig = {
  panelUrl: string;
  panelApiKey: string;
  fetch?: typeof globalThis.fetch;
};

export class PanelClient {
  private readonly panelUrl: string;
  private readonly panelApiKey: string;
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(config: PanelClientConfig) {
    this.panelUrl = config.panelUrl;
    this.panelApiKey = config.panelApiKey;
    this.fetchFn = config.fetch ?? globalThis.fetch;
  }

  async failOrphanedRuns(serverId?: string): Promise<number> {
    try {
      const body = serverId ? { worker_id: serverId } : {};
      const response = await this.fetchFn(`${this.panelUrl}/api/runs/cleanup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.panelApiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        console.error(`[panel-client] Cleanup returned ${response.status}`);
        return 0;
      }

      const result = await response.json() as { cleaned?: number };
      return result.cleaned ?? 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[panel-client] Failed to clean up orphaned runs: ${message}`);
      return 0;
    }
  }

  async markStaleRuns(): Promise<void> {
    try {
      const response = await this.fetchFn(`${this.panelUrl}/api/cron/stale-runs`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.panelApiKey}`,
        },
      });

      if (!response.ok) {
        console.error(`[panel-client] Stale runs check returned ${response.status}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[panel-client] Failed to mark stale runs: ${message}`);
    }
  }
}

export function createPanelClient(config: { panelUrl?: string; panelApiKey?: string }): PanelClient | null {
  if (!config.panelUrl || !config.panelApiKey) {
    return null;
  }

  return new PanelClient({
    panelUrl: config.panelUrl,
    panelApiKey: config.panelApiKey,
  });
}
