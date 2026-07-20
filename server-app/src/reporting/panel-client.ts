import { toErrorMessage } from '../util/errors.js';
type PanelClientConfig = {
  panelUrl: string;
  panelApiKey: string;
  fetch?: typeof globalThis.fetch;
};

export type PanelRunRow = {
  id: string;
  task_id: string;
  task_name: string;
  status: string;
  trigger?: string;
  queued_at?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  duration_ms?: number | null;
  error_message?: string | null;
  result?: Record<string, unknown> | null;
  conversation_id?: string | null;
};

export class PanelCleanupError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PanelCleanupError';
  }
}

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
        throw new PanelCleanupError(`Panel cleanup returned ${response.status}`, response.status);
      }

      const result = await response.json() as { cleaned?: number };
      return result.cleaned ?? 0;
    } catch (err) {
      if (err instanceof PanelCleanupError) throw err;
      const message = toErrorMessage(err);
      throw new PanelCleanupError(`Panel cleanup request failed: ${message}`, undefined, {
        cause: err,
      });
    }
  }

  async fetchRecentRuns(limit = 200): Promise<PanelRunRow[]> {
    const cappedLimit = Math.min(Math.max(Math.floor(limit), 1), 200);
    const response = await this.fetchFn(
      `${this.panelUrl}/api/runs?limit=${cappedLimit}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.panelApiKey}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Panel returned ${response.status} fetching recent runs`);
    }

    const body = await response.json() as { runs?: PanelRunRow[] };
    return Array.isArray(body.runs) ? body.runs : [];
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
