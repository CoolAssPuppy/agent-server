# Agent Server

Lightweight orchestration server that runs AI agents in the background using Claude Code as its execution engine. Agents are defined as YAML or Markdown files with cron schedules. The server discovers agents, evaluates schedules, acquires locks, runs Claude Code via the Agent SDK, streams events, and reports telemetry in A2A format.

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
    scheduler.ts         -- Cron expression evaluation (cron-parser v5)
    triggers.ts          -- Agent chaining (on_complete, on_failure)
    file-watcher.ts      -- File watch triggers with debounce and glob
  channels/
    channel.ts           -- Channel interface + ChannelReply type
    console.ts           -- Console channel (readline, numbered options)
    telegram.ts          -- Telegram channel (grammY, long-polling, inline keyboards)
    router.ts            -- LLM-powered message routing (picks agent from user message)
    dispatcher.ts        -- Maps channel names to Channel instances
  execution/
    executor.ts          -- Stream event parsing, tool metadata extraction, types
    executor-registry.ts -- Plugin registry for model-agnostic execution
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
    claude-code.ts       -- Claude Code executor (Agent SDK query())
  cli.ts                 -- Commander CLI: start, run, list, init, install, uninstall
  index.ts               -- Barrel exports for library use
  test-factories.ts      -- Shared test data factories

sample-agents/           -- Example agent YAML configs
```

## Tech stack

- TypeScript strict mode, ES2022, ESM
- @anthropic-ai/claude-agent-sdk for running Claude Code programmatically
- Zod for schema validation
- cron-parser v5 (`CronExpressionParser.parse()`, NOT `parseExpression()`)
- Hono for HTTP API
- @hono/node-ws for WebSocket streaming
- Commander for CLI
- grammY for Telegram bot (long-polling, inline keyboards)
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

### Panel client and ghost run cleanup

`PanelClient` in `reporting/panel-client.ts` provides two methods for cleaning up orphaned ("ghost") runs in the panel:

- `failOrphanedRuns(serverId?)` -- calls `POST {panelUrl}/api/runs/cleanup` to mark all `working` runs for a given worker as failed
- `markStaleRuns()` -- calls `POST {panelUrl}/api/cron/stale-runs` to trigger the panel's stale run detection

Use `createPanelClient(config)` to get a `PanelClient` or `null` (when panel is not configured).

**Defense in depth**: Ghost runs are handled by five layers:
1. **Startup reconciliation**: Server calls `failOrphanedRuns(serverId)` on boot
2. **Vercel cron**: Panel's `/api/cron/stale-runs` runs every minute
3. **pg_cron**: Supabase `mark_stale_runs()` runs every 30s (if available)
4. **Periodic sweep**: Server calls `markStaleRuns()` every 5 minutes
5. **Manual**: `agent-server cleanup` CLI or macOS app "Clean up" action

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

The executor in `plugins/claude-code.ts` uses `query()` from `@anthropic-ai/claude-agent-sdk`. It passes the agent's prompt and an `Options` object with `maxTurns`, `cwd`, `permissionMode: 'bypassPermissions'`, and optionally `allowedTools`. The SDK returns an `AsyncGenerator<SDKMessage>`. Key message types: `assistant` (has `message.content` blocks with text/tool_use), `result` (subtype `success` or error variants, has `num_turns`, `result` text).

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
- **Dispatcher**: `ChannelDispatcher` maps channel names to instances. Calls `expireInteractions()` to clean up expired interactions across channels.

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

Hono app created via `createApi()` with dependency injection. Routes: `/agents`, `/agents/:id`, `/agents/:id/run`, `/runs`, `/runs/:id`, `/runs/:id/cancel`, `/cleanup`, `/health`, `/ws`. The `startServer()` function combines HTTP + scheduler + Telegram + WebSocket in one process.

The `/health` endpoint returns `{ status, timestamp, started_at }` where `started_at` is the server boot time (ISO string). The macOS app uses `started_at` to detect server restarts and identify orphaned runs. The `/cleanup` endpoint calls the panel to fail orphaned runs owned by this server instance.

### Cancelling runs

`POST /runs/:id/cancel` aborts a running agent. The server stores an `AbortController` per run, passes it to the Claude Agent SDK via `Options.abortController`, and calls `.abort()` on cancel. The run status is set to `'failed'` with error `'Cancelled by user'`. Returns 409 if the run is not in `'running'` state.

### WebSocket streaming

Connect to `ws://localhost:47821/ws` for real-time run progress. Events are JSON with type `run_started`, `run_progress`, `run_completed`, or `run_failed`. The `ProgressBroadcaster` class in `server/websocket.ts` manages subscriptions. The macOS app uses `URLSessionWebSocketTask` to connect, falling back to HTTP polling if the connection fails.

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
executor: claude-code    # optional, defaults to claude-code
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
npm test              # Run all tests
npm run type-check    # TypeScript strict check
npm run build         # Compile to dist/
npm run dev           # Dev mode with tsx watch
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

| Variable | Default | Description |
|---|---|---|
| AGENT_SERVER_AGENTS_DIR | ~/.agent-server/agents | Directory containing agent definition files |
| AGENT_SERVER_LOCK_DIR | ~/.agent-server/locks | Lock file directory |
| AGENT_SERVER_LOGS_DIR | ~/.agent-server/logs | Log directory |
| AGENT_SERVER_CHECK_INTERVAL_MS | 60000 | Daemon check interval |
| AGENT_SERVER_PANEL_URL | (none) | Agent Panel URL for telemetry |
| AGENT_SERVER_PANEL_API_KEY | (none) | API key for Agent Panel |
| AGENT_SERVER_HEARTBEAT_MS | 30000 | Heartbeat interval |
| AGENT_SERVER_PORT | 47821 | HTTP API port |
| AGENT_SERVER_TELEGRAM_BOT_TOKEN | (none) | Telegram bot token for interactive agents |
| AGENT_SERVER_CATCH_UP | false | Resume missed scheduled agents after sleep/wake |

## Testing

TDD is mandatory. Tests are colocated with source files (`*.test.ts`). Use factory functions for test data, never `let`/`beforeEach` mutation.

### Notifications

Agents can send completion/failure notifications to a channel without requiring a reply. Add a `notification` block to the agent config. The `Channel.notify()` method sends a one-way message (no inline keyboard, no reply handling).

Notification messages are formatted by `formatCompletionNotification()` and `formatFailureNotification()` in `interaction/notification.ts`. The server calls `sendNotification()` after run completion, in `.then()` on failure, and in `.catch()` on unexpected errors.

## macOS menu bar app

Native Swift app in `macos-app/` for monitoring and controlling agents from the menu bar.

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
      StatusMonitor.swift             -- Timer-based polling, @Published state
      LaunchAtLoginManager.swift      -- SMAppService wrapper
    Views/
      SettingsView.swift              -- Tab container (Agents, Settings)
      AgentsListView.swift            -- Agent list with run buttons
      SettingsTabView.swift           -- Launch at login + env editor
      EnvEditorView.swift             -- Key-value editor for .env
    Assets.xcassets/                  -- App icon + menu bar icons
  AgentServer.xcodeproj/             -- Generated by xcodegen
  project.yml                        -- xcodegen spec
```

### Key patterns

- **NSStatusBar + NSMenu**: Menu bar icon with dropdown showing active runs and scheduled agent count. Icon switches from template (idle) to tinted (active runs).
- **StatusMonitor**: Connects to `ws://localhost:47821/ws` for real-time run events. Falls back to HTTP polling every 5 seconds if WebSocket disconnects. Reconnects automatically after 5 seconds. Uses `@Published` properties for reactive UI updates. Detects server restarts by comparing `/health` `started_at` values between polls. When a restart is detected, marks previously-active runs as stale and exposes `staleRunCount` for the menu and sidebar banner.
- **AgentServerClient**: HTTP client with `cancelRun(id:)` for aborting running agents via `POST /runs/:id/cancel`.
- **ServerProcessManager**: Discovers the server in three locations: bundled Resources, bundle-adjacent directory, or dev path. Auto-installs npm dependencies on first launch if `node_modules/` is missing.
- **MarkdownEditor**: NSTextView-based editor with syntax highlighting. Uses in-place `textStorage.beginEditing()`/`endEditing()` updates to avoid cursor jumping and scroll position resets during typing.
- **Window management**: Settings window uses `NSApp.setActivationPolicy(.accessory)` / `.regular` switching.
- **Settings**: Launch at login toggle (SMAppService), catch-up toggle for `AGENT_SERVER_CATCH_UP`, server status indicator, env editor.
- **No sandbox**: App needs filesystem access for `~/.agent-server/.env` and network access for localhost API.
- **Target**: macOS 14.0+, Swift 5.9+, no third-party dependencies.
- **Bundled server**: `project.yml` includes `server-app/dist/` and `package.json` as folder resources for standalone distribution.

### Build

```bash
cd macos-app
xcodegen generate
xcodebuild -project AgentServer.xcodeproj -scheme AgentServer build
```

## Future work

- **Run history and log persistence**: Runs are stored in-memory and lost on restart. Persist run history to SQLite or flat files so past runs survive server restarts and can be queried/exported.
- **Agent metrics dashboard**: Expose success/failure rates, average run duration, and token usage per agent via API endpoints for the macOS app or Agent Panel to visualize.
- **Conditional triggers**: Extend `on_complete` triggers with conditions (e.g., only fire if the output contains a certain keyword, or if the run used fewer than N turns).
- **Retry with backoff**: Allow agents to specify retry behavior on failure (max retries, backoff strategy) instead of requiring a separate `on_failure` chain.
- **macOS notifications**: Send native macOS notifications (via `UNUserNotificationCenter`) when agents complete or fail, in addition to Telegram.
- **Agent template library**: Ship a curated set of agent templates (daily summary, PR reviewer, inbox triager) that users can install via `agent-server init --template <name>`.

## Future work - Permanently Parked (not going to do)

- **Agent versioning and rollback**: Track agent config changes over time. Allow reverting to a previous version of an agent definition if a new prompt or config causes failures.
- **Multi-user Telegram support**: Currently the bot stores a single chat ID. Support multiple Telegram users with per-user routing and permissions.