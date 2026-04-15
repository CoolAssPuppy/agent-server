# Server audit (2026-04-15)

Scope: `agent-server/server-app/src/**`. Findings verified against actual code.

## P0 — fix immediately

### 1. `startServer` never calls `replayPendingTerminals` — terminal events rot on disk forever

- File: `server-app/src/server/server.ts` (entry function `startServer`, lines ~140–505)
- Related: `server-app/src/cli.ts:37–38` (CLI entry uses `startServer`, not `startDaemon`)
- Related: `server-app/src/server/daemon.ts:219` (the ONLY place `replayPendingTerminals()` is invoked)

`cli.ts` invokes `startServer(config, ...)`. `startDaemon(config)` is exported but never called from the CLI — dead code. The recent fix in `a0f078d` that added `void replayPendingTerminals()` on startup only added it to `startDaemon`. In production (`startServer`), persisted pending terminals in `~/.agent-server/pending-terminals/*.json` are never retried.

Consequence: when a terminal POST fails all in-memory retries (3 immediate + 5 deferred, ~3 minutes total), `reporter.ts:267` persists the event to disk. Because nothing ever reads that directory again, the panel never learns the run completed. Next heartbeat does not arrive (reporter already `stop()`ed), the run sits in `working` until the panel's 90s stale sweep reclassifies it as failed.

**This is the "finished on Mac but Agent Panel shows running" symptom.** The sequence: flaky network during terminal POST, retries exhaust, run is persisted, never replayed. If the stale sweep is also slow or rate-limited server-side (the daemon pokes `markStaleRuns` only every 5 minutes via `server.ts:502`), you can see "running" for many minutes.

Fix sketch: call `void replayPendingTerminals()` during `startServer` (before or just after `serve()` returns). Also replay once on a timer (e.g., every 10 minutes) so long-lived daemons eventually drain the queue without needing a restart.

### 2. SSE trigger channel and schedule-sync are never started in production

- File: `server-app/src/server/server.ts` (all of `startServer`)
- Related: `server-app/src/server/daemon.ts:229–265` (creates `ScheduleSync`, `SseClient`, `TriggerHandler` — but `startDaemon` is unused)

`startServer` does not instantiate `SseClient`, `TriggerHandler`, or `ScheduleSync`. So:

- Manual panel-side triggers (`run_trigger` SSE events from Agent Panel) never reach the daemon.
- Agent catalog sync (panel's view of cron / `next_run_at`) never happens.
- Decision-resolved SSE events never reach `runDecisionCycle` — the whole paused-decision flow is non-functional from the panel.

This is the second most likely reason runs "go missing" — if the user is triggering runs from the panel UI expecting the daemon to pick them up, nothing is listening. The Hono API on port 47821 accepts local triggers, but panel-triggered runs over SSE are dropped.

Fix sketch: Either (a) delete `startDaemon` and move its setup code into `startServer`, or (b) have `startServer` call `startDaemon`'s setup explicitly. Also pass `buildDecisionContext` to `runAgent` so decisions can pause/resume.

### 3. SIGTERM / SIGINT does not cancel in-flight runs or emit terminal events

- File: `server-app/src/cli.ts:40–46` (`shutdown = () => { server.stop(); process.exit(0); }`)
- File: `server-app/src/server/server.ts:671–680` (`stop` only clears intervals and `httpServer.close()`)

On shutdown, `activeControllers` (the map of `AbortController`s keyed by runId) is never iterated. No `controller.abort()`. No terminal `failed`/`canceled` POST. The daemon dies, the panel continues to see `working` until its 90s stale sweep. The user will see "still running" every time macOS restarts the daemon, puts the Mac to sleep mid-run, or upgrades.

Fix sketch: in `stop()`, abort each active controller, await their reporters to emit `cancel('daemon_shutting_down', 'daemon_shutdown')`, bounded by a short drain timeout (e.g., 3s per run). Persist anything unsent via the same pending-terminal mechanism.

### 4. Panel `409 already terminal` is treated as a failure in the send loop, but as success in replay

- File: `server-app/src/reporting/reporter.ts:242–247` (only `response.ok` counts as success)
- Compare: `server-app/src/reporting/reporter.ts:347` (replay treats 409 as success)
- Panel route: `agent-panel/web/app/api/runs/[runId]/status/route.ts:202–207` returns 409 when run is already terminal

If the stale sweep beats a slow agent and writes `failed` first, then the agent's own `complete` POST arrives, the panel returns 409 (unless it's a stale-sweep override path for `completed`/`canceled`, which IS supported at `status/route.ts:195–207`). For `failed`→`completed` the override works. For `failed`→`failed` (the sweep already wrote "no heartbeat", and the agent's real error arrives), the panel rejects with 409. The reporter then retries 3 more times, then persists to disk, then deferred-retries 5 more times — all 409s. Eventually it's persisted to disk, where `replayPendingTerminals` would treat 409 as success (line 347). But per P0 #1, replay never runs.

Fix sketch: treat 409 as success in the main `send()` loop too. A 409 means the panel has the state; stop retrying.

### 5. `scheduleDeferredRetry` leaks timers and keeps the event loop alive

- File: `server-app/src/reporting/reporter.ts:264–296`

`setTimeout` is not `unref()`'d. If the daemon is shutting down while a deferred retry is pending (5 retries at up to 80s each with exponential backoff), process exit is delayed. More importantly, after `reporter.stop()` has been called, the deferred retry chain continues firing in the background because it has no reference to `terminalSent` or `stop` state. It will keep hitting the network until its 5 attempts exhaust.

Fix sketch: store the timer handle on the instance, clear it in `stop()`, and call `.unref()` so it never blocks shutdown.

### 6. Terminal POST retry budget is far too short for real networks

- File: `server-app/src/reporting/reporter.ts:49–52`

`TERMINAL_RETRY_COUNT = 3`, `TERMINAL_RETRY_BASE_MS = 500`. Total ~3.5s of immediate retry. Then 5 deferred retries with base 5s exponential up to ~80s. Total ~80s before giving up and persisting. A wifi roam, VPN reconnect, or laptop wake-from-sleep regularly exceeds this. The whole point of the pending-terminal queue is fine — but without replay (P0 #1), once you hit the end of this ladder, the event is lost.

Fix sketch: keep the retry ladder the same, but make replay actually run (P0 #1) and also replay on a periodic timer.

## P1 — fix this week

### 7. No logs are written in the packaged macOS app

- File: `server-app/src/platform/launchd.ts:37–40` (redirects stdout/stderr to `~/.agent-server/logs/agent-server.log` / `.err`)

That redirect only applies when the server is started by `launchctl` using the plist installed by `agent-server install`. The macOS app embeds the daemon and launches it as a child process. stdout/stderr go to the parent — a GUI app — and nowhere the user can see. The user reports `~/.agent-server/logs/` is empty because launchd isn't doing the redirection.

No observability means no debugging stuck runs. Every finding in this audit is harder to verify because there are no logs.

Fix sketch: add a log file sink inside the daemon itself, independent of launchd. Rotate by size (e.g., 10 MB) or day. Mirror `console.log`/`console.error` to `~/.agent-server/logs/agent-server-YYYYMMDD.log`. Keep the last 7 days. Don't depend on the parent process to do this.

### 8. Trigger-handler bypasses `maxConcurrentRuns` cap

- File: `server-app/src/server/daemon.ts:182–206` (`createInvokeRun` goes straight to `runAgent`, not through `triggerRunForAgent`)
- Compare: `server-app/src/server/server.ts:231–233` (the concurrency cap is enforced only in `triggerRunForAgent`)

Also: trigger-handler is currently dead code per P0 #2, so the impact is latent. When you fix P0 #2, this becomes live.

Fix sketch: route all run creation through a single entry point that owns the `activeControllers` map, the concurrency cap, and the `RunStore` update. Remove the duplicate code path in `daemon.ts`.

### 9. `cancelRun` fails the run locally but never tells the panel

- File: `server-app/src/server/server.ts:381–393`

When the local API `/runs/:id/cancel` is hit, we abort the controller and mark `failed` in the local `RunStore`, but the TelemetryReporter is inside `runAgent`'s closure and will observe the `AbortError` through `isAbortError` (runner.ts:131). The runner calls `reporter.cancel(...)`. That path works, but the local `store.update(runId, { status: 'failed', ... })` in `cancelRun` runs BEFORE the reporter's cancel POST. If the reporter's POST fails (P0 #1), panel shows running.

Also: `store.update` writes `status: 'failed'` in `cancelRun` but the reporter then writes `status: 'canceled'` to the panel. Two different statuses for the same event.

Fix sketch: unify via the reporter. Have `cancelRun` abort the controller and let the normal runner finally-block emit the terminal. Don't write to the local store twice.

### 10. Heartbeat interval 30s vs panel stale threshold 90s is within one missed beat of false-positives

- File: `server-app/src/platform/config.ts:32` (`heartbeatMs: 30_000`)
- Panel CLAUDE.md: "marks runs as failed if no heartbeat arrives within 90 seconds"

3x the heartbeat interval gives you only 2 missed heartbeats before a false failure. On wifi roam or laptop resume, 90s is easily exceeded even though the run is alive. The false failure then triggers the 409-override edge case in #4.

Fix sketch: either lower heartbeat to 15s, or raise panel-side stale threshold to 3 minutes. 5x the heartbeat interval is a more forgiving ratio.

### 11. `runAgent` + `server.ts` double-execute status transitions

- File: `server-app/src/server/server.ts:291–301` (after `await executor(...)`, the code updates `RunStore` with `status: 'completed'`)
- Compare: `server-app/src/server/server.ts:327–349` (the `.then()` chain also handles completion)

For a successful run, the wrapped execute callback marks `completed`, fires broadcaster, sends notification, fires downstream triggers. Then `runAgent` resolves with `{ status: 'completed' }` and the `.then()` handler runs — at that point it's a no-op only for the completed path (it just early-returns if skipped, writes `failed` if failed). Not a correctness bug, but the flow is confusing: run completion logic is split across two callbacks that must stay in sync.

Additionally: if the executor throws AFTER writing `status: 'completed'` (it doesn't currently, but any future code change could), both paths would fire.

Fix sketch: move all post-run bookkeeping into the `.then()`/`.catch()` continuation. The executor callback should only call `reporter.complete()`.

### 12. File watcher uses non-recursive `fs.watch`, missing nested file changes

- File: `server-app/src/agents/file-watcher.ts:67` (`{ recursive: false }`)

Agents that declare `watch: [{ path: '~/Documents/projects' }]` expecting to observe a subtree will only see direct children. Also, `fs.watch` on macOS has known duplicate-event issues that the 500ms debounce does not fully handle for rename events (rename fires twice with different filenames).

Fix sketch: set `recursive: true` or switch to chokidar (already a transitive dependency via many ecosystems). Document the depth limit. Deduplicate on inode, not just path.

### 13. Lockfile has a TOCTOU window

- File: `server-app/src/execution/lockfile.ts:27–41`

`existsSync` → `readFileSync` → `isProcessAlive` → `unlinkSync` → `writeFileSync` is not atomic. Two daemon processes (e.g., during an install/upgrade swap) could both read the stale lock, both delete it, both write their own pid. Same agent could execute twice in parallel.

Fix sketch: use `fs.open(path, 'wx')` to create-exclusive, then write pid. On `EEXIST`, stat to see if the existing lock is stale (dead pid), and if so, `unlink` + retry. Bound retries to avoid a hot loop.

### 14. `isProcessAlive(pid)` returns true for any pid owned by another process

- File: `server-app/src/execution/lockfile.ts:8–15`

If the daemon dies with pid 12345, then later `launchd` starts an unrelated process that happens to be assigned pid 12345, our lockfile will think the old agent is still running. Low probability but real, especially after macOS reboots with aggressive pid reuse.

Fix sketch: include a start-time or a uuid in the lockfile alongside the pid. Match both on check.

### 15. Pending-terminal files carry the API key in cleartext

- File: `server-app/src/reporting/reporter.ts:299–317`

`persistPendingTerminal` serializes `{ runId, endpoint, apiKey, body }` to `~/.agent-server/pending-terminals/*.json`. `apiKey` is the panel API key (`ap_live_...`). Anyone with read access to the user's home dir can exfiltrate it. The file also survives uninstall of the app.

Fix sketch: don't persist the API key. Re-read it from config when replay runs. Also reduce file permissions to 0600.

### 16. `sse-cursor` file loses ordering when the panel resets event ids

- File: `server-app/src/reporting/sse-client.ts:119–138, 292–293`

If the panel regenerates its event sequence (migration, restore), the stored cursor is higher than any real event, and the server silently misses everything. There's no sanity check.

Fix sketch: on connect, have the panel advertise its current max-id in a comment or handshake event. If our cursor > panel's max, reset to 0 (and log a warning).

## P2 — opportunistic

### 17. `discoverAgents` is called on every scheduler tick and every trigger

- File: `server-app/src/server/server.ts:399, 508, 562, 594, 375`
- File: `server-app/src/agents/discovery.ts:21–48`

Parses every agent YAML/markdown file on every 60s tick. For 20+ agents this is ~20 file reads plus YAML parse per tick. Noisy on filesystem and slow on disk-encrypted Macs.

Fix sketch: cache the discovery result, invalidate on file-watcher events in the agents dir. The `sync-schedule` already watches the dir — reuse that.

### 18. `extractWatchConfigs` is called once in `setupFileWatchers` and never refreshed

- File: `server-app/src/server/server.ts:507–524`

When the user edits an agent's `watch` block, the change isn't picked up until daemon restart.

Fix sketch: re-run `setupFileWatchers` when agent files change.

### 19. Schedule uses `shouldRun` which only ticks on the minute boundary

- File: `server-app/src/agents/scheduler.ts:4–20`

`shouldRun` truncates seconds and checks `expr.includesDate(truncated)`. If the check-interval drifts (default 60s but Node timers are best-effort) past a minute boundary, the agent is never fired for that minute. The catch-up flag in `server.ts:402–416` mitigates sleep gaps, but not single missed ticks.

Fix sketch: track "last fired at" per agent. On each tick, compute `expr.prev()` since last-fired and fire if the prev is after last-fired.

### 20. `handleLine` mutates cursor and persists on every event (sync write)

- File: `server-app/src/reporting/sse-client.ts:292–293`

Every SSE event triggers a synchronous `writeFileSync(cursorPath, ...)`. For a busy stream this is a lot of disk IO on the main thread.

Fix sketch: debounce cursor persist to 1s, or persist on a timer.

### 21. Telegram conversation store has no persistence

- File: `server-app/src/server/server.ts:149–150, 650–668`

In-memory only. Daemon restart drops all conversations. Users resuming mid-conversation will hit "Conversation expired (agent not found)" or worse, trigger the default route.

Fix sketch: persist to disk alongside runs.

### 22. `parseTimeout` silently falls back to 30 minutes on malformed input

- File: `server-app/src/server/server.ts:43–50`

A typo like `timeout: "5 minutes"` silently returns `DEFAULT_TIMEOUT_MS`. User has no signal this was wrong.

Fix sketch: throw at agent-load time (zod validation) and refuse to start an agent with an unparseable timeout.

### 23. `buildMcpServers` leaks empty strings on missing env vars

- File: `server-app/src/agents/config.ts:55–64` (used by `plugins/claude-code.ts:564`)

`resolveEnvVars` replaces `${FOO}` with `source[FOO] ?? ''`. If `FOO` is unset, the MCP server gets an empty token. The server hits the remote with empty auth and fails opaquely.

Fix sketch: throw (or return a structured error) when a referenced var is missing, so the user sees `MCP server "linear": missing env var LINEAR_API_KEY` instead of 401-loop.

### 24. `interaction/store` and `conversation/store` expiry loop runs every 60s forever

- File: `server-app/src/server/server.ts:650–668`

Fine, but the setInterval handle isn't `unref`'d, keeping the event loop alive if you ever try to cleanly exit without calling `stop()`.

### 25. `sanitizeText` regex for `Bearer \S+` is greedy and may redact unrelated tokens

- File: `server-app/src/server/security-utils.ts:11`

`/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{10,}\b/gi` — the `.` and `/` in the character class will redact URL paths that happen to follow the literal word "Bearer" in any context. Edge case, but worth tightening.

## Architectural concerns

**`startDaemon` is dead code duplicating `startServer`.** Two parallel run-creation code paths is the root cause of P0 #2 and P1 #8. The split between `daemon.ts` (scheduler, panel sync, SSE trigger) and `server.ts` (local HTTP API, scheduler, file watchers, telegram) means maintenance updates miss one side. There should be one entry that composes: local API, scheduler, file watcher, SSE/trigger handler, schedule sync, telegram, stale replay.

**Reporter lifecycle is spread across three files.** `TelemetryReporter` (reporter.ts), wrapper in `server.ts:266–289`, and the runner's own reporter abstraction (runner.ts:16–23). It's hard to trace which `complete`/`cancel`/`fail` actually posts to the panel. Consider collapsing the wrapper layer — or at least document the chain.

**No integration test exercises the full run lifecycle with a simulated flaky panel.** The symptom the user is seeing (terminal event doesn't arrive under packet loss) is exactly what an integration test with a deterministic 503-then-200 panel would have caught.

**Persisted state is scattered.** `~/.agent-server/` has: `.env`, `agents/`, `locks/`, `logs/`, `pending-terminals/`, `sse-cursor`, `runs/` (conversation jsonl), `telegram.json`. Every addition grows the surface. Consider a single `state/` subdirectory with a versioned manifest so upgrades can migrate cleanly.

## Observability gaps

1. **No log file.** `launchd` redirects only when started via `launchctl`. The macOS app launches the daemon as a child, so console output goes nowhere. Fix: application-level log sink with rotation (see P1 #7).
2. **No structured logs.** All `console.log` calls are freeform strings. Hard to parse. Hard to ship to anywhere. At minimum adopt a `{ ts, level, component, runId, message }` shape.
3. **No metrics.** How many runs succeeded / failed / stalled? What's the P95 terminal POST latency? How many pending terminals are queued? All invisible.
4. **No run-level trace.** A given runId could be searched across logs, but without structured fields you're grepping.
5. **No health endpoint on the panel side observable from the daemon.** `PanelClient.markStaleRuns()` swallows errors. If the panel is unreachable for an hour, the daemon has no surfaced signal until a human notices.

Minimum viable fix: add a file log with rotation + daily count lines for runs-started / runs-completed / terminals-persisted / terminals-replayed. That alone would have answered "is the daemon even alive?" when the user sees a stuck run.

## What the server is actually doing (overview)

The CLI enters `agent-server start`, which ensures `~/.agent-server/` exists and boots `startServer(config)`. `startServer`:

1. Binds a Hono HTTP API on `127.0.0.1:47821` for the macOS app (list agents, trigger runs, cancel runs, view runs). Bearer key required when not loopback.
2. Opens a WebSocket at `/ws` that broadcasts progress events to connected UIs.
3. Starts an in-memory `RunStore` (capped at 200 runs) plus conversation and interaction stores.
4. Immediately fires `runDueAgents()` once, then on a 60s interval. `runDueAgents` reads all agent YAML/markdown files, filters by cron match (`shouldRun`), and calls `triggerRunForAgent` for each due agent. If catch-up is enabled and a sleep gap is detected, it also fires missed schedules since the last tick.
5. `triggerRunForAgent` generates a runId, creates an `AbortController`, records the run in `RunStore`, and calls `runAgent` with a wrapped reporter. The wrapper tees progress into the `RunStore`, broadcasts over WebSocket, and sends the same events to the panel via `TelemetryReporter`.
6. `runAgent` (runner.ts) acquires a per-agent lockfile by pid. If already locked, it emits a `canceled` event with code `lock_contention` and returns. Otherwise it calls the executor (always `executeAgent` for `claude-code`), which drives the Claude Agent SDK's `query()` generator. Assistant messages emit progress. Tool-use blocks are paired with tool-result blocks for per-call duration. A `result` message produces the final `ExecutionResult` with summary, tools used, token counts, cost.
7. `TelemetryReporter` POSTs `state: 'working'` to `{panelUrl}/api/runs/{runId}/status` on start, heartbeats every 30s, and posts terminal events on completion/failure/cancel. Terminal events retry 3 times inline then up to 5 times deferred, then persist to `~/.agent-server/pending-terminals/` for later replay. Replay is supposed to run on daemon restart but doesn't (P0 #1).
8. File watchers and Telegram bot set up asynchronously. The Telegram bot routes free-text messages to agents via an LLM-based router (`routeMessage`) using the Anthropic SDK directly.
9. The panel also pokes the daemon for orphan cleanup (`failOrphanedRuns`) at startup and pings the panel's stale-runs cron every 5 minutes.

What the daemon is NOT doing (despite having the code for it): subscribing to the panel's SSE event stream for panel-initiated triggers and decision resolutions, syncing the agent catalog to the panel, replaying pending terminals on startup. All three live in the unused `startDaemon` function.

**Net effect for the reported symptom.** A run completes successfully. Its terminal POST hits network trouble. Retries exhaust in ~80s. The event is persisted to disk. The panel's view: last heartbeat was 90+ seconds ago, mark as `failed` via stale-sweep. The user sees "Agent Panel shows it running" because the stale-sweep runs on a 5-minute cadence from the daemon, plus whatever cadence the panel has independently. During that window the state is "working" with no further updates. Even after the sweep fires, the authoritative `completed` event is on disk and will never replay. The run displays as `failed` with "no heartbeat" instead of the real completion summary.
