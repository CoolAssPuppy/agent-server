# Agent Server

Lightweight orchestration server that runs AI agents in the background using Claude Code as its execution engine. Agents are defined as YAML or Markdown files with cron schedules. The server discovers agents, evaluates schedules, acquires locks, runs Claude Code via the Agent SDK, streams events, and reports telemetry in A2A format.

## Architecture

```
src/
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
  interaction/
    parser.ts            -- Parses ```interaction blocks from agent output
    schema.ts            -- InteractionRequest, InteractionConfig, NotificationConfig schemas
    notification.ts      -- Notification message formatting
    store.ts             -- In-memory pending interaction store with expiry
  reporting/
    reporter.ts          -- A2A telemetry reporter with heartbeat
    reporter-factory.ts  -- Creates noop or telemetry reporter based on config
    store.ts             -- In-memory run state store with eviction
  server/
    api.ts               -- Hono HTTP API routes
    server.ts            -- Combined HTTP server + agent scheduler + Telegram
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

### File locking

PID-based locks in the locks directory. Stale lock detection via `process.kill(pid, 0)`. Always release in a `finally` block.

### Agent chaining

Agents can define `on_complete` and `on_failure` arrays referencing other agent IDs. Use `evaluateTriggers()` to find downstream agents after a run completes.

### File watch triggers

Agents can declare `watch` paths in their YAML config. The `FileWatcher` class monitors these paths with `fs.watch`, applies glob filtering for directories, and debounces rapid changes. The `expandHome()` utility (in `agents/file-watcher.ts`) handles `~` expansion and is shared with `plugins/claude-code.ts`.

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

Channels implement the `Channel` interface from `channels/channel.ts`. Each channel handles sending interaction requests and receiving replies for its platform.

- **Console**: Numbered options + readline. Used in `agent-server run` CLI mode.
- **Telegram**: Inline keyboards via grammY long-polling. No public IP needed. Set `AGENT_SERVER_TELEGRAM_BOT_TOKEN` to enable.
- **Dispatcher**: `ChannelDispatcher` maps channel names to instances. Logs a warning if a channel isn't configured.

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

Hono app created via `createApi()` with dependency injection. Routes: `/agents`, `/agents/:id`, `/agents/:id/run`, `/runs`, `/runs/:id`, `/health`. The `startServer()` function combines HTTP + scheduler + Telegram in one process.

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
watch:                   # optional file triggers
  - path: "~/output"
    glob: "*.md"
on_complete:             # optional agent chaining
  - agent: downstream-agent
on_failure:
  - agent: alert-agent
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

```bash
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
- **StatusMonitor**: Polls `/health`, `/agents`, `/runs` every 5 seconds. Uses `@Published` properties for reactive UI updates.
- **Window management**: Settings window uses `NSApp.setActivationPolicy(.accessory)` / `.regular` switching from mail-notifier pattern.
- **No sandbox**: App needs filesystem access for `~/.agent-server/.env` and network access for localhost API.
- **Target**: macOS 14.0+, Swift 5.9+, no third-party dependencies.

### Build

```bash
cd macos-app
xcodegen generate
xcodebuild -project AgentServer.xcodeproj -scheme AgentServer build
```

## Future work

- WebSocket streaming for live run progress
- Cancel running agents via API
- Wire triggers into server run completion flow
- Sleep/wake catch-up logic for LaunchAgent
- Expired interaction cleanup in Telegram (edit message to show "Expired")
