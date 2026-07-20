import { watch, type FSWatcher } from 'fs';
import type { AgentConfig } from '../agents/config.js';
import { discoverAgents } from '../agents/discovery.js';
import { getNextRun } from '../agents/scheduler.js';
import { toErrorMessage } from '../util/errors.js';

const DEFAULT_FILE_CHANGE_DEBOUNCE_MS = 2_000;
const DEFAULT_HOURLY_INTERVAL_MS = 60 * 60 * 1_000;
const MAX_DESCRIPTION_LENGTH = 2_000;

export type AgentSyncRowPayload = {
  slug: string;
  name: string;
  description?: string;
  cron_expression?: string;
  next_run_at?: string;
  timezone?: string;
};

export type AgentSyncPayload = {
  agents: AgentSyncRowPayload[];
};

export type SyncResult =
  | { ok: true; status: number; count: number }
  | { ok: false; status?: number; error?: string };

export function extractDescription(agent: AgentConfig): string | undefined {
  const explicit = agent.description?.trim();
  if (explicit) return explicit;

  const prompt = agent.prompt?.trim();
  if (!prompt) return undefined;

  const firstParagraph = prompt.split(/\r?\n\s*\r?\n/)[0]?.trim();
  if (!firstParagraph) return undefined;

  if (firstParagraph.length > MAX_DESCRIPTION_LENGTH) {
    return firstParagraph.slice(0, MAX_DESCRIPTION_LENGTH);
  }
  return firstParagraph;
}

function computeNextRun(agent: AgentConfig, now: Date): string | undefined {
  if (!agent.schedule) return undefined;
  try {
    const next = getNextRun(agent, now);
    return next?.toISOString();
  } catch {
    return undefined;
  }
}

export function buildAgentSyncPayload(agents: AgentConfig[], now: Date): AgentSyncPayload {
  const rows: AgentSyncRowPayload[] = [];

  for (const agent of agents) {
    if (!agent.enabled) continue;

    const row: AgentSyncRowPayload = {
      slug: agent.id,
      name: agent.name,
    };

    const description = extractDescription(agent);
    if (description) row.description = description;

    if (agent.schedule) row.cron_expression = agent.schedule;
    if (agent.timezone) row.timezone = agent.timezone;

    const nextRunAt = computeNextRun(agent, now);
    if (nextRunAt) row.next_run_at = nextRunAt;

    rows.push(row);
  }

  return { agents: rows };
}

type SyncOptions = {
  agentsDir: string;
  panelUrl: string;
  panelApiKey: string;
  fetch?: typeof globalThis.fetch;
  now?: Date;
};

export async function syncAgentSchedule(options: SyncOptions): Promise<SyncResult> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const now = options.now ?? new Date();

  let payload: AgentSyncPayload;
  try {
    const agents = await discoverAgents(options.agentsDir);
    payload = buildAgentSyncPayload(agents, now);
  } catch (err) {
    const message = toErrorMessage(err);
    console.error(`[sync-schedule] Failed to build agent catalog: ${message}`);
    return { ok: false, error: message };
  }

  try {
    const response = await fetchFn(`${options.panelUrl}/api/agents/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${options.panelApiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`[sync-schedule] Panel responded ${response.status}`);
      return { ok: false, status: response.status };
    }

    console.log(`[sync-schedule] Synced ${payload.agents.length} agent(s) to panel`);
    return { ok: true, status: response.status, count: payload.agents.length };
  } catch (err) {
    const message = toErrorMessage(err);
    console.error(`[sync-schedule] Failed to sync agent schedule: ${message}`);
    return { ok: false, error: message };
  }
}

type ScheduleSyncOptions = SyncOptions & {
  fileChangeDebounceMs?: number;
  hourlyIntervalMs?: number;
};

export class ScheduleSync {
  private readonly options: ScheduleSyncOptions;
  private readonly debounceMs: number;
  private readonly hourlyMs: number;
  private watcher: FSWatcher | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private hourlyTimer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;

  constructor(options: ScheduleSyncOptions) {
    this.options = options;
    this.debounceMs = options.fileChangeDebounceMs ?? DEFAULT_FILE_CHANGE_DEBOUNCE_MS;
    this.hourlyMs = options.hourlyIntervalMs ?? DEFAULT_HOURLY_INTERVAL_MS;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.runSync();
    if (this.stopped) return;
    this.startFileWatcher();
    this.startHourlyFallback();
  }

  stop(): void {
    this.stopped = true;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    if (this.hourlyTimer) {
      clearInterval(this.hourlyTimer);
      this.hourlyTimer = undefined;
    }
  }

  private async runSync(): Promise<void> {
    await syncAgentSchedule(this.options);
  }

  private startFileWatcher(): void {
    try {
      this.watcher = watch(this.options.agentsDir, { recursive: false }, (_event, filename) => {
        if (!filename) return;
        if (!this.isAgentFile(filename.toString())) return;
        this.scheduleDebouncedSync();
      });
      this.watcher.on('error', (err) => {
        console.error(`[sync-schedule] File watcher error: ${err}`);
      });
    } catch (err) {
      const message = toErrorMessage(err);
      console.warn(`[sync-schedule] Could not watch agents directory: ${message}`);
    }
  }

  private isAgentFile(filename: string): boolean {
    return /\.(ya?ml|md)$/i.test(filename);
  }

  private scheduleDebouncedSync(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      if (this.stopped) return;
      void this.runSync();
    }, this.debounceMs);
  }

  private startHourlyFallback(): void {
    this.hourlyTimer = setInterval(() => {
      if (this.stopped) return;
      void this.runSync();
    }, this.hourlyMs);
  }
}
