import { watch } from 'fs';
import type { AgentConfig } from '../agents/config.js';
import { discoverAgentDefinitions, isAgentFile } from '../agents/discovery.js';
import { getNextRun } from '../agents/scheduler.js';
import { toErrorMessage } from '../util/errors.js';
import { withTimeout } from '../util/with-timeout.js';
import { buildV2AssistantSyncPayload, type V2AssistantSyncPayload } from './v2-assistant-sync.js';

const DEFAULT_FILE_CHANGE_DEBOUNCE_MS = 2_000;
const DEFAULT_HOURLY_INTERVAL_MS = 60 * 60 * 1_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

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
  /**
   * Present once this Mac is paired. It turns the sync into a check-in: Panel
   * can attribute the agents to a device and record that it was heard from,
   * neither of which an organization-wide sync can say.
   */
  machineId?: string;
  fetch?: typeof globalThis.fetch;
  now?: Date;
  requestTimeoutMs?: number;
};

/**
 * The catalog to send, in whichever protocol this daemon can speak.
 *
 * An unpaired daemon has no machine to name, so it keeps sending the
 * organization-wide payload it always has.
 */
async function buildSyncPayload(
  options: SyncOptions,
  now: Date,
): Promise<{ body: AgentSyncPayload | V2AssistantSyncPayload; count: number }> {
  const definitions = await discoverAgentDefinitions(options.agentsDir);

  if (options.machineId) {
    const body = buildV2AssistantSyncPayload(definitions, {
      machineId: options.machineId,
      now,
    });
    return { body, count: body.assistants.length };
  }

  const body = buildAgentSyncPayload(
    definitions.map((definition) => definition.agent),
    now,
  );
  return { body, count: body.agents.length };
}

export async function syncAgentSchedule(options: SyncOptions): Promise<SyncResult> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const now = options.now ?? new Date();

  let payload: { body: AgentSyncPayload | V2AssistantSyncPayload; count: number };
  try {
    payload = await buildSyncPayload(options, now);
  } catch (err) {
    const message = toErrorMessage(err);
    console.error(`[sync-schedule] Failed to build agent catalog: ${message}`);
    return { ok: false, error: message };
  }

  try {
    const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const requestController = new AbortController();
    const response = await withTimeout(
      fetchFn(`${options.panelUrl}/api/agents/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${options.panelApiKey}`,
        },
        body: JSON.stringify(payload.body),
        signal: requestController.signal,
      }),
      {
        timeoutMs: requestTimeoutMs,
        createError: () => new Error(
          `Panel schedule sync timed out after ${requestTimeoutMs}ms`,
        ),
        onTimeout: () => requestController.abort(),
      },
    );

    if (!response.ok) {
      console.error(`[sync-schedule] Panel responded ${response.status}`);
      return { ok: false, status: response.status };
    }

    console.log(`[sync-schedule] Synced ${payload.count} agent(s) to panel`);
    return { ok: true, status: response.status, count: payload.count };
  } catch (err) {
    const message = toErrorMessage(err);
    console.error(`[sync-schedule] Failed to sync agent schedule: ${message}`);
    return { ok: false, error: message };
  }
}

type ScheduleSyncOptions = SyncOptions & {
  fileChangeDebounceMs?: number;
  hourlyIntervalMs?: number;
  watchDirectory?: WatchDirectory;
};

type DirectoryWatch = {
  close: () => void;
  onError: (listener: (error: Error) => void) => void;
};

export type WatchDirectory = (
  path: string,
  onChange: (filename: string | Buffer | null) => void,
) => DirectoryWatch;

const watchDirectory: WatchDirectory = (path, onChange) => {
  const watcher = watch(path, { recursive: false }, (_event, filename) => onChange(filename));
  return {
    close: () => watcher.close(),
    onError: (listener) => watcher.on('error', listener),
  };
};

export class ScheduleSync {
  private readonly options: ScheduleSyncOptions;
  private readonly debounceMs: number;
  private readonly hourlyMs: number;
  private watcher: DirectoryWatch | undefined;
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
    this.startFileWatcher();
    void this.runSync().finally(() => {
      if (this.stopped) return;
      this.startHourlyFallback();
    });
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
      const createWatcher = this.options.watchDirectory ?? watchDirectory;
      this.watcher = createWatcher(this.options.agentsDir, (filename) => {
        if (!filename) return;
        if (!isAgentFile(filename.toString())) return;
        this.scheduleDebouncedSync();
      });
      this.watcher.onError((err) => {
        console.error(`[sync-schedule] File watcher error: ${err}`);
      });
    } catch (err) {
      const message = toErrorMessage(err);
      console.warn(`[sync-schedule] Could not watch agents directory: ${message}`);
    }
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
