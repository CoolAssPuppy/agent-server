# Agent Server

Lightweight orchestration server that runs AI agents in the background using Claude Code, Codex, or Kimi Code. Agents are defined as YAML or Markdown files with cron schedules. The server discovers agents, evaluates schedules, acquires locks, runs the selected executor, streams events, and reports telemetry in A2A format.

## Repository structure

```
server-app/          -- Node.js server, CLI, and agent runtime
macos-app/           -- Native macOS menu bar app
specs/               -- Documentation and App Store metadata
```

## Architecture

Server code lives in `server-app/`. All `src/`, `dist/`, `package.json`, `tsconfig.json`, `vitest.config.ts`, and `sample-agents/` are under `server-app/`.

```
server-app/src/
  agents/
    config.ts            -- Zod schema + YAML/frontmatter parser for agent definitions
    discovery.ts         -- Reads agent files (.yaml, .yml, .md) from agents directory
    capabilities.ts      -- Consumer capability catalog + derivation + toggle translation
    writer.ts            -- Lossless structured writes to agent files (create/update/delete)
    scheduler.ts         -- Cron expression evaluation (cron-parser v5)
    triggers.ts          -- Agent chaining (on_complete, on_failure)
    file-watcher.ts      -- File watch triggers with debounce and glob
  channels/
    channel.ts           -- Channel interface + ChannelReply type
    console.ts           -- Console channel (readline, numbered options)
    telegram.ts          -- Telegram channel (grammY, long-polling, inline keyboards)
    router.ts            -- LLM-powered message routing (picks agent from user message)
    dispatcher.ts        -- Maps channel names to Channel instances
  documents/
    extractor.ts         -- DocumentExtractor contract + typed DocumentError
    zip.ts               -- Reads one named entry out of a ZIP container
    docx-extractor.ts    -- .docx extractor (in-process, no subprocess, no dependency)
    registry.ts          -- Resolves an extractor by extension, hashes the source, isolates throws
    document-tool.ts     -- MCP read_document tool exposed to agents
    tool-name.ts         -- Server and tool name, kept where permissions.ts can import it
  execution/
    default-executors.ts -- Registers the built-in Claude Code, Codex, and Kimi Code executors
    executor.ts          -- Stream event parsing, tool metadata extraction, types
    executor-registry.ts -- Plugin registry for model-agnostic execution
    runtime-discovery.ts -- Discovers installed coding-agent executables once at startup
    permissions.ts       -- Glob-based tool permission matching (canUseTool)
    runner.ts            -- Orchestrates lock -> report -> execute -> release
    lockfile.ts          -- PID-based file locks with stale detection
  conversation/
    schema.ts            -- Conversation schemas (message, config, conversation type)
    store.ts             -- In-memory conversation store with TTL and FIFO eviction
    history-formatter.ts -- Formats conversation history into prompt context
  interaction/
    parser.ts            -- Parses ```interaction blocks from agent output
    schema.ts            -- InteractionRequest, InteractionConfig, NotificationConfig schemas
    notification.ts      -- Notification message formatting
    store.ts             -- In-memory pending interaction store with expiry
  logging/
    record.ts            -- LogRecord shape, stamping, JSONL serialization
    destination.ts       -- LogDestination / ReadableLogDestination driver contracts
    logger.ts            -- AgentLogger: stamps once, fans out, isolates each driver
    log-store.ts         -- Local JSONL driver (one file per agent per day); reads come from here
    panel-log-destination.ts -- Agent Panel driver: queues, batches by run, retries
    log-filter.ts        -- Strips escape and control characters before an entry is kept
    log-tool.ts          -- MCP write_log tool exposed to agents
    log-read-tool.ts     -- MCP read_log tool exposed to agents
  reporting/
    reporter.ts          -- A2A telemetry reporter with heartbeat and worker_id
    reporter-factory.ts  -- Creates noop or telemetry reporter based on config
    panel-client.ts      -- HTTP client for panel cleanup/stale-runs endpoints
    store.ts             -- In-memory run state store with eviction
  server/
    api.ts               -- Hono HTTP API routes
    server.ts            -- Combined HTTP server + agent scheduler + Telegram + WebSocket
    websocket.ts         -- ProgressBroadcaster for real-time WebSocket events
    daemon.ts            -- Timer loop, single-run, list commands
  platform/
    config.ts            -- ServerConfig from AGENT_SERVER_* env vars
    launchd.ts           -- macOS LaunchAgent plist generation
    init.ts              -- Scaffolds ~/.agent-server/ with sample agent
  plugins/
    claude-code.ts       -- Claude Code executor (Agent SDK query()). Exports buildMcpServers() which auto-injects the eventkit MCP server when AGENT_SERVER_EVENTKIT_BIN is set.
    codex.ts             -- Codex executor (official Codex SDK)
    kimi-code.ts         -- Installed Kimi Code executor (ACP)
    kimi-code-events.ts  -- ACP event, permission, and telemetry mapping
    kimi-code-file-policy.ts -- Exact reviewed file access for ACP callbacks
  cli.ts                 -- Commander CLI: start, run, list, init, install, uninstall
  index.ts               -- Barrel exports for library use
  test-factories.ts      -- Shared test data factories

sample-agents/           -- Example agent YAML configs
```

## Tech stack

- TypeScript strict mode, ES2022, ESM
- @anthropic-ai/claude-agent-sdk for running Claude Code programmatically
- @openai/codex-sdk for running Codex programmatically
- @agentclientprotocol/sdk for structured Kimi Code sessions
- Zod for schema validation
- cron-parser v5 (`CronExpressionParser.parse()`, NOT `parseExpression()`)
- Hono for HTTP API
- @hono/node-ws for WebSocket streaming
- Commander for CLI
- grammY for Telegram bot (long-polling, inline keyboards)
- @slack/socket-mode + @slack/web-api for the Slack bot (Socket Mode, Block Kit)
- yaml for YAML parsing
- vitest for testing

## Key patterns

### Executor plugin registry

Agents can specify which executor to use via the optional `executor` field in their YAML config. The `ExecutorRegistry` maps executor names to functions. Claude Code is the default executor. To add a new executor:

```typescript
import { ExecutorRegistry, type ExecutorFn } from './execution/executor-registry.js';

const codexExecutor: ExecutorFn = async (agent, reporter) => {
  // Your implementation here
};

registry.register('codex', codexExecutor);
```

Agents select their executor:
```yaml
executor: codex  # defaults to 'claude-code' if omitted
```

### Reporter interface

The `Reporter` type in `execution/runner.ts` is the interface all reporters implement. The `TelemetryReporter` class implements it for real HTTP reporting. The daemon creates a noop reporter when no panel URL is configured. Never cast to `TelemetryReporter` in daemon or runner code.

The reporter includes `worker_id` (hostname-pid) in metadata on every event, allowing the panel to track which server instance owns each run.

### Local run persistence (SQLite)

Run history is durable, backed by SQLite via Node's built-in `node:sqlite` (no native dependency to compile or code-sign into the macOS app bundle). `SqliteRunStore` (`reporting/sqlite-store.ts`) is a drop-in for the in-memory `RunStore` behind the shared `RunStoreLike` interface; both normalize through `reporting/run-normalization.ts`. The database lives at `~/.agent-server/runs.db` (`AGENT_SERVER_RUN_DB`; `:memory:` for ephemeral). `startServer` builds it with a graceful fallback to in-memory history if the file is unusable, and closes it on shutdown. Because history now survives restarts, `failOrphanedLocalRuns()` (`reporting/local-reconcile.ts`) runs at boot to fail any run left `running` by a killed previous instance — local ghost-run cleanup that needs no panel.

### Agent logging

Agents leave a record behind by calling the `write_log` MCP tool and read their own history back with `read_log`. Callers pass a message, never a path or a provider, so an agent needs no file access to log and cannot write anywhere else by asking.

**Drivers.** `logging/destination.ts` defines `LogDestination` (`name` plus `write(record)`, and an optional `shutdown()` for drivers that queue). `ReadableLogDestination` adds `readRun` and `readAgent`. To add a driver, implement the interface and append it to the array `AgentLogger` receives in `createAgentLogger()`. No call site changes, because no call site knows a driver exists. Two drivers ship today:

| Driver | `name` | Role |
|---|---|---|
| `AgentLogStore` (`log-store.ts`) | `local_jsonl` | One JSONL file per agent per day under `~/.agent-server/logs/agents/`, 30-day retention. Reads come back from this one. |
| `PanelLogDestination` (`panel-log-destination.ts`) | `agent_panel` | Ships entries to Agent Panel over HTTP. Write-only. |

**Fan-out.** `AgentLogger.append()` stamps the record once (timestamp, machine id, hostname, source) so every driver gets the identical record, checks it against a 1 MB ceiling, then writes to the readable driver first and the rest after. Each driver is isolated: one that throws or rejects is warned about and never stops the others. Only a failure of the readable driver reaches the caller, because a caller told the entry was written expects to read it back. `append` is synchronous, so a promise-returning driver owns its own queue.

**Reads have one authority.** Merging N drivers would return entries that differ by delivery lag and duplicate each other, so exactly one driver is designated readable and `read_log` never asks another.

#### Agent Panel log driver

`POST {panelUrl}/api/runs/{runId}/logs` with the machine credential as a bearer token and `{ protocol_version: 2, machine_id, entries[] }` as the body. Enabled only when a panel URL, a credential, and a paired machine id are all present. An organization key names no machine and Panel takes the row's machine from the credential, so an unpaired server keeps its logs local rather than filing them against another Mac.

- **Queue.** `write()` only appends to a bounded in-memory queue (2,000 entries) and returns. A panel that is down or slow can never delay or fail a run. Delivery runs on an unref'd 5-second timer, and `shutdown()` flushes what is left; `startServer` calls it during the stop sequence, after the run drain.
- **Backpressure.** When the queue is full the oldest entries go first. Panel is a live view of a run, so the newest lines are the ones somebody is waiting on, and every dropped line is still on disk in the local driver, which is where reads come from. Drops are counted and reported once per flush rather than per entry.
- **Grouping.** One request carries one run's entries, so the queue is bucketed by `run_id` at flush time. Batches are capped at 200 entries and about 255 KB, whichever comes first; the remainder waits for the next flush.
- **Caps.** Message truncated to 10,000 characters, metadata to 8 KB serialized. `machine_id`, `run_id`, `hostname` and `agent_id` are not columns: the row's machine comes from the credential and the run from the URL, so only `agent_id`, `hostname`, any caller-supplied fields, and a truncated `body` go into `metadata`.
- **Retry.** Panel has no idempotency key, so a retried batch inserts duplicates. Only failures that say nothing was written are retried: 429 (honouring `Retry-After`), 5xx, network errors, and the 404 that means the run's status event has not landed yet. Backoff is exponential from 5 seconds, capped at 5 minutes, and after 6 attempts the batch is dropped with a warning. 400, 403 and 413 are dropped immediately because resending cannot fix them. A 401 stops the driver for the life of the process, since the credential cannot change without a restart.
- **Checkpointing.** A batch leaves the queue only once Panel accepts it or refuses it in a way retrying cannot fix. A retryable failure puts it back at the head of the queue, so a run's entries keep the order they were written in.

### Reading documents the Read tool cannot open

Agents call the `read_document` MCP tool (`mcp__agent_documents__read_document`) for formats the SDK's `Read` tool cannot open, starting with `.docx`. The server does the conversion and the hashing, so an agent that reviews a Word file needs no shell and no scratch file of its own.

**Extractors.** `documents/extractor.ts` defines `DocumentExtractor`: a `name`, the lowercase `extensions` it claims, and `extract({ path, bytes })` returning text plus whatever metadata the format gives up cheaply. To add a format, write the extractor and append it to the array in `builtInExtractors()` in `documents/registry.ts`. That is the only edit. The tool schema does not change, the permission layer does not change, and no call site changes, because none of them knows which formats exist.

**Registry.** `DocumentExtractorRegistry.read(path)` resolves the extension to an extractor, stats the file, refuses anything over 64 MB, reads the bytes once, and returns text, a `sha256` of those same bytes, size, and mtime. One read covers both the hash and the parse, so the hash always describes the text returned beside it. Failures are typed (`unsupported_type`, `not_found`, `too_large`, `unreadable`), and an extractor that throws is caught and reported as `unreadable` naming the extractor. An unsupported extension names what is supported.

**The .docx extractor** parses in process. A `.docx` is a ZIP holding `word/document.xml`, which `node:zlib` opens, so it runs the same on every platform, adds no dependency and no subprocess. Shelling out to `textutil` would have been shorter and macOS only. It reads `w:t`, `w:tab`, `w:br` and paragraph ends in document order rather than stripping tags, which is what keeps tracked deletions (`w:delText`) and field instructions (`w:instrText`) out of the result. `zip.ts` caps what it will inflate, so an archive that claims to expand to gigabytes is refused.

**Paging.** One call returns at most 50,000 characters (20,000 by default) and ends on a paragraph boundary. The reply carries `characters`, `offset`, `next_offset`, and `has_more`; pass `next_offset` back to continue. `metadataOnly: true` returns the hash and length with no text, which is how a scheduled agent checks whether a document changed since its last run.

**Permission.** This tool takes a path, so it is gated in both directions and is **not** auto-permitted the way `write_log` is.

1. It is listed in `READ_FILE_TOOLS` in `execution/permissions.ts`. A path-taking tool in neither `READ_FILE_TOOLS` nor `WRITE_FILE_TOOLS` is treated as taking no path and is never checked against `file_access` at all, which is unbounded read. Any future path-taking tool goes in one of those two sets.
2. It needs an explicit `permissions.allow` (or `tools`) entry like any other tool.
3. The tool checks the grants again itself, through `createFileAccessCheck()`, rather than trusting that it was reached through the permission callback. Both gates canonicalize, so `..` and symlinks cannot climb out of a grant.

The server injects the tool into every ordinary Claude Code run from `plugins/claude-code.ts`, next to the log server. A safe test composes a run with no MCP effects, so it does not get this one either.

### Runtime discovery and custom model providers

Runs use the user's installed Claude Code, Codex, or Kimi Code executable and login. `execution/runtime-discovery.ts` resolves all three once at startup. Claude checks `AGENT_SERVER_CLAUDE_PATH`, then `~/.local/bin/claude` and `~/.claude/local/claude`, then `PATH`. Codex checks `AGENT_SERVER_CODEX_PATH`, then user-local Node installs (`~/.local/bin`, `~/.volta/bin`, and each `~/.nvm` version, newest first), then `PATH`; every Codex candidate must also start and report a version, so a stale wrapper cannot hide a working install. Kimi checks `AGENT_SERVER_USE_INSTALLED_KIMI`, `AGENT_SERVER_KIMI_PATH`, `~/.kimi-code/bin/kimi`, then `PATH`.

None of the three has a bundled fallback. When a runtime is missing, its executor throws an actionable error (`plugins/claude-code.ts:63`, `plugins/codex.ts:59`) rather than running on something the user did not choose. `AGENT_SERVER_USE_INSTALLED_KIMI` is the only opt-out, and it exists because Kimi Code alone is opt-in. The Claude and Codex equivalents were removed with the bundled runtimes; `runtime-discovery.test.ts` asserts that setting them changes nothing.

Agents can point Claude Code or Codex at a custom model provider through the `provider` block (`base_url` plus optional `api_key`). Codex maps it to `CodexOptions.baseUrl` and `apiKey`, so Moonshot's Kimi K3 works through the Codex executor. Claude Code maps it to per-session Anthropic environment values. `cli.ts` strips `ANTHROPIC_API_KEY` at startup. The `api_key` field holds a `${VAR}` reference resolved at run time and never a literal secret. Installed Kimi Code uses its own login and ACP model selection, so it rejects a `provider` block.

**Codex safety mapping.** Codex ignores the Claude tool allowlist (`tools`/`disallowed_tools`/`canUseTool`), so `execution/codex-safety.ts` translates an agent's capability and permission model into Codex's safety knobs. `deriveCodexSandbox()` maps write and command permission onto `sandboxMode`. `deriveCodexNetworkAccess()` maps an explicit web-tool grant onto network access, which is off by default. This mapping applies to Codex agents, including API-backed Kimi K3 agents. It does not apply to installed Kimi Code.

### Kimi Code ACP executor

`executor: kimi-code` starts the discovered `kimi acp` executable and uses Agent Client Protocol for initialization, session creation, prompts, events, permission requests, filesystem callbacks, model selection, MCP forwarding, and cancellation. Deny rules win over allow rules. File callbacks normalize and canonicalize paths, resolve symlinks, enforce each `file_access` grant, and cap text reads and writes at 2 MB. Exact file grants cannot be combined with Bash because a shell could bypass the callbacks.

The Kimi child receives a small environment containing runtime variables and `KIMI_CODE_HOME`; application, provider, MCP, and proxy secrets are not inherited. Reviewed MCP configuration is forwarded explicitly through ACP. `KIMI_DISABLE_CRON=1` keeps Agent Server in control of schedules. Missing or signed-out installations fail with an actionable error and never fall through to another executor.

### Panel client and ghost run cleanup

`PanelClient` in `reporting/panel-client.ts` cleans up orphaned ("ghost") runs in the panel:

- `failOrphanedRuns(serverId?)` -- calls `POST {panelUrl}/api/runs/cleanup` to mark all `working` runs for a given worker as failed

Use `createPanelClient(config)` to get a `PanelClient` or `null` (when panel is not configured).

**Defense in depth**: Ghost runs are handled by three layers:
1. **Startup reconciliation**: Server calls `failOrphanedRuns(serverId)` on boot
2. **pg_cron**: Supabase `mark_stale_runs()` runs every 30s (authoritative in prod)
3. **Manual**: `agent-server cleanup` CLI or macOS app "Clean up" action

> The daemon used to also POST `/api/cron/stale-runs` every 5 minutes as an
> extra sweep, but that endpoint authenticates with a separate `CRON_SECRET`,
> not the panel API key the daemon holds, so it never authenticated. pg_cron
> covers this in production, so the redundant poke was removed.

The local server exposes `POST /cleanup` for the macOS app to trigger cleanup without needing panel credentials directly.

### cron-parser v5 API

```typescript
import { CronExpressionParser } from 'cron-parser';
const expr = CronExpressionParser.parse('*/5 * * * *', { tz: 'America/New_York' });
expr.includesDate(date);   // boolean
expr.next().toDate();      // Date
```

The old `parseExpression()` function does not exist in v5.

### Claude Agent SDK

The executor in `plugins/claude-code.ts` uses `query()` from `@anthropic-ai/claude-agent-sdk`. It passes the agent's prompt and an `Options` object with `maxTurns`, `cwd`, `permissionMode: 'bypassPermissions'`, and optionally `allowedTools`. The SDK returns a `Query` object (extends `AsyncGenerator<SDKMessage>` with control methods). Key message types: `assistant` (has `message.content` blocks with text/tool_use), `result` (subtype `success` or error variants, has `num_turns`, `result` text).

**MCP server status handling**: Before iterating the stream, the executor calls `stream.mcpServerStatus()` to check all MCP server connections. It logs statuses with `[mcp]` prefix (connected, failed, needs-auth, pending, disabled). Failed servers get automatic reconnection via `stream.reconnectMcpServer(name)` with up to 2 retry attempts (3s delay between). Status is reported via `reporter.progress()` and included in `ExecutionResult.mcpServers`.

The legacy `parseStreamEvent()` and `extractToolMetadata()` functions in `execution/executor.ts` still exist for CLI stream parsing compatibility but are not used by the SDK executor.

### MCP servers

Agents can bring their own MCP servers via the `mcp_servers` field. These are passed to the Agent SDK's `Options.mcpServers` and run alongside any account-level MCP servers (from claude.ai). Three transport types are supported: stdio, sse, and http.

Environment variables in `env` and `headers` fields support `${VAR}` substitution, resolved from `process.env` at runtime (which includes `~/.agent-server/.env` values loaded at startup).

```yaml
mcp_servers:
  notion-personal:
    command: npx
    args: ["-y", "@notionhq/notion-mcp-server"]
    env:
      NOTION_TOKEN: "${NOTION_PERSONAL_API_KEY}"
  remote-service:
    type: sse
    url: https://example.com/mcp
    headers:
      Authorization: "Bearer ${SERVICE_TOKEN}"
```

The `resolveEnvVars()` function in `agents/config.ts` handles the substitution. Undefined variables resolve to empty string.

### EventKit MCP auto-injection

When the server is launched by the macOS app, `ServerProcessManager` exports `AGENT_SERVER_EVENTKIT_BIN` pointing at the bundled Swift helper (`Agent Server.app/Contents/Helpers/agent-server-eventkit`). In `plugins/claude-code.ts`, `buildMcpServers()` checks for this env var at spawn time and injects a stdio MCP server entry named `eventkit` into every agent's MCP server map. Precedence:

- If an agent explicitly declares `eventkit` under `mcp_servers` in its YAML, the agent config wins.
- If the env var is unset (running from the CLI without the macOS app), no injection happens.

Agents automatically get access to tools like `mcp__eventkit__list_events`, `mcp__eventkit__create_event`, `mcp__eventkit__list_reminders`, etc. without any YAML configuration. Full tool list: `list_calendars`, `list_events`, `create_event`, `update_event`, `delete_event`, `list_reminder_lists`, `list_reminders`, `create_reminder`, `complete_reminder`.

Tests covering the injection behavior live in `plugins/claude-code.test.ts` under the `buildMcpServers eventkit auto-injection` describe block.

### File locking

PID-based locks in the locks directory. Stale lock detection via `process.kill(pid, 0)`. Always release in a `finally` block.

### Agent chaining

Agents can define `on_complete` and `on_failure` arrays referencing other agent IDs. Use `evaluateTriggers()` to find downstream agents after a run completes. The server automatically fires triggers after run completion or failure via `fireDownstreamTriggers()` in `server.ts`.

### File watch triggers

Agents can declare `watch` paths in their YAML config. The `FileWatcher` class monitors these paths with `fs.watch`, applies glob filtering for directories, and debounces rapid changes. The `expandHome()` utility (in `agents/file-watcher.ts`) handles `~` expansion and is shared with `plugins/claude-code.ts`.

### Conversational agents

Agents can maintain conversation history across multiple runs by enabling the `conversation` config:

```yaml
conversation:
  enabled: true
  ttl: 1h    # how long the conversation stays active (default: 30m)
```

**How it works:**

1. User sends a message via Telegram. The server checks `ConversationStore.findActiveByChat(chatId)` before routing.
2. If an active conversation exists for this chat, the message goes directly to that agent (skips the Haiku router).
3. If no active conversation, the router picks an agent. If that agent has `conversation.enabled: true`, a new conversation is created.
4. The user's message is stored in the conversation. `formatConversationHistory()` formats all prior messages into a `<conversation_history>` XML block appended as prompt context.
5. After the run completes, the assistant's summary is added to the conversation.
6. The `conversationId` flows through the reporter metadata to the panel, where it's stored on `task_runs.conversation_id`.

**ConversationStore** (in `conversation/store.ts`): In-memory Map storage, max 100 conversations with FIFO eviction, max 50 messages per conversation, 4000-char content truncation. Stale conversations are expired in the 60-second sweep alongside interaction expiry.

**History formatter** (in `conversation/history-formatter.ts`): Wraps messages in `<conversation_history>`, labels with `[User]`/`[Assistant]`, summarizes assistant messages over 2000 chars, caps total output at 20,000 chars (trims oldest messages first).

**conversationId flow**: Server generates UUID -> `ReporterConfig.conversationId` -> metadata `conversation_id` on every telemetry event -> panel API extracts and stores on `task_runs` -> UI groups runs by conversation_id.

**Panel UI**: Web shows `ConversationThread` component on run detail pages. iOS shows `ConversationThreadView` (native SwiftUI). macOS app shows a conversation bubble icon in the runs list.

### Interactive agents

Agents can request user input by outputting a fenced `interaction` block in their response. The executor parses this and routes it through the channel system.

**Interaction request format** (output by the agent):
````
```interaction
{
  "message": "Found 3 slots at Bougainville",
  "options": [
    { "label": "19:00", "value": "Book 19:00" },
    { "label": "20:30", "value": "Book 20:30" }
  ],
  "freeText": false
}
```
````

**Agent config for interactions:**
```yaml
interaction:
  channel: telegram    # or "console" for CLI mode
  on_reply: booker     # agent ID to trigger with the user's reply
  timeout: 1h          # how long to wait for a reply (default: 30m)
```

The user's reply becomes the `--with` prompt suffix for the `on_reply` agent. This chains two stateless runs with a human decision in between.

### Tool permissions

When an agent defines a `permissions` block, `buildCanUseTool()` in `execution/permissions.ts` creates a `canUseTool` callback passed to the SDK. The callback uses `isToolAllowed()` which checks deny patterns first (deny wins), then allow patterns. Only explicitly allowed tools pass. Pattern matching uses `matchesPattern()` which converts `*` to `.*` regex. When `permissions` is not defined, no callback is set and the SDK's default permission mode applies.

### Channel adapter pattern

Channels implement the `Channel` interface from `channels/channel.ts`. Each channel handles sending interaction requests and receiving replies for its platform. The interface includes an optional `expireInteraction(id)` method for cleaning up expired messages.

- **Console**: Numbered options + readline. Used in `agent-server run` CLI mode.
- **Telegram**: Inline keyboards via grammY long-polling. No public IP needed. Set `AGENT_SERVER_TELEGRAM_BOT_TOKEN` to enable. Expired interactions are cleaned up by editing the Telegram message to show "This request has expired." and removing the inline keyboard.
- **Slack** (`channels/slack.ts`): Block Kit buttons over Socket Mode (`@slack/socket-mode` for receiving, `@slack/web-api` for sending) — no public IP needed, mirroring Telegram's long-polling model. Needs TWO tokens: a bot token (`xoxb-…`, Web API) and an app-level token (`xapp-…`, Socket Mode). Read from `AGENT_SERVER_SLACK_BOT_TOKEN`/`AGENT_SERVER_SLACK_APP_TOKEN` OR the bare `SLACK_BOT_TOKEN`/`SLACK_APP_TOKEN` (Slack's own naming). The DM channel is learned from the first inbound message and persisted to `slack.json`. Expired interactions edit the message to "This request has expired." and drop the buttons. This is the "chat with a Slack bot" messaging channel — distinct from the Slack MCP *data* capability an agent reads.
- **Dispatcher**: `ChannelDispatcher` maps channel names to instances. Calls `expireInteractions()` to clean up expired interactions across channels.

Telegram and Slack share the same inbound-message flow (`handleChannelMessage` in `server.ts`): conversation lookup → `routeMessage` → run trigger → completion notice. Only the transport differs. The conversation store keys by number, so Slack's string channel id is hashed via `chatKeyFromString()`.

### Telegram message routing

Users can send any natural language message to the Telegram bot. The `routeMessage()` function in `channels/router.ts` sends the message + agent list to Claude Haiku, which picks the best-matching agent. The server then triggers a run with the user's message as context. Completion/failure notifications are sent back via the existing notification formatters.

The `TelegramChannel` has `onMessage(callback)` for arbitrary text messages. When there's a pending interaction, text messages are routed to the interaction handler instead.

### Capability queries

When a user sends a meta-question like "what can you do?" or "list agents", the router returns a `list` result type instead of routing to an agent. The `RouteResult` discriminated union has three variants: `route` (matched agent), `list` (capability query), and `none` (no match). The server responds with `formatAgentListMessage()` from `interaction/notification.ts`.

### Telegram setup

1. Create a bot via @BotFather, get a token
2. Add `AGENT_SERVER_TELEGRAM_BOT_TOKEN=<token>` to `~/.agent-server/.env`
3. Start the server. The bot connects via long-polling.
4. Message the bot `/start` to register your chat ID (stored in `~/.agent-server/telegram.json`)
5. Send any message to trigger an agent, or agents with `interaction.channel: telegram` / `notification.channel: telegram` will send messages to you

Callback data uses `index:interactionId` encoding to stay within Telegram's 64-byte limit. Parse with `parseCallbackData()`, encode with `encodeCallbackData()`.

### Interaction store

`InteractionStore` tracks pending interactions with expiry. The server runs a 60-second sweep to expire stale interactions. States: `pending` -> `acted` or `expired`.

### HTTP API

Hono app created via `createApi()` with dependency injection. The `startServer()` function combines HTTP + scheduler + Telegram + Slack + WebSocket in one process.

`api.ts` registers about forty routes, so read the file rather than a list here, which will be stale before it is useful. They fall into these groups:

| Group | Routes |
|---|---|
| Health and identity | `/health`, `/machine`, `/pair` (GET, POST), `/ws` |
| Agents | `/agents` (GET, POST), `/agents/:id` (GET, PUT, DELETE), `/agents/:id/run`, `/agents/:id/safe-test`, `/agents/:id/runtime` (GET, PUT), `/agents/:id/runtime-compatibility`, `/agents/:id/bindings` (GET, PUT) |
| Runs | `/runs`, `/runs/:id` (GET, DELETE), `/runs/:id/cancel`, `/runs/:id/review`, `/metrics`, `/cleanup` |
| Connections and services | `/capabilities`, `/services`, `/connections`, `/connections/refresh`, `/connection-profiles` (GET, POST), `/connection-profiles/:id` (DELETE), `/connection-profiles/:id/duplicate`, `/connection-profiles/:id/operations` (GET, PUT), `/connection-profiles/:id/check` |
| People in the loop | `/interactions/:id` (GET), `/interactions/:id/reply`, `/decisions` |
| Presentation for the macOS app | `/presentation/today-activity`, `/presentation/assistants/:id` |
| Channels | `/channels`, `/channels/slack/pairing` (GET, PUT), `/channels/slack/pairing/test` |

Only `GET`/`HEAD /health` is public (`api.ts:446`). Every other route requires `AGENT_SERVER_API_KEY`.

Agent GET responses are **enriched**: hard-coded secrets in `mcp_servers` env/headers are masked (`${VAR}` references pass through), and a derived `capabilities` array is attached so clients can render consumer toggles without knowing YAML semantics. Agent write routes accept bodies up to 256 KB (prompts); all other routes keep the 8 KB cap.

### Capability catalog

`agents/capabilities.ts` is the translation layer between agent YAML and the consumer UI. `CAPABILITY_CATALOG` maps human capabilities ("Read your files", "Notion", "TripMaster", "CalorieNerds", ...) onto tools/`mcp_servers` entries. Key functions:

- `deriveCapabilities(agent, env)` -- computes each capability's on/off state; unrecognized MCP servers and tools surface as generic custom entries (ids `mcp:<key>` / `tool:<name>`), never hidden.
- `applyCapabilityChanges(agent, changes, env)` -- turns toggles into field updates. Disabling never deletes config: tool capabilities are denied via `disallowed_tools`, MCP capabilities via the server-level `mcp__<name>` rule, so every toggle is reversible. Enabling a catalog MCP capability writes its server entry (secrets stay as `${VAR}` references; remote URLs resolve from env at enable time because the schema requires literal URLs) and adds allowlist coverage when `tools` is non-empty.
- Capabilities that need keys report `required_env`/`env_ready`; enabling without them fails with a `missing_env` error (HTTP 409 + `missing_env` array) so the UI can run its Connect flow.

A `permissions` block is deliberately out of scope for capability toggles — agents using it are edited via the raw editor.

### Agent writer

`agents/writer.ts` owns all file mutation for the API. Updates go through the `yaml` package's Document API (`parseDocument` + per-key set/delete), so comments, key order, and passthrough fields survive edits; for `.md` agents only the frontmatter is rewritten and the body is replaced only when the prompt itself changes. `POST /agents` renders a frontmatter+markdown file, building an explicit `tools` allowlist from enabled capabilities. `DELETE /agents/:id` soft-deletes by moving the file into `.deleted/` (invisible to discovery). Errors carry a typed code (`not_found`, `already_exists`, `invalid`, `missing_env`) that the API maps to status codes. The writer (and the API's capability checks) reads `~/.agent-server/.env` fresh per call, so keys saved by the app's Connect flow work without a server restart — though the running daemon only picks them up for agent runs after its next restart.

The `/health` endpoint returns `{ status, timestamp, started_at }` where `started_at` is the server boot time (ISO string). The macOS app uses `started_at` to detect server restarts and identify orphaned runs. The `/cleanup` endpoint calls the panel to fail orphaned runs owned by this server instance.

### Cancelling runs

`POST /runs/:id/cancel` aborts a running agent. The server stores an `AbortController` per run, passes it to the Claude Agent SDK via `Options.abortController`, and calls `.abort()` on cancel. The run status is set to `'failed'` with error `'Cancelled by user'`. Returns 409 if the run is not in `'running'` state.

### WebSocket streaming

Connect to `ws://localhost:47821/ws` for real-time run progress. Events are JSON with type `run_started`, `run_progress`, `run_completed`, or `run_failed`. The `ProgressBroadcaster` class in `server/websocket.ts` manages subscriptions. The macOS app uses `URLSessionWebSocketTask` to connect, falling back to HTTP polling if the connection fails.

### Run wall-clock timeout

Every run is bounded by a wall-clock timeout to guarantee that a wedged MCP tool call, unresponsive SDK stream, or other hang cannot hold the agent's lock indefinitely. The runner races the executor against a `setTimeout` in `execution/runner.ts` (`raceWithTimeout`). On expiry it aborts the executor and rejects the race so `runAgent` returns cleanly and the lock is released in the `finally` block. Kimi Code sends an ACP session cancellation before terminating the child process.

Precedence: per-agent `timeout` field (YAML) wins over the server default `AGENT_SERVER_RUN_TIMEOUT_MS` (30 min). Set either to `0` to disable. The runner marks timed-out runs as `failed` and emits `reporter.cancel(reason, 'run_timeout')` so the panel can distinguish timeout cancellations from user-initiated ones.

### Sleep/wake catch-up

When `AGENT_SERVER_CATCH_UP=true`, the server detects sleep gaps (when `now - lastCheckedAt > 2 * checkIntervalMs`) and triggers agents that missed their cron window during sleep. Uses `hasMissedRun()` from `scheduler.ts` to check if any cron occurrence fell between `lastCheckedAt` and `now`.

## Agent definition formats

Two formats are supported. Discovery picks up `.yaml`, `.yml`, and `.md` files.

### Pure YAML

All fields including the prompt live in one YAML file:

```yaml
id: my-agent
name: My Agent
description: What this agent does
schedule: "*/5 * * * *"       # optional, omit for on-demand agents
timezone: America/Los_Angeles
prompt: |
  Multi-line prompt for the agent...
tools:
  - Read
  - Write
  - Bash
disallowed_tools:        # optional, tools to explicitly deny
  - Bash
max_turns: 20
timeout: 30m                # optional wall-clock cap; falls back to AGENT_SERVER_RUN_TIMEOUT_MS (default 30m)
enabled: true
working_directory: "~/projects/my-project"
permission_mode: bypassPermissions  # optional: bypassPermissions | acceptEdits | dontAsk | default | plan
permissions:             # optional, glob-based tool permissions (allowlist model)
  allow:
    - Read
    - Write
    - "mcp__claude_ai_Linear__list_*"
  deny:
    - "mcp__*__create_*"
executor: codex          # claude-code, codex, or kimi-code; defaults to claude-code
model: kimi-k3           # optional per-agent model name
provider:                # optional for Claude Code or Codex; rejected by kimi-code
  base_url: https://api.moonshot.ai/v1   # literal URL (OpenAI- or Anthropic-compatible)
  api_key: "${MOONSHOT_API_KEY}"         # ${VAR} ref resolved from .env; never a literal secret
mcp_servers:             # optional, additional MCP servers for this agent
  my-server:
    command: npx
    args: ["-y", "some-mcp-server"]
    env:
      API_KEY: "${MY_API_KEY}"
watch:                   # optional file triggers
  - path: "~/output"
    glob: "*.md"
on_complete:             # optional agent chaining
  - agent: downstream-agent
on_failure:
  - agent: alert-agent
conversation:            # optional conversational memory
  enabled: true
  ttl: 1h               # default: 30m
interaction:             # optional interactive agent config
  channel: telegram
  on_reply: downstream-agent
  timeout: 1h
notification:            # optional completion/failure notifications
  channel: telegram
  on_complete: true      # default: true
  on_failure: true       # default: true
```

### Hybrid frontmatter + Markdown

YAML frontmatter for config, Markdown body becomes the prompt. Use `.md` extension. The body replaces any `prompt` field in the frontmatter.

```markdown
---
id: my-agent
name: My Agent
schedule: "*/5 * * * *"
tools:
  - Read
  - Write
  - Bash
---

# My agent prompt

Do the thing. Use full Markdown formatting here.

1. Step one
2. Step two
```

Use `parseAgentFile()` (not `parseAgentYaml()`) to handle both formats automatically.

## Commands

All server commands run from `server-app/`:

```bash
cd server-app
pnpm test              # Run all tests
pnpm run type-check    # TypeScript strict check
pnpm run build         # Compile to dist/
pnpm run dev           # Dev mode with tsx watch
```

## CLI

```bash
agent-server init            # Create ~/.agent-server/ with sample agent
agent-server start           # Start server with HTTP API on port 47821
agent-server run <agentId>   # Run one agent immediately
agent-server run <agentId> --with "context"  # Run with extra context appended to prompt
agent-server list            # List discovered agents
agent-server cleanup         # Mark orphaned panel runs as failed
agent-server install         # Install macOS LaunchAgent
agent-server uninstall       # Remove macOS LaunchAgent
```

## Environment variables

The CLI loads `~/.agent-server/.env` at startup. Shell env vars and Doppler (`doppler run -- agent-server start`) take precedence over the file.

`platform/environment-reference.ts` is the canonical list, and `pnpm run docs:environment` renders it into the README table. The table below is a hand-maintained summary of the same contract, so change the reference module first and let the README regenerate.

| Variable | Default | Description |
|---|---|---|
| AGENT_SERVER_HOME | ~/.agent-server | Base directory for the default agent, lock, log, database, and `.env` paths |
| AGENT_SERVER_AGENTS_DIR | ~/.agent-server/agents | Directory containing agent definition files |
| AGENT_SERVER_LOCK_DIR | ~/.agent-server/locks | Lock file directory |
| AGENT_SERVER_LOGS_DIR | ~/.agent-server/logs | Log directory |
| AGENT_SERVER_RUN_DB | ~/.agent-server/runs.db | Durable run-history SQLite database. `:memory:` for ephemeral. |
| AGENT_SERVER_API_KEY | generated by `agent-server init` | Required local API key, minimum 16 characters. Every route except `/health` needs it. |
| AGENT_SERVER_USE_INSTALLED_KIMI | true | Set `false` to turn off installed Kimi Code discovery. Claude and Codex have no equivalent: there is no bundled runtime to fall back to. |
| AGENT_SERVER_CLAUDE_PATH | (auto) | Explicit path to the Claude executable, overriding auto-discovery. |
| AGENT_SERVER_CODEX_PATH | (auto) | Explicit path to the Codex executable, overriding auto-discovery. |
| AGENT_SERVER_KIMI_PATH | (auto) | Explicit path to the Kimi Code executable. An invalid explicit path fails closed. |
| AGENT_SERVER_CHECK_INTERVAL_MS | 60000 | Daemon check interval |
| AGENT_SERVER_PANEL_URL | (none) | Agent Panel URL for telemetry |
| AGENT_SERVER_PANEL_API_KEY | (none) | API key for Agent Panel |
| AGENT_SERVER_PANEL_ENABLED | true | Set `false` to stop all panel traffic while keeping saved credentials |
| AGENT_SERVER_HEARTBEAT_MS | 30000 | Heartbeat interval during runs (ms). Panel marks runs stale after 90s, so 30s absorbs two dropped heartbeats. |
| AGENT_SERVER_PORT | 47821 | HTTP API port |
| AGENT_SERVER_HOST | 127.0.0.1 | HTTP bind host |
| AGENT_SERVER_MAX_CONCURRENT_RUNS | 8 | Concurrent running agents before new triggers are rejected |
| AGENT_SERVER_MAX_TRIGGER_DEPTH | 10 | Outgoing agent-to-agent trigger edges allowed in one branch |
| AGENT_SERVER_MAX_WS_CLIENTS | 100 | Simultaneous WebSocket clients |
| AGENT_SERVER_DEFAULT_MAX_TURNS | 20 | `max_turns` used when an agent omits it |
| AGENT_SERVER_PROMPT_INJECTION_GUARD | true | Wrap untrusted user context in guarded delimiters and policy instructions before execution |
| AGENT_SERVER_PROMPT_INJECTION_STRICT | false | Reject suspicious user context (pattern-based) before execution |
| AGENT_SERVER_NATIVE_SERVICE_GRANTS | (none) | Reviewed Calendar, Reminders, and Contacts grants, passed to the executor's child process as JSON. Written by the server, not by hand. |
| AGENT_SERVER_TELEGRAM_BOT_TOKEN | (none) | Telegram bot token for interactive agents |
| AGENT_SERVER_TELEGRAM_CHAT_ID | (none) | Optional Telegram chat ID restriction |
| AGENT_SERVER_SLACK_BOT_TOKEN / SLACK_BOT_TOKEN | (none) | Slack bot token (`xoxb-…`) for the Slack messaging channel (Web API) |
| AGENT_SERVER_SLACK_APP_TOKEN / SLACK_APP_TOKEN | (none) | Slack app-level token (`xapp-…`) for Socket Mode. Both Slack tokens are required to enable the channel. |
| AGENT_SERVER_CATCH_UP | false | Resume missed scheduled agents after sleep/wake |
| AGENT_SERVER_RUN_TIMEOUT_MS | 1800000 | Wall-clock ceiling per run (ms). Agents can override via `timeout` field. Set `0` to disable. |
| AGENT_SERVER_TELEMETRY_PROGRESS_MODE | live | Panel progress reporting mode. `live` throttles updates to one per sample window; `batched` defers all updates to the terminal payload. |
| AGENT_SERVER_TELEMETRY_PROGRESS_SAMPLE_MS | 5000 | Minimum interval between live progress posts. Batched updates within the window are surfaced on the next non-throttled post. |
| AGENT_SERVER_TELEMETRY_PROGRESS_MAX_ENTRIES | 50 | Hard cap on accumulated progress entries per run. Excess updates increment `progress_updates_dropped`. |
| AGENT_SERVER_TELEMETRY_PROGRESS_INCLUDE_METADATA | false | When `true`, full metadata is recorded on every progress entry. Default keeps only `turns_completed` and `tools_used` to shrink payload. |
| AGENT_SERVER_ANALYTICS_KEY | (none) | Product analytics project key, injected by the macOS app. Unset means analytics is off. |
| AGENT_SERVER_ANALYTICS_HOST | https://us.i.posthog.com | Product analytics ingest host |
| AGENT_SERVER_ANALYTICS_DISTINCT_ID | (none) | Per-install identifier passed down by the macOS app so both surfaces resolve to one person |
| AGENT_SERVER_ANALYTICS_OPT_OUT | true | Analytics stays off until this is explicitly `false`. The `.env` value wins over the shell so the macOS toggle reaches a running daemon. |
| AGENT_SERVER_LOCATION | (none) | Path to the agent-server repo root. Used by the macOS app to find the server. |
| AGENT_SERVER_EVENTKIT_BIN | (none) | Path to the bundled EventKit helper. Set by the macOS app; triggers eventkit MCP auto-injection. |

## Testing

TDD is mandatory. Tests are colocated with source files (`*.test.ts`). Use factory functions for test data, never `let`/`beforeEach` mutation.

### Panel telemetry batching

Three knobs control how chatty the panel telemetry is, with a strict precedence: **agent YAML > server env > defaults**.

1. **macOS settings drawer** -- the "Panel telemetry" card writes the four `AGENT_SERVER_TELEMETRY_PROGRESS_*` keys into `~/.agent-server/.env`.
2. **`.env` / shell env** -- the server reads these on launch.
3. **Per-agent `telemetry` block** in YAML -- wins field-by-field over the env. Unset fields fall through to env, then defaults.

```yaml
telemetry:
  progress_mode: batched          # live | batched
  progress_sample_ms: 10000       # minimum gap between live posts (ms)
  progress_max_entries: 20        # cap accumulated entries
  progress_include_metadata: true # store full metadata on every entry
```

Validated by `AgentTelemetrySchema` in `agents/config.ts` and resolved in `reporting/reporter-factory.ts`. The settings drawer changes take effect after the next server restart.

### Product analytics

Separate from panel telemetry, and the naming collision is worth holding on to: **telemetry** in this codebase means A2A run reporting to Agent Panel; **analytics** means anonymous product usage. They never share a payload, a transport, or a config key.

Both surfaces have their own copy of the same shape. Neither imports the other, and there is no shared package.

| | macOS app | CLI and daemon |
|---|---|---|
| Facade | `AgentServer/Services/Telemetry.swift` | `server-app/src/analytics/analytics.ts` |
| Event catalog | `AgentServerCore/TelemetryEvent.swift` | `server-app/src/analytics/events.ts` |
| Destination contract | `TelemetryDestination` | `AnalyticsDestination` |
| Live destinations | `PostHogDestination` | `createPostHogDestination` |
| Key | `POSTHOG_API_KEY` in Info.plist, injected by `scripts/release.sh` from Doppler | `AGENT_SERVER_ANALYTICS_KEY`, passed down by the app |

Adding a provider means conforming the destination contract and appending it to the array in `Telemetry.setup()` or to the array `createAnalytics` receives. No capture site changes. Destinations are isolated from each other, so one that throws or rejects never stops the rest.

Event names are `object_action`, snake_case, past tense. Never a string literal at a call site.

**No PII, ever.** Ids, slugs, enum cases, counts, and booleans only. No agent names, prompts, summaries, file paths, error messages, URLs, or credentials. Errors are reduced to a coarse slug by `classifyErrorReason` (TS) or `Telemetry.reason(for:)` (Swift). Agent definition filenames stay in the local warning and never reach an event.

**Identity** is a per-install UUID. The app generates it and passes it to the daemon as `AGENT_SERVER_ANALYTICS_DISTINCT_ID`, so the two surfaces resolve to one person rather than inflating every user count. A CLI started from a terminal falls back to `~/.agent-server/analytics-id`.

**Opt-out** defaults to off and lives behind "Help improve Agent Server" in Settings. Flipping it writes `AGENT_SERVER_ANALYTICS_OPT_OUT` into `~/.agent-server/.env`, which the daemon re-reads before every flush — the one place in this codebase where the `.env` file deliberately beats the shell environment, because a daemon started at login has no other way to hear the change.

Contributor builds have no key in Info.plist, so both surfaces silently disable and development never reaches the production project.

### Notifications

Agents can send completion/failure notifications to a channel without requiring a reply. Add a `notification` block to the agent config. The `Channel.notify()` method sends a one-way message (no inline keyboard, no reply handling).

Notification messages are formatted by `formatCompletionNotification()` and `formatFailureNotification()` in `interaction/notification.ts`. The server calls `sendNotification()` after run completion, in `.then()` on failure, and in `.catch()` on unexpected errors.

## macOS menu bar app

Native Swift app in `macos-app/` for monitoring and controlling agents from the menu bar. The project builds two targets: the main `AgentServer` application and `AgentServerEventKit`, a standalone command-line helper that exposes Calendar and Reminders via an MCP stdio server.

### Structure

```
macos-app/
  AgentServer/
    App/
      AgentServerApp.swift            -- @main entry point
      AppDelegate.swift               -- NSStatusBar, NSMenu, window management
    Models/
      AgentModel.swift                -- Agent Codable type
      RunModel.swift                  -- Run, HealthResponse, TriggerResponse types
      EnvFile.swift                   -- ~/.agent-server/.env reader/writer
    Services/
      AgentServerClient.swift         -- HTTP client for localhost:47821
      StatusMonitor.swift             -- WebSocket + HTTP polling, fires run notifications
      ServerProcessManager.swift      -- Spawns the Node server, exports AGENT_SERVER_EVENTKIT_BIN
      NotificationManager.swift       -- UNUserNotificationCenter wrapper for run lifecycle events
      EventKitPermissionManager.swift -- Requests Calendar + Reminders access at startup
      LaunchAtLoginManager.swift      -- SMAppService wrapper
    Views/
      MainWindow.swift                -- Sidebar + main pane + drawer overlays
      Sidebar.swift                   -- Agent list (left, 240px)
      MainPane.swift                  -- Home dashboard cards
      AgentDetailDrawer.swift         -- Consumer agent page (last run, capabilities, gear)
      AgentSettingsView.swift         -- Gear editor: basics, schedule, capability toggles, Connect flow, and Open raw file
      CreateAgentSheet.swift          -- Consumer new-agent flow (POST /agents)
      SettingsDrawer.swift            -- App settings (power-user cards behind Advanced)
    Assets.xcassets/                  -- App icon + menu bar icons
    Info.plist                        -- Includes NSCalendarsFullAccessUsageDescription + NSRemindersFullAccessUsageDescription
  AgentServerEventKit/
    main.swift                        -- Entry point; spins up MCPServer with EventKitHandler
    MCPServer.swift                   -- Minimal JSON-RPC 2.0 stdio MCP server (initialize, tools/list, tools/call)
    EventKitHandler.swift             -- EventKit tool implementations with lazy auth via EKEventStore.requestFullAccess*
    Info.plist                        -- Embedded into binary via CREATE_INFOPLIST_SECTION_IN_BINARY; holds TCC usage descriptions
  AgentServer.xcodeproj/             -- Generated by xcodegen
  project.yml                        -- xcodegen spec (two targets: AgentServer + AgentServerEventKit)
```

### Key patterns

- **Consumer UI**: The main window is sidebar (agents) + home pane, with slide-in drawers governed by `DrawerRouter`. Clicking an agent opens `AgentDetailDrawer`, which shows the schedule in plain English, the last run's outcome, and enabled capabilities. The gear opens `AgentSettingsSheet` for basics, schedule, instructions, capability controls, and a direct Open raw file action. The Coding agents card controls installed Claude Code, Codex, and Kimi Code discovery. The per-agent picker distinguishes installed Kimi Code from API-backed Kimi K3. `SchedulePreset` maps the picker to cron and back; unrecognized cron shapes stay Custom so hand-written schedules are never rewritten. Notification deep-links route into the drawer through `openMainWindow(route:)`.
- **NSStatusBar + NSMenu**: Menu bar icon with dropdown showing active runs and scheduled agent count. Icon switches from template (idle) to tinted (active runs).
- **StatusMonitor**: Connects to `ws://localhost:47821/ws` for real-time run events. Falls back to HTTP polling every 5 seconds if WebSocket disconnects. Reconnects automatically after 5 seconds. Uses `@Published` properties for reactive UI updates. On lifecycle events (`run_completed`, `run_failed`, `mcp_status`) it calls `poll()` and routes to `NotificationManager`. Routes `run_failed` with `code == "run_timeout"` to `notifyRunTimedOut` and `run_failed` without a timeout code to `notifyRunFailed` — both tier-2. Detects server restarts by comparing `/health` `started_at` values between polls and fires `notifyServerRestarted` on change. Does NOT notify on `run_started` (too noisy).
- **AgentServerClient**: HTTP client with `cancelRun(id:)` for aborting running agents via `POST /runs/:id/cancel`.
- **ServerProcessManager**: Discovers the server in three locations: `AGENT_SERVER_LOCATION` override (UserDefaults or `.env`), bundled Resources (`Contents/Resources/dist/cli.js`), or a sibling `agent-server/` directory next to the `.app`. When spawning the Node server it exports `AGENT_SERVER_EVENTKIT_BIN` pointing at the bundled `Contents/Helpers/agent-server-eventkit` so the Node executor can auto-inject the eventkit MCP server. Does not run `pnpm install` at runtime; production `node_modules/` is pre-staged at build time (see "Bundled server" below).
- **NotificationManager**: Wraps `UNUserNotificationCenter` for the banner and `AVAudioPlayer` for the chime. Each post call declares a `NotificationCategory` (`.systemEvent` or `.agentOutput`) plus a `Chime` (`.info` / `.success` / `.failure`). `NotificationPreferences.shared.shouldPost(category)` gates the post; after `center.add()`, the manager queries `UNUserNotificationCenter.getNotificationSettings()` and plays the chime only when `authorizationStatus` is authorized/provisional/ephemeral and `soundSetting == .enabled` — so the OS-level "Play sound for notifications" toggle is respected independently of our app-level toggle. Banner is silent (`content.sound = nil`); the `AVAudioPlayer`-based chime is pre-loaded per `Chime` at init. See "Notification preferences" below for the full routing table.
- **EventKitPermissionManager**: Called from `AppDelegate.applicationDidFinishLaunching`. Checks `EKEventStore.authorizationStatus` for both `.event` and `.reminder` and calls `requestFullAccessToEvents` / `requestFullAccessToReminders` only when the status is `.notDetermined`, so the prompt shows once on first launch. The prompts use the usage descriptions from the main app's Info.plist.
- **AgentServerEventKit helper binary**: A Swift command-line tool (type `tool` in xcodegen, `mh_execute` Mach-O) that speaks the MCP stdio protocol (JSON-RPC 2.0, newline-delimited, stdin/stdout). `main.swift` wires `MCPServer` to `EventKitHandler`. `MCPServer` handles `initialize`, `tools/list`, and `tools/call`; errors flow back as JSON-RPC error objects. `EventKitHandler` lazily calls `requestFullAccess*` on first tool use and caches the result via the `EKEventStore` authorization status. Info.plist is embedded into the binary via `CREATE_INFOPLIST_SECTION_IN_BINARY = YES` + `-sectcreate __TEXT __info_plist` so TCC can read the usage descriptions at prompt time. The helper is bundled into the main app via a postBuildScript on `AgentServer` that copies the built tool from `BUILT_PRODUCTS_DIR` into `${WRAPPER_NAME}/Contents/Helpers/` and ad-hoc signs it. The target dependency is declared with `embed: false, link: false` so Xcode does not auto-embed it as a resource.
- **MarkdownEditor**: NSTextView-based editor with syntax highlighting. Uses in-place `textStorage.beginEditing()`/`endEditing()` updates to avoid cursor jumping and scroll position resets during typing.
- **Window management**: Settings window uses `NSApp.setActivationPolicy(.accessory)` / `.regular` switching.
- **Settings**: Launch at login toggle (SMAppService), catch-up toggle for `AGENT_SERVER_CATCH_UP`, server status indicator, env editor, Notifications toggles (see below).

### Notification preferences

Two-tier UserDefaults-backed model defined in `AgentServerSwiftTests/Sources/AgentServerCore/NotificationPreferences.swift`. The shared singleton `NotificationPreferences.shared` is used by `NotificationManager` (for gating) and the Settings UI (for bindings), so toggle changes take effect immediately without restart.

| Toggle | Stored key | Category gated | Events | Chime |
|---|---|---|---|---|
| Enable notifications | `notifications.enabled` | `.systemEvent` (and master for tier 2) | MCP needs auth, server restart | `.info` (`agent-server-notification.aiff`) |
| Notify for agent output | `notifications.includeAgentOutput` | `.agentOutput` | Run completed | `.success` (`agent-server-success.aiff`) |
|  |  |  | Run failed (non-timeout), Run timed out | `.failure` (`agent-server-failure.aiff`) |

Both toggles default ON. `shouldPost(.systemEvent)` requires only the master; `shouldPost(.agentOutput)` requires both. `NotificationCategory` lives in the core test module so the gate matrix is unit-testable. UI settings live in `SettingsDrawer.notificationsCard`, bound to `NotificationPreferences.shared`. The second toggle is conditionally rendered (hidden, not greyed) when the master is off. Chimes are mono/22050Hz AIFF — the format that decodes reliably in `AVAudioPlayer` on macOS Sonoma+.

The server emits structured hints that the Swift side uses to pick categories: `run_failed` events carry an optional `code` field (currently `"run_timeout"` from `execution/runner.ts` when the wall-clock timer fires), and MCP authentication issues fan out as a dedicated `mcp_status` WebSocket event with `mcp_needs_auth_servers: string[]`, emitted by the `wrappedReporter` in `server/server.ts` whenever progress metadata contains `mcp_servers` with `status: "needs-auth"` entries.
- **No sandbox**: App needs filesystem access for `~/.agent-server/.env` and network access for localhost API.
- **Target**: macOS 14.0+, Swift 5.9+, one dependency (NerdsUI Swift package).
- **Bundled server**: `project.yml` declares three items under the `AgentServer` target's `sources:` with `buildPhase: resources`: `../server-app/dist` (type folder), `../server-app/package.json`, and `.build-cache/server-bundle/node_modules` (type folder). They land at `Contents/Resources/dist/`, `Contents/Resources/package.json`, and `Contents/Resources/node_modules/` in the built `.app`. Production `node_modules` are staged at build time by a `preBuildScripts` phase that copies `server-app/package.json` + `package-lock.json` into `macos-app/.build-cache/server-bundle/` and runs `pnpm install --frozen-lockfile --omit=dev --ignore-scripts` there. The script is idempotent via a lock-file SHA-256 hash cached at `.build-cache/server-bundle/.installed-lock-hash`, so incremental builds skip the install entirely. Because the install targets a staging directory (not the app bundle), code signing stays valid; nothing is ever written inside `Agent Server.app/Contents/` post-signing. The `.build-cache/` directory is gitignored. Node module resolution works because `dist/`, `package.json`, and `node_modules/` sit at the same level inside `Contents/Resources/`, which matches Node's upward `node_modules` lookup rules.

### Build

```bash
cd macos-app
xcodegen generate
xcodebuild -project AgentServer.xcodeproj -scheme AgentServer build
```

Building the `AgentServer` scheme runs `preBuildScripts` first (stages production `node_modules/` in `.build-cache/server-bundle/` via `pnpm install --frozen-lockfile --omit=dev`), then builds `AgentServerEventKit` (target dependency), then compiles Swift sources, copies resources into the bundle (`dist/`, `package.json`, `node_modules/`), and finally runs the post-build script that embeds the helper at `Contents/Helpers/agent-server-eventkit`. First build takes longer due to `pnpm install --frozen-lockfile`; subsequent builds skip it based on lock-file hash. To build only the helper for debugging: `xcodebuild -scheme AgentServerEventKit build`. To sanity-check the helper binary directly: `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | /path/to/agent-server-eventkit`.

## Future work

- **Conditional triggers**: Extend `on_complete` triggers with conditions (e.g., only fire if the output contains a certain keyword, or if the run used fewer than N turns).
- **Retry with backoff**: Allow agents to specify retry behavior on failure (max retries, backoff strategy) instead of requiring a separate `on_failure` chain.
- **Agent template library**: Ship a curated set of agent templates (daily summary, PR reviewer, inbox triager) that users can install via `agent-server init --template <name>`.

## Future work - Permanently Parked (not going to do)

- **Agent versioning and rollback**: Track agent config changes over time. Allow reverting to a previous version of an agent definition if a new prompt or config causes failures.
- **Multi-user Telegram support**: Currently the bot stores a single chat ID. Support multiple Telegram users with per-user routing and permissions.
