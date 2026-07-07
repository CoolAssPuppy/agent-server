import { EventEmitter } from 'events';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname } from 'path';
import {
  createClient as defaultCreateClient,
  type SupabaseClient,
} from '@supabase/supabase-js';

/**
 * Direct Supabase Realtime client for the Agent Server daemon.
 *
 * Drop-in replacement for the old `SseClient`: same public surface
 * (`events`, `start()`, `stop()`, `getCursor()`) emitting byte-identical
 * `run_trigger` / `decision_resolved` payloads. Instead of holding a
 * long-lived SSE connection to the panel (a ~24/7 Vercel function), the daemon
 * mints a short-lived org-scoped ES256 JWT from the panel and subscribes to
 * Supabase Realtime `postgres_changes` on `run_triggers` and `decisions`
 * directly. RLS policies keyed to the token's `org_id` claim scope every read.
 *
 * The daemon carries NO Supabase config of its own — its only panel config is
 * `panelUrl` + `panelApiKey`. The token endpoint returns the Supabase URL and
 * public publishable key alongside the token, so a daemon with no panel
 * configured never learns about or contacts Supabase. This keeps Agent Server
 * fully standalone and panel-agnostic; Supabase is an implementation detail of
 * being panel-connected, not a dependency baked into the daemon.
 */

export type RunTriggerEvent = {
  id: number;
  type: 'run_trigger';
  trigger_id: string;
  task_slug: string;
  input?: unknown;
};

export type DecisionResolvedEvent = {
  id: number;
  type: 'decision_resolved';
  decision_id: string;
  task_run_id: string;
  resolution: { action_id: string; input?: string };
};

/**
 * Retained for compile-time parity with the old event catalog. Supabase
 * Realtime has no channel that maps to it, so nothing ever emits it and the
 * client never subscribes for it. Kept so downstream type unions stay stable.
 */
export type AgentFilePokeEvent = {
  id: number;
  type: 'agent_file_poke';
  reason: 'sync_requested';
};

export type AgentServerEvent =
  | RunTriggerEvent
  | DecisionResolvedEvent
  | AgentFilePokeEvent;

export interface SseEvents {
  on(event: 'run_trigger', listener: (e: RunTriggerEvent) => void): this;
  on(event: 'decision_resolved', listener: (e: DecisionResolvedEvent) => void): this;
  on(event: 'agent_file_poke', listener: (e: AgentFilePokeEvent) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
  emit(event: 'run_trigger', e: RunTriggerEvent): boolean;
  emit(event: 'decision_resolved', e: DecisionResolvedEvent): boolean;
  emit(event: 'agent_file_poke', e: AgentFilePokeEvent): boolean;
  emit(event: string, ...args: unknown[]): boolean;
}

const DEFAULT_INITIAL_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;
// Refresh the token this far ahead of its expiry so a live subscription never
// runs on a stale JWT. The panel mints ~30m tokens.
const DEFAULT_REFRESH_SKEW_MS = 5 * 60 * 1000;
// Clamp floor for the refresh timer. Protects against a token whose expiry is
// already near (clock skew, a short-TTL token) scheduling a zero/negative delay
// that would hot-loop the refresh.
const MIN_REFRESH_DELAY_MS = 10_000;
// Bounded caches. Dedup set closes the catch-up-vs-live race; slug cache avoids
// an agent_tasks lookup per live trigger. Both FIFO-evict to cap memory on a
// long-lived daemon.
const DEFAULT_SEEN_LIMIT = 500;
const DEFAULT_SLUG_CACHE_LIMIT = 500;

type RealtimeTokenResponse = {
  token: string;
  expires_at: number;
  org_id: string;
  supabase_url: string;
  supabase_publishable_key: string;
};

type RunTriggerRow = {
  id: string;
  task_id: string;
  input: unknown;
  status?: string;
  created_at: string;
};

type CatchUpTriggerRow = RunTriggerRow & {
  agent_tasks: { slug: string } | null;
};

type DecisionRow = {
  id: string;
  task_run_id: string;
  status: string;
  resolved_at: string | null;
  resolution: { action_id: string; input?: string } | null;
};

// The columns needed to render a pending decision in the macOS app. These map
// 1:1 to the `Decision` model the app decodes, so the daemon's `/decisions`
// endpoint can return these rows verbatim.
const PENDING_DECISION_COLUMNS =
  'id, task_run_id, agent_slug, type, title, payload, status, due_at, defer_until, created_at';

type PendingDecisionRow = {
  id: string;
  task_run_id: string;
  agent_slug: string;
  type: string;
  title: string;
  payload: unknown;
  status: string;
  due_at: string | null;
  defer_until: string | null;
  created_at: string;
};

/**
 * Pending decision as served to the macOS app over the daemon's local
 * `/decisions` endpoint. Keys are snake_case to match the app's `Decision`
 * Codable model; `payload` is always an object (defaulted to `{}`) so the
 * app's non-optional `payload` field always decodes.
 */
export type PendingDecision = {
  id: string;
  task_run_id: string;
  agent_slug: string;
  type: string;
  title: string;
  payload: unknown;
  status: string;
  due_at: string | null;
  defer_until: string | null;
  created_at: string;
};

export type RealtimeClientOptions = {
  panelUrl: string;
  panelApiKey: string;
  cursorPath: string;
  fetch?: typeof globalThis.fetch;
  createClient?: typeof defaultCreateClient;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  refreshSkewMs?: number;
  initialCursor?: number;
};

const toEpoch = (iso: string): number => new Date(iso).getTime();

export class RealtimeClient {
  readonly events: EventEmitter & SseEvents;
  private readonly options: RealtimeClientOptions;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly createClientFn: typeof defaultCreateClient;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly refreshSkewMs: number;

  private cursor: number;
  private token = '';
  private expiresAt = 0;
  private orgId = '';
  private supabaseUrl = '';
  private supabasePublishableKey = '';

  private supabase: SupabaseClient | undefined;

  private stopped = false;
  private running = false;
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshBackoffMs: number;
  private catchUpInFlight: Promise<void> | undefined;

  private readonly seen = new Set<string>();
  private readonly slugCache = new Map<string, string>();
  // Live set of pending decisions for the org, keyed by decision id. Fed by the
  // decisions INSERT/UPDATE subscription and rebuilt on every catch-up. Served
  // to the macOS app over the daemon's local `/decisions` endpoint so the app
  // never polls the panel for them.
  private readonly pending = new Map<string, PendingDecision>();

  constructor(options: RealtimeClientOptions) {
    this.options = options;
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.createClientFn = options.createClient ?? defaultCreateClient;
    this.initialBackoffMs = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.refreshSkewMs = options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
    this.refreshBackoffMs = this.initialBackoffMs;
    this.events = new EventEmitter() as EventEmitter & SseEvents;
    this.cursor = options.initialCursor ?? this.loadCursor();
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.running = false;
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = undefined;
    }
    this.clearRefreshTimer();
    if (this.supabase) {
      void this.supabase.removeAllChannels();
    }
  }

  getCursor(): number {
    return this.cursor;
  }

  /** Current pending decisions for the org, newest first. */
  getPendingDecisions(): PendingDecision[] {
    return [...this.pending.values()].sort((a, b) =>
      a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
    );
  }

  /**
   * Fetch an initial token (retrying on failure so a transient panel outage
   * never keeps the daemon from booting), then stand up the Supabase client,
   * subscribe, and schedule token refresh. Runs once per `start()`; Supabase's
   * own socket handles websocket reconnection thereafter.
   */
  private async connect(): Promise<void> {
    let backoff = this.initialBackoffMs;
    while (!this.stopped) {
      try {
        await this.fetchToken();
        break;
      } catch (err) {
        this.warn(`Token fetch failed: ${message(err)}`);
        await this.delay(backoff);
        backoff = Math.min(backoff * 2, this.maxBackoffMs);
      }
    }
    if (this.stopped) return;

    this.supabase = this.createClientFn(
      this.supabaseUrl,
      this.supabasePublishableKey,
      { accessToken: async () => this.token },
    );
    this.supabase.realtime.setAuth(this.token);

    this.subscribe();
    this.scheduleRefresh();
  }

  private async fetchToken(): Promise<void> {
    const response = await this.fetchFn(
      `${this.options.panelUrl}/api/agent-server/realtime-token`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.options.panelApiKey}` },
      },
    );
    if (!response.ok) {
      throw new Error(`realtime-token responded ${response.status}`);
    }
    const body = (await response.json()) as RealtimeTokenResponse;
    this.token = body.token;
    this.expiresAt = body.expires_at;
    this.orgId = body.org_id;
    this.supabaseUrl = body.supabase_url;
    this.supabasePublishableKey = body.supabase_publishable_key;
  }

  private subscribe(): void {
    if (!this.supabase) return;
    const orgId = this.orgId;

    this.supabase
      .channel(`agent-server-run-triggers-${orgId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'run_triggers',
          filter: `org_id=eq.${orgId}`,
        },
        (payload) => {
          void this.handleRunTriggerInsert(payload.new as RunTriggerRow);
        },
      )
      .subscribe((status) => this.onSubscribeStatus(status));

    this.supabase
      .channel(`agent-server-decisions-${orgId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'decisions',
          filter: `org_id=eq.${orgId}`,
        },
        (payload) => {
          this.reconcilePending(payload.new as PendingDecisionRow);
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'decisions',
          filter: `org_id=eq.${orgId}`,
        },
        (payload) => {
          this.handleDecisionUpdate(
            payload.new as DecisionRow,
            payload.old as Partial<DecisionRow> | undefined,
          );
          this.reconcilePending(payload.new as PendingDecisionRow);
        },
      )
      .subscribe((status) => this.onSubscribeStatus(status));
  }

  /**
   * Keep the pending set current from a decisions row. A row with status
   * `pending` is upserted; any other status (resolved / expired / canceled)
   * removes it. Tolerates partial rows — a missing/blank id is ignored.
   */
  private reconcilePending(row: PendingDecisionRow | undefined): void {
    if (!row || typeof row.id !== 'string' || row.id.length === 0) return;
    if (row.status === 'pending') {
      this.pending.set(row.id, toPending(row));
    } else {
      this.pending.delete(row.id);
    }
  }

  /**
   * Realtime never replays messages sent while we were disconnected, so on
   * every `SUBSCRIBED` (initial subscribe and every socket reconnect) we run
   * the REST catch-up. The in-flight guard coalesces the two channels' near
   * simultaneous startup callbacks into a single query pass.
   */
  private onSubscribeStatus(status: string): void {
    if (status !== 'SUBSCRIBED') return;
    void this.catchUp().catch((err) => this.warn(`Catch-up failed: ${message(err)}`));
  }

  private catchUp(): Promise<void> {
    if (this.catchUpInFlight) return this.catchUpInFlight;
    this.catchUpInFlight = this.runCatchUp().finally(() => {
      this.catchUpInFlight = undefined;
    });
    return this.catchUpInFlight;
  }

  private async runCatchUp(): Promise<void> {
    if (!this.supabase) return;
    const cursorIso = new Date(this.cursor).toISOString();

    const { data: triggers, error: triggerErr } = await this.supabase
      .from('run_triggers')
      .select('id, task_id, input, created_at, agent_tasks!inner(slug)')
      .eq('org_id', this.orgId)
      .eq('status', 'queued')
      .gt('created_at', cursorIso)
      .order('created_at', { ascending: true });

    if (triggerErr) {
      this.warn(`Catch-up run_triggers query failed: ${triggerErr.message}`);
    } else {
      for (const row of (triggers ?? []) as unknown as CatchUpTriggerRow[]) {
        const slug = row.agent_tasks?.slug;
        if (!slug) {
          this.warn(`Dropping catch-up run_trigger ${row.id}: no task_slug for task ${row.task_id}`);
          continue;
        }
        this.cacheSlug(row.task_id, slug);
        this.emitEvent({
          id: toEpoch(row.created_at),
          type: 'run_trigger',
          trigger_id: row.id,
          task_slug: slug,
          input: row.input,
        });
      }
    }

    const { data: decisions, error: decisionErr } = await this.supabase
      .from('decisions')
      .select('id, task_run_id, resolution, resolved_at')
      .eq('org_id', this.orgId)
      .eq('status', 'resolved')
      .gt('resolved_at', cursorIso)
      .order('resolved_at', { ascending: true });

    if (decisionErr) {
      this.warn(`Catch-up decisions query failed: ${decisionErr.message}`);
      return;
    }
    for (const row of (decisions ?? []) as DecisionRow[]) {
      if (!row.resolved_at) continue;
      this.emitEvent({
        id: toEpoch(row.resolved_at),
        type: 'decision_resolved',
        decision_id: row.id,
        task_run_id: row.task_run_id,
        resolution: row.resolution ?? { action_id: '' },
      });
    }

    // Rebuild the pending set from scratch. Realtime never replays inserts that
    // landed while we were disconnected, so this query is the authoritative
    // source for what is currently awaiting a human.
    const { data: pendingRows, error: pendingErr } = await this.supabase
      .from('decisions')
      .select(PENDING_DECISION_COLUMNS)
      .eq('org_id', this.orgId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (pendingErr) {
      this.warn(`Catch-up pending decisions query failed: ${pendingErr.message}`);
      return;
    }
    this.pending.clear();
    for (const row of (pendingRows ?? []) as PendingDecisionRow[]) {
      if (row.status !== 'pending') continue;
      this.pending.set(row.id, toPending(row));
    }
  }

  private async handleRunTriggerInsert(row: RunTriggerRow): Promise<void> {
    if (row.status !== 'queued') return;
    const slug = await this.resolveSlug(row.task_id);
    if (!slug) {
      this.warn(`Dropping run_trigger ${row.id}: no task_slug for task ${row.task_id}`);
      return;
    }
    this.emitEvent({
      id: toEpoch(row.created_at),
      type: 'run_trigger',
      trigger_id: row.id,
      task_slug: slug,
      input: row.input,
    });
  }

  private handleDecisionUpdate(
    newRow: DecisionRow,
    oldRow: Partial<DecisionRow> | undefined,
  ): void {
    // Emit only on the queued -> resolved transition. `old` is only fully
    // populated when the table is REPLICA IDENTITY FULL; when it isn't,
    // `old.status` is undefined and we fall through to emit — the dedup set
    // keeps repeated UPDATEs from double-firing.
    if (newRow.status !== 'resolved') return;
    if (oldRow?.status === 'resolved') return;
    if (!newRow.resolved_at) return;
    this.emitEvent({
      id: toEpoch(newRow.resolved_at),
      type: 'decision_resolved',
      decision_id: newRow.id,
      task_run_id: newRow.task_run_id,
      resolution: newRow.resolution ?? { action_id: '' },
    });
  }

  private emitEvent(event: RunTriggerEvent | DecisionResolvedEvent): void {
    const key =
      event.type === 'run_trigger'
        ? `run:${event.trigger_id}`
        : `dec:${event.decision_id}`;
    if (this.seen.has(key)) return;
    this.remember(key);
    this.cursor = Math.max(this.cursor, event.id);
    this.persistCursor();
    this.events.emit(event.type, event);
  }

  private async resolveSlug(taskId: string): Promise<string | undefined> {
    const cached = this.slugCache.get(taskId);
    if (cached) return cached;
    if (!this.supabase) return undefined;
    const { data, error } = await this.supabase
      .from('agent_tasks')
      .select('slug')
      .eq('id', taskId)
      .eq('org_id', this.orgId)
      .maybeSingle();
    if (error) {
      this.warn(`agent_tasks slug lookup failed for ${taskId}: ${error.message}`);
      return undefined;
    }
    const slug = (data as { slug?: string } | null)?.slug;
    if (typeof slug === 'string' && slug.length > 0) {
      this.cacheSlug(taskId, slug);
      return slug;
    }
    return undefined;
  }

  private cacheSlug(taskId: string, slug: string): void {
    if (this.slugCache.has(taskId)) return;
    if (this.slugCache.size >= DEFAULT_SLUG_CACHE_LIMIT) {
      const oldest = this.slugCache.keys().next().value;
      if (oldest !== undefined) this.slugCache.delete(oldest);
    }
    this.slugCache.set(taskId, slug);
  }

  private remember(key: string): void {
    if (this.seen.size >= DEFAULT_SEEN_LIMIT) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.add(key);
  }

  private scheduleRefresh(): void {
    this.clearRefreshTimer();
    const delay = Math.max(
      this.expiresAt - Date.now() - this.refreshSkewMs,
      MIN_REFRESH_DELAY_MS,
    );
    this.refreshTimer = setTimeout(() => {
      void this.refresh();
    }, delay);
  }

  private async refresh(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.fetchToken();
      this.supabase?.realtime.setAuth(this.token);
      this.refreshBackoffMs = this.initialBackoffMs;
      this.scheduleRefresh();
    } catch (err) {
      this.warn(`Token refresh failed: ${message(err)}`);
      this.refreshBackoffMs = Math.min(this.refreshBackoffMs * 2, this.maxBackoffMs);
      this.clearRefreshTimer();
      this.refreshTimer = setTimeout(() => {
        void this.refresh();
      }, this.refreshBackoffMs);
    }
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.connectTimer = setTimeout(() => {
        this.connectTimer = undefined;
        resolve();
      }, ms);
    });
  }

  private loadCursor(): number {
    try {
      if (!existsSync(this.options.cursorPath)) return 0;
      const raw = readFileSync(this.options.cursorPath, 'utf-8').trim();
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    } catch {
      return 0;
    }
  }

  private persistCursor(): void {
    try {
      mkdirSync(dirname(this.options.cursorPath), { recursive: true });
      writeFileSync(this.options.cursorPath, String(this.cursor), 'utf-8');
    } catch (err) {
      this.warn(`Failed to persist cursor: ${message(err)}`);
    }
  }

  private warn(text: string): void {
    console.error(`[realtime-client] ${text}`);
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Normalize a decisions row into the shape the macOS app decodes. `payload` is
 * defaulted to `{}` so the app's non-optional `payload` field always decodes,
 * and the optional timestamps pass through as null when absent.
 */
function toPending(row: PendingDecisionRow): PendingDecision {
  return {
    id: row.id,
    task_run_id: row.task_run_id,
    agent_slug: row.agent_slug,
    type: row.type,
    title: row.title,
    payload: row.payload ?? {},
    status: row.status,
    due_at: row.due_at ?? null,
    defer_until: row.defer_until ?? null,
    created_at: row.created_at,
  };
}
