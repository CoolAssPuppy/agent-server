# Agent Server

A lightweight orchestration server that runs AI agents in the background using [Claude Code](https://docs.anthropic.com/en/docs/claude-code) as its execution engine.

Define agents as Markdown or YAML files with cron schedules. Agent Server discovers them, runs them on schedule, prevents concurrent execution with file locks, and reports telemetry in [A2A](https://google.github.io/A2A/) format. Agents can request user input via Telegram, send completion notifications, chain to other agents, and trigger on file changes.

## How it works

Agent Server uses the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) to run Claude Code programmatically. It calls the SDK's `query()` function with the agent's prompt, streams structured messages from the async generator, and extracts tool usage, file operations, and command metadata from each turn.

This means agents inherit everything Claude Code provides: MCP server integrations (Slack, Linear, Notion, GitHub, etc.), tool permissions, model selection, and context management. Agent Server just runs the prompt and records what happens.

```
~/.agent-server/
  .env                    # Environment variables (panel URL, API keys, Telegram token)
  agents/                 # Agent definition files (.yaml, .yml, .md)
    weekly-report.md
    daily-standup.yaml
  locks/                  # PID-based file locks (managed automatically)
  logs/                   # Server and LaunchAgent logs
  telegram.json           # Persisted Telegram chat ID (created automatically)
```

## Quick start

```bash
npm install
npm run build

# Create config directory with a sample agent
npx tsx src/cli.ts init

# Edit your agent
$EDITOR ~/.agent-server/agents/hello-world.yaml

# Test a single agent
npx tsx src/cli.ts run hello-world

# Start the server (HTTP API + scheduler)
npx tsx src/cli.ts start
```

The `init` command creates `~/.agent-server/` with `agents/`, `locks/`, and `logs/` directories and a sample `hello-world.yaml` agent.

## Creating agents

Agents live in `~/.agent-server/agents/`. Two formats are supported: Markdown with YAML frontmatter and pure YAML.

### Markdown with YAML frontmatter (recommended)

YAML frontmatter for configuration, Markdown body for the prompt. This format gives you full Markdown formatting in the prompt with syntax highlighting in any editor.

```markdown
---
id: weekly-report
name: Weekly Priority Report
schedule: "0 5 * * 1"
timezone: Europe/Lisbon
tools:
  - Read
  - Write
  - Bash
max_turns: 30
working_directory: "~"
---

Review my work activity from the last 7 days and create a report.

## Sources to check

1. **Linear**: Initiatives, projects, and issues updated in the last 7 days
2. **Slack**: Related conversations and decisions
3. **Notion**: Documents I've edited recently

## Output

Create a new page in my Notion workspace with a structured summary.
```

### Pure YAML

Everything in one YAML file. The prompt goes in a `prompt` field using YAML's block scalar syntax.

```yaml
id: changelog-watcher
name: Changelog Generator
schedule: "0 18 * * 1-5"
timezone: America/Los_Angeles
prompt: |
  Generate a changelog entry for today's commits.
  Group by conventional commit type. Write to CHANGELOG.md.
tools:
  - Read
  - Write
  - Bash
max_turns: 10
```

### Configuration fields

| Field | Required | Default | Description |
|---|---|---|---|
| `id` | yes | | Unique identifier (used in CLI and API) |
| `name` | yes | | Display name |
| `description` | no | | What this agent does. Used by Telegram message routing to match messages to agents. |
| `schedule` | no | | Cron expression (e.g., `0 9 * * 1-5`). Omit for on-demand agents. |
| `timezone` | no | | IANA timezone for schedule evaluation (e.g., `America/Los_Angeles`) |
| `prompt` | yes* | | The prompt sent to Claude Code. *In frontmatter format, the Markdown body is the prompt. |
| `max_turns` | no | `20` | Maximum agentic conversation turns |
| `working_directory` | no | `$HOME` | Working directory for the Claude Code session. Supports `~`. |
| `tools` | no | `[]` | Allowed tools list (SDK-level). Empty means all tools are available. |
| `disallowed_tools` | no | `[]` | Tools to explicitly deny (SDK-level). Removed from the model's context entirely. |
| `permissions` | no | | Fine-grained tool permissions with glob patterns. See [tool permissions](#example-tool-permissions). |
| `permission_mode` | no | `bypassPermissions` | SDK permission mode: `bypassPermissions`, `acceptEdits`, `dontAsk`, `default`, `plan` |
| `enabled` | no | `true` | Whether the scheduler runs this agent |
| `executor` | no | `claude-code` | Which executor plugin to use |
| `on_complete` | no | | Agents to trigger on successful completion |
| `on_failure` | no | | Agents to trigger on failure |
| `watch` | no | | File paths to watch for changes (triggers runs outside the cron schedule) |
| `interaction` | no | | Interactive agent config (channel, on_reply, timeout) |
| `notification` | no | | Notification config (channel, on_complete, on_failure) |

### Example: basic scheduled agent

A daily standup summary that runs every weekday morning:

```yaml
id: daily-standup
name: Daily Standup Summary
schedule: "0 9 * * 1-5"
timezone: America/Los_Angeles
prompt: |
  Generate a daily standup summary for today:

  **What I did yesterday:**
  - Check Slack channels for messages I sent or was mentioned in
  - Check Linear for issues I completed or moved
  - Check git commits from yesterday

  **What I'm doing today:**
  - Check Linear for issues assigned to me in progress or todo

  **Blockers:**
  - Flag any issues marked as blocked in Linear

  Write the summary in first person, under 200 words.
  Save to ~/standup/standup-{today's date}.md
tools:
  - Read
  - Write
  - Bash
max_turns: 15
working_directory: "~"
```

### Example: on-demand agent

An agent without a schedule that runs only when triggered manually or via the API:

```yaml
id: dependency-audit
name: Dependency Security Audit
prompt: |
  Run a security and freshness audit on this project's dependencies:
  1. Run `npm audit` and capture the output
  2. Run `npm outdated` and capture the output
  3. Generate a report at ~/reports/dependency-audit-{date}.md
tools:
  - Read
  - Write
  - Bash
max_turns: 10
```

Trigger it with:

```bash
npx tsx src/cli.ts run dependency-audit
```

### Example: agent chaining

Agents can trigger other agents on completion or failure:

```yaml
id: research-collector
name: Research Collector
schedule: "0 7 * * 1-5"
prompt: |
  Research topics in ~/research/topics.md and save findings
  to ~/Documents/notes/research-{topic}-{date}.md
tools:
  - Read
  - Write
  - Bash
on_complete:
  - agent: markdown-processor
on_failure:
  - agent: alert-agent
```

When `research-collector` finishes, it triggers `markdown-processor`. If it fails, it triggers `alert-agent`.

### Example: file watch triggers

Agents can watch file paths and run when changes are detected, independent of the cron schedule:

```yaml
id: notes-processor
name: Notes Processor
prompt: |
  Process any new or changed markdown files in ~/notes.
watch:
  - path: "~/notes"
    glob: "*.md"
tools:
  - Read
  - Write
```

The watcher uses `fs.watch` with debouncing (500ms) to avoid triggering multiple times for rapid changes. The `glob` field is optional and supports `*` and `?` wildcards.

### Example: interactive agent

Agents can ask the user a question via Telegram or the console and continue based on the answer. The agent outputs a fenced `interaction` block in its response, and Agent Server routes it to the configured channel.

```yaml
id: restaurant-checker
name: Restaurant Availability Checker
prompt: |
  Check availability at the restaurant specified in the context.
  If you find slots, output an interaction block asking which to book.
interaction:
  channel: telegram      # "telegram" or "console"
  on_reply: restaurant-booker
  timeout: 1h            # default: 30m
tools:
  - Bash
max_turns: 40
```

The agent's output includes a structured interaction request:

````
```interaction
{
  "message": "Found 3 slots at Bougainville tonight",
  "options": [
    { "label": "19:00", "value": "Book Bougainville, 19:00, 4 guests" },
    { "label": "20:30", "value": "Book Bougainville, 20:30, 4 guests" },
    { "label": "21:00", "value": "Book Bougainville, 21:00, 4 guests" }
  ],
  "freeText": false
}
```
````

When the user taps a button in Telegram (or types a number in the console), the selected option's `value` becomes extra context for the `on_reply` agent:

```bash
# This is what happens automatically:
npx tsx src/cli.ts run restaurant-booker --with "Book Bougainville, 20:30, 4 guests"
```

Interaction requests support:
- **Options**: buttons in Telegram, numbered list in console
- **Free text**: `"freeText": true` allows the user to type a response
- **Both**: options and free text together
- **Timeout**: defaults to 30 minutes, configurable per agent

### Example: tool permissions

There are three ways to control what tools an agent can use, from simple to fine-grained:

**1. `tools`** -- SDK-level allowlist. When set, only these tools are available to the model. Empty means all tools.

```yaml
tools:
  - Read
  - Write
  - Bash
```

**2. `disallowed_tools`** -- SDK-level denylist. These tools are removed from the model's context entirely.

```yaml
disallowed_tools:
  - Bash
  - Edit
```

**3. `permissions`** -- Fine-grained control with glob patterns. When defined, every tool call is checked against allow/deny rules before execution. This is the recommended approach for agents that use MCP servers, because it lets you control exactly which MCP operations are permitted.

The `permissions` block works as an allowlist: only tools matching an `allow` pattern can run. Deny rules take precedence over allow rules. Any tool not explicitly allowed is blocked.

```yaml
id: research-agent
name: Research Agent
schedule: "0 9 * * 1-5"
prompt: |
  Research recent activity across Linear and Slack.
  Write a summary to ~/reports/research-{date}.md
permissions:
  allow:
    - Read
    - Write
    - Glob
    - Grep
    - "mcp__claude_ai_Linear__list_*"
    - "mcp__claude_ai_Linear__get_*"
    - "mcp__claude_ai_Slack__search_*"
    - "mcp__claude_ai_Slack__read_*"
  deny:
    - "mcp__*__create_*"
    - "mcp__*__update_*"
    - "mcp__*__delete_*"
max_turns: 20
working_directory: "~"
```

This agent can read from Linear and Slack via MCP and write markdown files to the filesystem, but cannot create, update, or delete anything through MCP servers. It also cannot use Bash or Edit since those are not in the allow list.

#### Pattern matching

Patterns support `*` as a wildcard that matches any sequence of characters:

| Pattern | Matches | Use case |
|---|---|---|
| `Read` | Exact match | Allow a specific built-in tool |
| `mcp__claude_ai_Linear__list_*` | Any Linear tool starting with `list_` | Read-only access to a specific MCP server |
| `mcp__*__create_*` | Any MCP tool with `create_` in the action | Deny writes across all MCP servers |
| `*` | Everything | Use with caution |

MCP tools follow the naming convention `mcp__<org>_<server>__<tool_name>`. To find the exact tool names available to your agents, check your Claude Code MCP server configuration or run an agent with verbose logging.

#### When to use which

- **No permissions needed**: Leave all three fields empty. The agent runs in `bypassPermissions` mode with access to everything.
- **Simple restriction**: Use `tools` to whitelist a few built-in tools, or `disallowed_tools` to block specific ones.
- **MCP access control**: Use `permissions` with glob patterns. This is the only way to control which MCP server operations an agent can call.

### Example: notifications

Agents can send completion or failure notifications to a channel without requiring a reply:

```yaml
id: weekly-report
name: Weekly Report Generator
schedule: "0 5 * * 1"
prompt: |
  Generate the weekly priority report.
notification:
  channel: telegram
  on_complete: true     # default: true
  on_failure: true      # default: true
```

On completion, the agent sends a message like `Agent "Weekly Report Generator" completed successfully.` followed by the run summary. On failure, it sends the error message. Set `on_complete: false` to only get notified on failures.

## Running agents

### CLI

```bash
npx tsx src/cli.ts init                          # Create ~/.agent-server/ with sample agent
npx tsx src/cli.ts start                         # Start server (HTTP API + scheduler)
npx tsx src/cli.ts run <agentId>                 # Run an agent immediately
npx tsx src/cli.ts run <agentId> --with "context" # Run with extra context appended to prompt
npx tsx src/cli.ts list                          # List all discovered agents
npx tsx src/cli.ts install                       # Install macOS LaunchAgent for auto-start
npx tsx src/cli.ts uninstall                     # Remove macOS LaunchAgent
```

After building (`npm run build`), the CLI is also available as:

```bash
agent-server start
agent-server run daily-standup
agent-server list
```

### Server mode

`agent-server start` runs both the HTTP API and the cron scheduler in a single process:

1. Starts the HTTP API on port 47821 (configurable)
2. Checks agent schedules every 60 seconds (configurable)
3. For each agent whose cron expression matches the current minute:
   - Acquires a PID-based file lock (skips if already running)
   - Creates a telemetry reporter (or a noop reporter if no panel is configured)
   - Calls the Agent SDK's `query()` with the agent's prompt and configuration
   - Iterates over the SDK message stream, extracting tool usage, files read/written, and commands run
   - Reports progress events to the telemetry endpoint on every turn
   - Sends heartbeats every 30 seconds to signal liveness
   - On completion, reports the result and sends any configured notifications
   - Releases the lock
4. Monitors file watch paths and triggers agents when changes are detected
5. If a Telegram bot token is configured, connects via long-polling for interactive agents

### HTTP API

The server exposes a local API on port 47821 (configurable via `AGENT_SERVER_PORT`):

```bash
# List all agents
curl http://localhost:47821/agents

# Get a specific agent's config
curl http://localhost:47821/agents/daily-standup

# Trigger a run
curl -X POST http://localhost:47821/agents/daily-standup/run

# Trigger a run with extra context
curl -X POST http://localhost:47821/agents/daily-standup/run \
  -H 'Content-Type: application/json' \
  -d '{"with": "Focus on the Linear project X"}'

# List recent runs (in-memory, up to 200)
curl http://localhost:47821/runs

# Filter runs by agent
curl http://localhost:47821/runs?agent_id=daily-standup

# Get run details with progress messages
curl http://localhost:47821/runs/{runId}

# Health check
curl http://localhost:47821/health
```

The trigger endpoint returns `202 Accepted` with `{ "runId": "...", "agentId": "..." }`. The run executes asynchronously. Poll `/runs/{runId}` for status.

## Configuration

### Environment variables

The CLI loads `~/.agent-server/.env` at startup. Shell environment variables take precedence over the file.

| Variable | Default | Description |
|---|---|---|
| `AGENT_SERVER_AGENTS_DIR` | `~/.agent-server/agents` | Directory containing agent definition files |
| `AGENT_SERVER_LOCK_DIR` | `~/.agent-server/locks` | Lock file directory |
| `AGENT_SERVER_LOGS_DIR` | `~/.agent-server/logs` | Log directory |
| `AGENT_SERVER_CHECK_INTERVAL_MS` | `60000` | How often to check schedules (ms) |
| `AGENT_SERVER_PANEL_URL` | | Telemetry endpoint base URL (for Agent Panel) |
| `AGENT_SERVER_PANEL_API_KEY` | | API key for telemetry |
| `AGENT_SERVER_HEARTBEAT_MS` | `30000` | Heartbeat interval during runs (ms) |
| `AGENT_SERVER_PORT` | `47821` | HTTP API port |
| `AGENT_SERVER_TELEGRAM_BOT_TOKEN` | | Telegram bot token for interactive agents and notifications |
| `ANTHROPIC_API_KEY` | | Anthropic API key. Required for Telegram message routing (agent selection via Haiku). |

Example `~/.agent-server/.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
AGENT_SERVER_PANEL_URL=https://your-panel.vercel.app
AGENT_SERVER_PANEL_API_KEY=ap_live_...
AGENT_SERVER_TELEGRAM_BOT_TOKEN=7123456789:AAH...
```

### Claude Code and the Agent SDK

Agent Server uses the Claude Agent SDK to run Claude Code as a library. Each agent run calls `query()` with:

- The agent's prompt
- `maxTurns` from the agent config (default 20)
- `cwd` set to the agent's `working_directory` (default `$HOME`)
- `permissionMode` from the agent config (default `bypassPermissions`)
- `allowedTools` from the agent config (if specified)
- `disallowedTools` from the agent config (if specified)

The SDK process inherits the current environment, so Claude Code uses whatever MCP servers and permissions are configured in `~/.claude/settings.json`. For headless execution, MCP tool permissions must be pre-approved since there is no interactive prompt. Add them to your Claude Code settings:

```json
{
  "permissions": {
    "allow": [
      "mcp__claude_ai_Linear__*",
      "mcp__claude_ai_Slack__*",
      "mcp__claude_ai_Notion__*"
    ]
  }
}
```

### Telegram setup

The Telegram bot supports three modes: triggering agents via natural language, interactive agent conversations, and notifications.

1. Create a bot via [@BotFather](https://t.me/BotFather) and copy the token
2. Add the token to `~/.agent-server/.env`:
   ```
   AGENT_SERVER_TELEGRAM_BOT_TOKEN=7123456789:AAH...
   ```
3. Start the server with `agent-server start`. The bot connects via long-polling (no public IP needed).
4. Send `/start` to the bot on Telegram. This registers your chat ID and persists it to `~/.agent-server/telegram.json`.

**Triggering agents**: Send any message to the bot and it picks the right agent based on your message and the agents' descriptions. For example, "Check Bougainville in Lisbon tonight for 4" would match a restaurant-checker agent. The bot confirms which agent is running and sends the result when it finishes. Write clear `description` fields on your agents -- the router uses them to match messages to agents.

**Interactive agents**: Agents with `interaction.channel: telegram` send structured questions with inline keyboard buttons. Tapping a button triggers a follow-up agent.

**Notifications**: Agents with `notification.channel: telegram` send completion or failure messages.

### macOS auto-start

Install a LaunchAgent so Agent Server starts automatically on login:

```bash
agent-server install
launchctl load ~/Library/LaunchAgents/com.agent-server.daemon.plist

# To stop and remove:
launchctl unload ~/Library/LaunchAgents/com.agent-server.daemon.plist
agent-server uninstall
```

The LaunchAgent runs `agent-server start` with `KeepAlive: true` (restarts if it crashes) and logs to `~/.agent-server/logs/`.

## Monitoring with Agent Panel

Agent Server reports status events via HTTP POST to a configurable panel endpoint. Events follow the [A2A protocol](https://google.github.io/A2A/) status format.

Set `AGENT_SERVER_PANEL_URL` and `AGENT_SERVER_PANEL_API_KEY` to enable telemetry. If no panel URL is configured, a noop reporter is used and nothing is sent.

Events are POSTed to `{AGENT_SERVER_PANEL_URL}/api/runs/{runId}/status` with an `Authorization: Bearer {apiKey}` header.

### Events emitted during a run

**Start event** (sent when the agent begins):

```json
{
  "agent": "Weekly Priority Report",
  "state": "working",
  "timestamp": "2026-03-10T05:00:01.234Z"
}
```

**Progress events** (sent on each conversation turn):

```json
{
  "agent": "Weekly Priority Report",
  "state": "working",
  "message": "Using tool: mcp__claude_ai_Linear__list_projects",
  "timestamp": "2026-03-10T05:00:15.456Z",
  "metadata": {
    "turns_completed": 3,
    "tools_used": ["Read", "mcp__claude_ai_Linear__list_projects"],
    "files_written": [],
    "commands_run": 0
  }
}
```

**Heartbeat events** (sent every 30 seconds to signal liveness):

```json
{
  "agent": "Weekly Priority Report",
  "state": "working",
  "message": "heartbeat",
  "timestamp": "2026-03-10T05:00:31.000Z"
}
```

**Completion event** (sent when the agent finishes):

```json
{
  "agent": "Weekly Priority Report",
  "state": "completed",
  "timestamp": "2026-03-10T05:02:45.789Z",
  "result": {
    "summary": "Created Weekly Priority Report in Notion",
    "accomplishments": [
      "Wrote 1 file(s): ~/reports/weekly-2026-03-10.md",
      "Ran 3 command(s)",
      "Read 12 file(s)"
    ],
    "usage": {
      "turns": 15,
      "files_read": 12,
      "files_written": 1,
      "commands_run": 3
    }
  }
}
```

**Failure event** (sent when the agent errors):

```json
{
  "agent": "Weekly Priority Report",
  "state": "failed",
  "timestamp": "2026-03-10T05:01:12.345Z",
  "error": {
    "message": "Agent failed: error_during_execution"
  }
}
```

## Executor plugins

The default executor uses the Claude Agent SDK, but the system is pluggable. Agents can specify an `executor` field in their config to use a different backend:

```yaml
executor: codex  # defaults to 'claude-code' if omitted
```

Register custom executors programmatically:

```typescript
import { ExecutorRegistry, type ExecutorFn } from './execution/executor-registry.js';

const myExecutor: ExecutorFn = async (agent, reporter) => {
  // call any model, API, or process
  return {
    summary: 'Done',
    turnCount: 1,
    toolsUsed: [],
    filesRead: [],
    filesWritten: [],
    commandsRun: [],
  };
};

const registry = new ExecutorRegistry();
registry.register('my-executor', myExecutor);
```

## Architecture

```
src/
  agents/                    Agent definitions and scheduling
    config.ts                  Zod schema + YAML/frontmatter parser
    discovery.ts               Reads agent files (.yaml, .yml, .md)
    scheduler.ts               Cron expression evaluation (cron-parser v5)
    triggers.ts                Agent chaining (on_complete, on_failure)
    file-watcher.ts            File watch triggers with debounce and glob

  channels/                  Messaging channel adapters
    channel.ts                 Channel interface + ChannelReply type
    console.ts                 Console channel (readline, numbered options)
    telegram.ts                Telegram channel (grammy, long-polling, inline keyboards)
    router.ts                  LLM-powered message routing (picks agent from user message)
    dispatcher.ts              Routes messages to registered channels

  execution/                 Running agents
    executor.ts                Stream event parsing, tool metadata extraction, types
    executor-registry.ts       Plugin registry for swappable executors
    permissions.ts             Glob-based tool permission matching (canUseTool callback)
    runner.ts                  Orchestrates lock -> report -> execute -> release
    lockfile.ts                PID-based file locks with stale detection

  interaction/               Interactive agent support
    parser.ts                  Parses interaction blocks from agent output
    schema.ts                  InteractionRequest, InteractionConfig, NotificationConfig schemas
    notification.ts            Notification message formatting
    store.ts                   In-memory pending interaction store with expiry

  reporting/                 Telemetry and state
    reporter.ts                A2A telemetry reporter with heartbeat
    reporter-factory.ts        Creates real or noop reporter based on config
    store.ts                   In-memory run state store (max 200 runs)

  server/                    HTTP and daemon
    api.ts                     Hono HTTP API routes
    server.ts                  Combined HTTP server + scheduler + Telegram
    daemon.ts                  CLI-mode runner, list command

  platform/                  OS and environment
    config.ts                  ServerConfig from env vars + .env file
    launchd.ts                 macOS LaunchAgent plist generation
    init.ts                    Scaffolds ~/.agent-server/ with sample agent

  plugins/                   Executor implementations
    claude-code.ts             Claude Code executor (Agent SDK query())

  cli.ts                     Commander CLI entry point
  index.ts                   Barrel exports for library use
  test-factories.ts          Shared test data factories
```

## Development

```bash
npm install
npm test              # 294 tests
npm run type-check    # TypeScript strict mode
npm run build         # Compile to dist/
npm run dev           # Watch mode with tsx
```

Tests are colocated with source files (`*.test.ts`). The project uses TDD with factory functions for test data.

## Tech stack

- TypeScript strict mode, ES2022, ESM
- [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) for running Claude Code programmatically
- [Anthropic SDK](https://www.npmjs.com/package/@anthropic-ai/sdk) for message routing (agent selection via Haiku)
- [Zod](https://zod.dev/) for schema validation
- [cron-parser](https://github.com/harrisiirak/cron-parser) v5 for schedule evaluation
- [Hono](https://hono.dev/) for the HTTP API
- [Commander](https://github.com/tj/commander.js) for the CLI
- [grammy](https://grammy.dev/) for Telegram bot integration (long-polling)
- [dotenv](https://github.com/motdotla/dotenv) for `.env` file loading
- [Vitest](https://vitest.dev/) for testing

## Requirements

- Node.js 20+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## License

MIT
