# Agent Server

A lightweight orchestration server that runs local AI agents in the background using Claude Code, Codex, or Kimi Code. It includes a native macOS app for creating, monitoring, debugging, and reviewing agents.

## Consumer agent tools

The macOS app includes guided agent creation, plain-language run debugging, and local security analysis. See the [consumer feature guide](docs/CONSUMER_AGENT_TOOLS.md), [architecture](docs/CONSUMER_AGENT_ARCHITECTURE.md), [security threat model](docs/SECURITY_THREAT_MODEL.md), [manual test matrix](docs/MANUAL_TEST_MATRIX.md), and [Build Week summary](docs/BUILD_WEEK.md).

Define agents as Markdown or YAML files with cron schedules. Agent Server discovers them, runs them on schedule, prevents concurrent execution with file locks, and reports telemetry in [A2A](https://google.github.io/A2A/) format. Agents can request user input via Telegram, send completion notifications, chain to other agents, and trigger on file changes.

## Repository structure

```
agent-server/
  server-app/              # Node.js server, CLI, and agent runtime
    src/                   # TypeScript source
    dist/                  # Compiled output
    sample-agents/         # Example agent configs
    package.json
  macos-app/               # Native macOS menu bar app (Swift)
    AgentServer/
    project.yml            # xcodegen spec
  specs/                   # Product specs and App Store metadata
```

## How it works

Agent Server uses executor adapters for Claude Code, Codex, and Kimi Code. Each adapter streams structured runtime events and records tool usage, file operations, command metadata, and run results through the same lifecycle.

Agents can use local files, connected services, schedules, messaging channels, model selection, and runtime-specific tools. The shared permission, security, run-history, and debugger layers apply regardless of the selected executor.

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

### 1. Build the server

```bash
cd server-app
pnpm install
pnpm run build
```

### 2. Initialize the config directory

```bash
node dist/cli.js init
```

This creates `~/.agent-server/` with `agents/`, `locks/`, and `logs/` directories and a sample `hello-world.yaml` agent.

### 3. Configure environment variables

Static connection keys can be added to `~/.agent-server/.env`. Claude Code, Codex, and Kimi Code can use their existing local logins, so no cloud API key is required for core local use. The Agent Panel settings are optional.

```bash
ANTHROPIC_API_KEY=sk-ant-...
AGENT_SERVER_PANEL_URL=https://www.agentpanel.dev
AGENT_SERVER_PANEL_API_KEY=ap_live_...
AGENT_SERVER_TELEGRAM_BOT_TOKEN=7123456789:AAH...
```

If you use [Doppler](https://www.doppler.com/) for secret management, you can pull secrets directly:

```bash
doppler secrets download --project agent-server --config dev --no-file --format env \
  | grep -v '^DOPPLER_' > ~/.agent-server/.env
```

Or run the server through Doppler instead of using a `.env` file:

```bash
doppler run -- node dist/cli.js start
```

### 4. Add your agents

Agent definitions live in `~/.agent-server/agents/`. You can create files directly, or symlink to an existing directory:

```bash
# Option A: edit the sample agent
$EDITOR ~/.agent-server/agents/hello-world.yaml

# Option B: symlink to your own agents directory
rm -rf ~/.agent-server/agents
ln -s ~/path/to/your/agents ~/.agent-server/agents
```

### 5. Start the server

```bash
# Test a single agent
node dist/cli.js run hello-world

# Start the server (HTTP API + scheduler + Telegram)
node dist/cli.js start
```

### 6. (Optional) Use the macOS menu bar app

If you use the macOS app, it starts the server automatically. On first launch, open Settings and set the server location to the repo root (the directory containing `server-app/`). The app needs to know where the built server lives on disk.

The server reads `~/.agent-server/.env` once at startup. If you change the `.env` file, restart the server (right-click "Server status" in Settings, or quit and relaunch the app).

See [Server location](#server-location) for details on how the app finds the server.

## Creating agents

Agents live in `~/.agent-server/agents/`. Two formats are supported: Markdown with YAML frontmatter and pure YAML. You can create and edit agents from the macOS app or with any text editor.

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
| `prompt` | yes* | | The prompt sent to the selected executor. *In frontmatter format, the Markdown body is the prompt. |
| `max_turns` | no | `AGENT_SERVER_DEFAULT_MAX_TURNS` (default `20`) | Maximum Claude Code or Codex agentic turns. Kimi Code manages its own ACP session. |
| `working_directory` | no | `$HOME` | Working directory for the executor session. Supports `~`. |
| `tools` | no | `[]` | Allowed tools list. Claude Code receives the list directly; Kimi Code enforces it when ACP asks for tool permission. |
| `disallowed_tools` | no | `[]` | Tools to explicitly deny. Deny rules take precedence. |
| `permissions` | no | | Fine-grained tool permissions with glob patterns. See [tool permissions](#example-tool-permissions). |
| `permission_mode` | no | `bypassPermissions` | Claude Code SDK permission mode. For Codex, `plan` maps to a read-only sandbox and all other modes map to `workspace-write`. Kimi Code uses explicit permission rules. |
| `enabled` | no | `true` | Whether the scheduler runs this agent |
| `executor` | no | `claude-code` | Which executor plugin to use: `claude-code`, `codex`, or `kimi-code` |
| `codex_sandbox` | no | `workspace-write` | Codex-only sandbox override: `read-only`, `workspace-write`, or `danger-full-access` |
| `model` | no | | Optional model override passed to Codex or selected in a Kimi Code ACP session |
| `on_complete` | no | | Agents to trigger on successful completion |
| `on_failure` | no | | Agents to trigger on failure |
| `watch` | no | | File paths to watch for changes (triggers runs outside the cron schedule) |
| `interaction` | no | | Interactive agent config (channel, on_reply, timeout) |
| `mcp_servers` | no | | Additional MCP servers for this agent (see [MCP servers](#mcp-servers)) |
| `notification` | no | | Notification config (channel, on_complete, on_failure) |
| `output` | no | | Optional reviewed output contract. See [required output contracts](#required-output-contracts). |

### Required output contracts

An output contract prevents an agent from reporting success when a required service action did not finish. Enforcement is opt-in. Set `output.primary.required: true` only when every normal run must create or update the result. Conditional workflows, such as "publish only when the source changed," should omit `required` or set it to `false` so a valid no-change run can complete.

```yaml
output:
  primary:
    description: Create one report in the approved destination
    tool: mcp__reports__create_item
    update_tool: mcp__reports__update_item
    required: true
    successful_calls:
      min: 1
      max: 1
    target_match:
      field: destination
      equals: approved_reports
```

`tool` is the exact creation tool that satisfies the contract. `update_tool` is an optional exact alternative for workflows that may update an existing result. `successful_calls` sets the accepted number of successful matching calls and defaults to a minimum of one. Failed calls never count.

`target_match` checks the structured tool input recursively, including nested objects and arrays, for the named field and exact value. Use it to confirm that the reviewed destination was used. Tool inputs, outputs, and matched target values are inspected in memory and are not added to run history or error messages.

Safe test runs bypass required-output enforcement because external services are disabled. For a normal run, an unmet contract fails with the stable code `output_contract_unmet`; the debugger uses that code to explain the missing result without exposing technical payloads.

### Limit runaway agent loops

Yes—set `max_turns` on each agent to hard-cap the number of SDK turns for a run.

```yaml
id: bounded-agent
name: Bounded Agent
prompt: |
  Complete the task and return the best final answer when you run out of turns.
max_turns: 50
```

When the cap is reached, the run stops and returns the model's current result instead of continuing indefinitely.

If you want this to apply to agents that omit `max_turns`, set a server-wide default:

```bash
AGENT_SERVER_DEFAULT_MAX_TURNS=50
```

Agent-level `max_turns` still takes precedence when explicitly set in an agent definition.

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
cd server-app
pnpm exec tsx src/cli.ts run dependency-audit
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
agent-server run restaurant-booker --with "Book Bougainville, 20:30, 4 guests"
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

### MCP servers

Agents can bring their own MCP servers beyond what's configured in your claude.ai account or Claude Code settings. This is useful when you need multiple instances of the same MCP server (e.g., personal and work Notion) or servers that aren't available through claude.ai.

Agent-level MCP servers coexist with account-level servers. Your claude.ai MCP servers (Slack, Linear, work Notion, etc.) remain available as `mcp__claude_ai_*` tools. Agent-level servers appear under the name you give them (e.g., `mcp__notion-personal__*`).

Three transport types are supported: stdio (local process), SSE, and HTTP.

#### Example: personal Notion alongside work Notion

Your work Notion is already connected via claude.ai. To also access a personal Notion workspace, add an `mcp_servers` block with a separate integration token:

```yaml
id: daily-focus
name: Daily Focus List
schedule: "0 5 * * 2-6"
mcp_servers:
  notion-personal:
    command: npx
    args: ["-y", "@notionhq/notion-mcp-server"]
    env:
      NOTION_TOKEN: "${NOTION_PERSONAL_API_KEY}"
permissions:
  allow:
    - "mcp__claude_ai_Notion__notion-search"      # work Notion (from claude.ai)
    - "mcp__notion-personal__notion-search"        # personal Notion (from mcp_servers)
    - "mcp__notion-personal__notion-create-pages"
```

The agent now has read access to work Notion and read/write access to personal Notion, each authenticated separately.

#### Built-in: Calendar and Reminders via EventKit

When the server is launched by the macOS app, it automatically gets an `eventkit` MCP server injected into every agent run. No YAML configuration needed. This is backed by a bundled Swift helper binary (`agent-server-eventkit`) that speaks MCP over stdio and calls Apple's EventKit framework directly.

Tools exposed by the helper:

| Tool | Description |
|---|---|
| `list_calendars` | List available calendars |
| `list_events` | List events in a date range, optionally filtered by calendar |
| `create_event` | Create a new event (title, start, end, location, notes, calendar, isAllDay) |
| `update_event` | Update fields on an existing event by id |
| `delete_event` | Delete an event by id |
| `list_reminder_lists` | List reminder lists |
| `list_reminders` | List reminders, optionally filtered by list and completion state |
| `create_reminder` | Create a new reminder (title, due date, list, notes) |
| `complete_reminder` | Mark a reminder completed by id |

On first launch, the macOS app requests Calendar and Reminders access from the system. Agents call the tools as `mcp__eventkit__list_events`, `mcp__eventkit__create_reminder`, etc. If an agent explicitly declares its own `eventkit` MCP server under `mcp_servers`, the agent's configuration wins and the bundled helper is not injected.

This integration only works when the server is spawned by the macOS app (the app sets `AGENT_SERVER_EVENTKIT_BIN` at spawn time). Running `agent-server start` directly from the CLI does not enable it.

#### Environment variable substitution

Values in `env` and `headers` fields support `${VAR}` substitution, resolved from `process.env` at runtime. This includes variables from `~/.agent-server/.env` and from secret managers like Doppler (`doppler run -- agent-server start`).

```yaml
mcp_servers:
  my-server:
    command: node
    args: ["./my-server.js"]
    env:
      API_KEY: "${MY_API_KEY}"           # resolved from process.env
      DB_URL: "${DATABASE_URL}"          # from .env or Doppler
```

Undefined variables resolve to an empty string.

#### SSE and HTTP transports

For remote MCP servers:

```yaml
mcp_servers:
  remote-tools:
    type: sse
    url: https://mcp.example.com/sse
    headers:
      Authorization: "Bearer ${REMOTE_TOKEN}"
  another-service:
    type: http
    url: https://api.example.com/mcp
```

Headers also support `${VAR}` substitution.

## Running agents

### CLI

All CLI commands run from the `server-app/` directory:

```bash
cd server-app
pnpm exec tsx src/cli.ts init                          # Create ~/.agent-server/ with sample agent
pnpm exec tsx src/cli.ts start                         # Start server (HTTP API + scheduler)
pnpm exec tsx src/cli.ts run <agentId>                 # Run an agent immediately
pnpm exec tsx src/cli.ts run <agentId> --with "context" # Run with extra context appended to prompt
pnpm exec tsx src/cli.ts list                          # List all discovered agents
pnpm exec tsx src/cli.ts install                       # Install macOS LaunchAgent for auto-start
pnpm exec tsx src/cli.ts uninstall                     # Remove macOS LaunchAgent
```

After building (`pnpm run build`), the CLI is also available as:

```bash
agent-server start
agent-server run daily-standup
agent-server list
```

### Server mode

`agent-server start` runs both the HTTP API and the cron scheduler in a single process:

1. Starts the HTTP API and WebSocket server on port 47821 (configurable)
2. Checks agent schedules every 60 seconds (configurable)
3. For each agent whose cron expression matches the current minute:
   - Acquires a PID-based file lock (skips if already running)
   - Creates a telemetry reporter (or a noop reporter if no panel is configured)
   - Calls the Agent SDK's `query()` with the agent's prompt and configuration
   - Iterates over the SDK message stream, extracting tool usage, files read/written, and commands run
   - Broadcasts progress events via WebSocket and reports to the telemetry endpoint on every turn
   - Sends heartbeats every 30 seconds to signal liveness
   - On completion, reports the result, sends notifications, and fires downstream triggers (`on_complete`/`on_failure`)
   - Releases the lock
4. Monitors file watch paths and triggers agents when changes are detected
5. If a Telegram bot token is configured, connects via long-polling for interactive agents
6. Detects sleep/wake gaps and triggers missed agents (when `AGENT_SERVER_CATCH_UP=true`)
7. Sweeps expired interactions every 60 seconds and cleans up stale Telegram messages

### HTTP API

The server exposes a local API on `127.0.0.1:47821` by default (configurable via `AGENT_SERVER_HOST` and `AGENT_SERVER_PORT`):

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

# Cancel a running agent
curl -X POST http://localhost:47821/runs/{runId}/cancel

# Health check
curl http://localhost:47821/health

# WebSocket for real-time run progress
wscat -c ws://localhost:47821/ws
```

The trigger endpoint returns `202 Accepted` with `{ "runId": "...", "agentId": "..." }`. The run executes asynchronously. Poll `/runs/{runId}` for status, or connect to the WebSocket for real-time events.

`AGENT_SERVER_API_KEY` is required for every server start. `agent-server init` generates a local key automatically and stores it in `~/.agent-server/.env`. All API endpoints except `/health` require authentication via one of these headers:

- `x-agent-server-key: <your-key>`
- `Authorization: Bearer <your-key>`

For safety, the server now refuses to bind to non-loopback hosts unless `AGENT_SERVER_API_KEY` is set.

The server also applies a secure-enough-soon control set by default:
- API rate limiting
- temporary auth-failure lockouts
- security response headers
- run/event output redaction for common secret patterns

### Cancelling runs

`POST /runs/:id/cancel` aborts a running agent by calling `AbortController.abort()` on the underlying SDK process. Returns `200` with `{ "status": "cancelled", "runId": "..." }` on success, `409` if the run is not in `running` state.

### WebSocket streaming

Connect to `ws://localhost:47821/ws` for real-time run events. Events are JSON objects with type `run_started`, `run_progress`, `run_completed`, or `run_failed`:

```json
{
  "type": "run_progress",
  "runId": "abc-123",
  "agentId": "daily-standup",
  "timestamp": "2026-03-10T09:00:15.456Z",
  "message": "Using tool: mcp__claude_ai_Linear__list_issues"
}
```

## Configuration

### Environment variables

The CLI loads `~/.agent-server/.env` at startup. Shell environment variables take precedence over the file.

| Variable | Default | Description |
|---|---|---|
| `AGENT_SERVER_HOME` | `~/.agent-server` | Base directory for default agent, lock, log, database, and environment-file paths |
| `AGENT_SERVER_AGENTS_DIR` | `~/.agent-server/agents` | Directory containing agent definition files |
| `AGENT_SERVER_LOCK_DIR` | `~/.agent-server/locks` | Lock file directory |
| `AGENT_SERVER_LOGS_DIR` | `~/.agent-server/logs` | Log directory |
| `AGENT_SERVER_RUN_DB` | `~/.agent-server/runs.db` | SQLite run-history database. Use `:memory:` for ephemeral runs. |
| `AGENT_SERVER_CHECK_INTERVAL_MS` | `60000` | How often to check schedules (ms) |
| `AGENT_SERVER_PANEL_URL` |  | Telemetry endpoint base URL (for Agent Panel) |
| `AGENT_SERVER_PANEL_API_KEY` |  | API key for telemetry |
| `AGENT_SERVER_PANEL_ENABLED` | `true` | Set to `false` to disable all panel traffic while retaining saved credentials |
| `AGENT_SERVER_API_KEY` | generated by `agent-server init` | Required local API key with a minimum of 16 characters |
| `AGENT_SERVER_HEARTBEAT_MS` | `30000` | Heartbeat interval during runs (ms) |
| `AGENT_SERVER_TELEMETRY_PROGRESS_MODE` | `live` | Send sampled live progress or defer progress until the terminal payload (`live` or `batched`) |
| `AGENT_SERVER_TELEMETRY_PROGRESS_SAMPLE_MS` | `5000` | Minimum interval between live progress posts (ms) |
| `AGENT_SERVER_TELEMETRY_PROGRESS_MAX_ENTRIES` | `50` | Maximum accumulated progress entries per run |
| `AGENT_SERVER_TELEMETRY_PROGRESS_INCLUDE_METADATA` | `false` | Include full metadata on stored progress entries |
| `AGENT_SERVER_PORT` | `47821` | HTTP API port |
| `AGENT_SERVER_HOST` | `127.0.0.1` | HTTP bind host |
| `AGENT_SERVER_TELEGRAM_BOT_TOKEN` |  | Telegram bot token for interactive agents and notifications |
| `AGENT_SERVER_TELEGRAM_CHAT_ID` |  | Optional Telegram chat ID restriction |
| `AGENT_SERVER_SLACK_BOT_TOKEN` |  | Slack bot token. `SLACK_BOT_TOKEN` is also accepted. |
| `AGENT_SERVER_SLACK_APP_TOKEN` |  | Slack Socket Mode app token. `SLACK_APP_TOKEN` is also accepted. |
| `AGENT_SERVER_LOCATION` |  | Path to the agent-server repo root. Used by the macOS app to find the server. |
| `AGENT_SERVER_CATCH_UP` | `false` | Resume missed scheduled agents after sleep/wake |
| `AGENT_SERVER_MAX_CONCURRENT_RUNS` | `8` | Maximum concurrent running agents before new triggers are rejected |
| `AGENT_SERVER_MAX_TRIGGER_DEPTH` | `10` | Maximum number of outgoing agent-to-agent trigger edges in one branch |
| `AGENT_SERVER_MAX_WS_CLIENTS` | `100` | Maximum simultaneous WebSocket clients |
| `AGENT_SERVER_RUN_TIMEOUT_MS` | `1800000` | Default wall-clock run timeout in milliseconds. Set to `0` to disable. |
| `AGENT_SERVER_DEFAULT_MAX_TURNS` | `20` | Default `max_turns` used when an agent omits `max_turns` |
| `AGENT_SERVER_PROMPT_INJECTION_GUARD` | `true` | Wrap untrusted user context in guarded delimiters and policy instructions before execution |
| `AGENT_SERVER_PROMPT_INJECTION_STRICT` | `false` | Reject suspicious user context (pattern-based) before execution |
| `AGENT_SERVER_USE_INSTALLED_CLAUDE` | `true` | Set to `false` to use the Claude Agent SDK's bundled runtime |
| `AGENT_SERVER_CLAUDE_PATH` |  | Exact path to the Claude Code executable |
| `AGENT_SERVER_USE_INSTALLED_CODEX` | `true` | Set to `false` to use the Codex SDK's bundled runtime |
| `AGENT_SERVER_CODEX_PATH` |  | Exact path to the Codex executable |
| `AGENT_SERVER_USE_INSTALLED_KIMI` | `true` | Set to `false` to turn off installed Kimi Code discovery |
| `AGENT_SERVER_KIMI_PATH` |  | Exact path to the `kimi` executable. An invalid explicit path fails closed. |
| `ANTHROPIC_API_KEY` |  | Anthropic API key. Required for Telegram message routing (agent selection via Haiku). |

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
- `maxTurns` from the agent config (falls back to `AGENT_SERVER_DEFAULT_MAX_TURNS`, default 20)
- `cwd` set to the agent's `working_directory` (default `$HOME`)
- `permissionMode` from the agent config (default `bypassPermissions`)
- `allowedTools` from the agent config (if specified)
- `disallowedTools` from the agent config (if specified)

The SDK process inherits the current environment, so Claude Code uses whatever MCP servers and permissions are configured in `~/.claude/settings.json`. Agents can also declare additional MCP servers via the `mcp_servers` config field, which are passed to the SDK alongside account-level servers (see [MCP servers](#mcp-servers)).

For headless execution, MCP tool permissions must be pre-approved since there is no interactive prompt. Add them to your Claude Code settings:

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


### Prompt-injection safeguards

For Telegram/API-triggered context, Agent Server can wrap user-provided content in an explicit untrusted block and add policy text instructing the model to treat it as data, not instructions.

- `AGENT_SERVER_PROMPT_INJECTION_GUARD=true` (default) enables this behavior.
- `AGENT_SERVER_PROMPT_INJECTION_STRICT=true` rejects suspicious user context before execution (for high-security setups).

Strict mode is opt-in because it may block legitimate automation prompts that contain security-like language.

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

## macOS menu bar app

A native Swift app that lives in the menu bar for monitoring and controlling agents. No third-party dependencies.

### Features

- **Menu bar monitoring**: Icon shows server status at a glance. Turns yellow when agents are actively running. Dropdown shows active runs and scheduled agent count.
- **Real-time updates**: Connects to the server via WebSocket (`ws://localhost:47821/ws`) for instant run progress. Falls back to HTTP polling if WebSocket disconnects.
- **Native notifications**: Fires a macOS notification when any agent starts, completes, or fails. Completion notifications include a brief summary from the agent's final message. Uses `UNUserNotificationCenter` and prompts for authorization on first launch.
- **Calendar and Reminders integration**: Bundled `agent-server-eventkit` helper binary exposes EventKit to agents through a stdio MCP server. Every agent run gets automatic access to tools like `list_events`, `create_event`, `list_reminders`, and `create_reminder`. Calendar and Reminders permissions are requested on first launch via `EKEventStore.requestFullAccess*`.
- **Agent list**: All discovered agents with kind-based icons and colors (scheduled, interactive, watcher, chained, on-demand). Disabled agents show a "Disabled" pill.
- **Agent editor**: View and edit agent definition files with Markdown and YAML syntax highlighting. Save with Cmd+S. Enable/disable agents with a toggle.
- **Create agents**: Create new agents from Markdown or YAML templates directly from the app.
- **Run and cancel agents**: Trigger any agent from the agent list with a single click. Cancel running agents via the API.
- **Environment editor**: Edit `~/.agent-server/.env` with a key-value editor. Contextual icons for each variable type.
- **Server settings**: View server status, agent count, launch-at-login toggle, sleep/wake catch-up toggle, and app version.
- **Bundled server**: The compiled `server-app/dist/`, `package.json`, and production `node_modules/` are copied into `Contents/Resources/` at build time. The app launches the Node server immediately on first run — no pnpm install step, no network required, code signing stays valid because nothing is written inside the bundle post-signing.

### Build

Requires Xcode 15+, [xcodegen](https://github.com/yonaskolb/XcodeGen), and Node.js 20+ on PATH (needed at build time to stage production dependencies):

```bash
cd macos-app
xcodegen generate
xcodebuild -project AgentServer.xcodeproj -scheme AgentServer build
```

Or open `AgentServer.xcodeproj` in Xcode after running `xcodegen generate`.

The first build runs `pnpm install --frozen-lockfile --omit=dev` in `macos-app/.build-cache/server-bundle/` to stage the production `node_modules/` that gets bundled into `Contents/Resources/`. Subsequent builds skip the install step when `server-app/package-lock.json` is unchanged (detected via a cached SHA-256 hash). `.build-cache/` is gitignored.

### Architecture

```
macos-app/
  AgentServer/
    App/
      AgentServerApp.swift            @main entry point
      AppDelegate.swift               NSStatusBar, NSMenu, window management
    Models/
      AgentModel.swift                Agent type, AgentKind enum with icons/colors
      RunModel.swift                  Run, HealthResponse, TriggerResponse types
      EnvFile.swift                   ~/.agent-server/.env reader/writer
      AgentFile.swift                 Agent file CRUD + templates
    Services/
      AgentServerClient.swift         HTTP client for localhost:47821
      StatusMonitor.swift             WebSocket + HTTP polling, fires notifications on run lifecycle events
      ServerProcessManager.swift      Auto-start/stop the Node.js server, exports AGENT_SERVER_EVENTKIT_BIN
      NotificationManager.swift       UNUserNotificationCenter wrapper for run lifecycle notifications
      EventKitPermissionManager.swift Requests Calendar and Reminders access at launch
      LaunchAtLoginManager.swift      SMAppService wrapper
    Views/
      SettingsView.swift              Tab container (Agents, Settings)
      AgentsListView.swift            NavigationSplitView with agent list + editor
      AgentEditorView.swift           File editor with toolbar and enable toggle
      MarkdownEditor.swift            NSTextView with syntax highlighting
      SettingsTabView.swift           Server status, launch at login, catch-up toggle, env editor
      EnvEditorView.swift             Key-value editor with contextual icons
    Assets.xcassets/                  App icon + menu bar icons
    Info.plist                        App metadata + TCC usage descriptions
  AgentServerEventKit/                Separate target: standalone Swift MCP helper binary
    main.swift                        Entry point
    MCPServer.swift                   JSON-RPC 2.0 stdio MCP server implementation
    EventKitHandler.swift             Calendar and Reminders tool handlers via EventKit
    Info.plist                        Embedded into binary for TCC usage descriptions
  project.yml                         xcodegen spec (two targets)
```

The app communicates with the server entirely through the HTTP API on `localhost:47821`. If no server is running, `ServerProcessManager` starts the Node.js server automatically and stops it on quit. When spawning the server, it exports `AGENT_SERVER_EVENTKIT_BIN` pointing at the bundled helper so the server's executor plugin can auto-inject the `eventkit` MCP server into every agent run.

### Server location

The macOS app needs to know where the agent-server code lives on disk so it can start the Node.js process. It looks for `dist/cli.js` in these locations, in order:

1. **macOS app Settings** (highest priority). Open Settings and use the "Choose..." button under "Server location" to pick the repo root folder. This is stored in UserDefaults and persists across app launches.
2. **`AGENT_SERVER_LOCATION` in `~/.agent-server/.env`**. Set this if you want the location configured once for both the macOS app and any scripts that need it.
3. **Bundled server**. The app checks its own Resources bundle at `Contents/Resources/dist/cli.js` (used in standalone distribution).
4. **Bundle-adjacent**. The app checks for an `agent-server/` directory next to the `.app` bundle.

If you cloned the repo to a non-standard location, set `AGENT_SERVER_LOCATION` either in the app's Settings UI or in `~/.agent-server/.env`. The value should point to the repo root (the directory containing `server-app/`). Pointing directly at `server-app/` also works.

When both Settings and `.env` have a value, Settings wins. To fall back to `.env` or auto-detection, click "Clear" in Settings.

Target: macOS 14.0+, Swift 5.9+.

### Deployment

Full release flow from source to a distributable DMG. Every step has to happen in order; skipping any of them produces a DMG that either won't launch on other Macs or gets blocked by Gatekeeper.

#### Prerequisites (one-time)

- A **paid** Apple Developer account (free personal teams cannot issue Developer ID certs).
- A **Developer ID Application** certificate in your login Keychain, with its paired private key. Verify in Keychain Access → **My Certificates** (not "All Items"): the cert must have a disclosure triangle expanding to a private key. If it doesn't, Xcode → Settings → Accounts → your team → **Manage Certificates…** → **+** → **Developer ID Application**. This must be done *on the Mac you're building from* so the CSR's private key lives locally.
- `brew install create-dmg`.
- An app-specific password for notarization, stored in the keychain once:
  ```bash
  xcrun notarytool store-credentials agent-server-notary \
    --apple-id "you@example.com" \
    --team-id "955GSY56UT" \
    --password "app-specific-password-from-appleid.apple.com"
  ```

> A note on signing UX: certs are scattered across Keychain, Xcode Settings, target settings, and the Organizer, each showing a different subset depending on build config and phase of the moon. "Sign to Run Locally" appearing as a first-class option next to real certs is peak Xcode. The Developer ID cert only shows up at the **Archive → Distribute** stage, not in the regular target's Signing & Capabilities dropdown. That's expected, not a bug.

#### 1. Rebuild the server

Any change under `server-app/` must be compiled before building the app, because the macOS app bundles `server-app/dist/` at build time.

```bash
cd server-app
pnpm run type-check
pnpm test
pnpm run build
```

#### 2. Archive the macOS app

```bash
cd ../macos-app
xcodegen generate
```

Then in Xcode:

1. Open `AgentServer.xcodeproj`.
2. Scheme → **AgentServer**, destination → **Any Mac**.
3. **Product → Scheme → Edit Scheme → Archive → Build Configuration** must be **Release**.
4. **Product → Archive**. Wait for the Organizer to open.

The `preBuildScripts` phase stages production `node_modules/` in `.build-cache/server-bundle/` the first time (or whenever `package-lock.json` changes). The post-build phase embeds `agent-server-eventkit` into `Contents/Helpers/` and re-signs vendored Mach-O binaries inside `node_modules/` with the hardened runtime.

#### 3. Export with Developer ID

In the Organizer:

1. Select the archive → **Distribute App**.
2. Choose **Direct Distribution** (or **Developer ID** in older Xcode versions).
3. Pick the **Developer ID Application** cert. This is the step where it finally appears in the dropdown.
4. Choose whether to let Xcode notarize automatically (slower, but done) or export unnotarized (faster, you notarize the DMG in step 5).
5. Export to a folder (e.g. `~/Desktop/AgentServer-export/`). You get `Agent Server.app`.

Verify the signature:

```bash
codesign --verify --deep --strict --verbose=2 ~/Desktop/AgentServer-export/"Agent Server.app"
spctl --assess --type execute --verbose ~/Desktop/AgentServer-export/"Agent Server.app"
```

#### 4. Build the DMG

```bash
cd /path/to/agent-server
./scripts/build-dmg.sh ~/Desktop/AgentServer-export/"Agent Server.app" 1.0.0
```

Output lands at `dist/AgentServer-1.0.0.dmg`. The script uses `create-dmg` with a custom background (`macos-app/dmg-assets/background.tiff`) and drop-zones for the app and an `/Applications` symlink. If you edit the background PNG, update the drop-zone coordinates at the bottom of `scripts/build-dmg.sh`.

#### 5. Notarize the DMG (if not auto-notarized)

Notarize the DMG so Gatekeeper stops blocking it. Stapling embeds the ticket into the DMG so users can launch offline.

```bash
xcrun notarytool submit dist/AgentServer-1.0.0.dmg \
  --keychain-profile agent-server-notary \
  --wait

xcrun stapler staple dist/AgentServer-1.0.0.dmg
xcrun stapler validate dist/AgentServer-1.0.0.dmg
```

If `notarytool` returns `Invalid`, pull the log:

```bash
xcrun notarytool log <submission-id> --keychain-profile agent-server-notary
```

Common failures: an unsigned Mach-O binary inside `node_modules/` (the post-build script should have re-signed them — rebuild and check the build log for "Re-signed N Mach-O binaries"), or the hardened runtime missing on the helper.

#### 6. Sanity check on a clean Mac

Copy the DMG to a machine that has never run the app before. Mount, drag to Applications, launch. First launch should show the standard "downloaded from the internet" prompt but **not** "cannot be opened because the developer cannot be verified" — that second message means notarization failed or didn't staple.

Expect the usual macOS permission prompts on first run: Calendars, Reminders, Notifications. They use the usage descriptions from `Info.plist`.

## Releasing updates

The macOS app ships with [Sparkle 2](https://sparkle-project.org) for auto-updates. Every running copy checks an appcast hourly and prompts the user when a new version is available.

The full release pipeline is automated. One command cuts a release:

```bash
./scripts/release.sh 1.0.3 "<li>Fix cron parsing bug.</li><li>New agent template.</li>"
```

That command bumps the version, archives in Xcode, exports a signed `.app`, notarizes it, builds a signed+notarized+stapled DMG, Sparkle-signs the DMG, uploads both the DMG and updated appcast to Supabase Storage, and verifies everything resolves through the Dub shortlink.

### Architecture

```
Running app                Dub shortlink                 Supabase Storage
(Info.plist SUFeedURL) →   coolasspuppy.com/        →    hlwjnusdotqtmtwrjidu/
                           agent-server-updates          downloads/appcast.xml
                                                         downloads/AgentServer-*.dmg
```

Why a shortlink: the feed URL is baked into every shipped app's `Info.plist` and can never be changed. Dub lets you repoint the destination to a different host later (R2, S3, GitHub Releases) by editing one link. The DMG URLs in the appcast point directly at Supabase — no need to shortlink them because the appcast is rewritten on every release anyway.

Why Supabase: egress is cheap at our scale, the `downloads` bucket is public so Sparkle reaches it without auth, and we already store the service-role key in Doppler for uploads.

### One-time setup

These steps are done once per project. If you're taking over an existing setup, you only need step 4.

**1. Generate the Ed25519 signing key.** Download Sparkle tools, generate a key pair, back up the private key, put the public key in `Info.plist`.

```bash
# Download Sparkle tools
curl -L https://github.com/sparkle-project/Sparkle/releases/download/2.6.4/Sparkle-2.6.4.tar.xz | tar -xJ -C /tmp
mkdir -p ~/bin/sparkle
cp /tmp/bin/{generate_keys,sign_update,generate_appcast} ~/bin/sparkle/

# Generate the key pair. Private key lives in your login keychain.
# Public key is printed — paste it into macos-app/AgentServer/Info.plist under SUPublicEDKey.
~/bin/sparkle/generate_keys

# Back up the private key. If you lose it, every installed copy is stranded.
~/bin/sparkle/generate_keys -x ~/sparkle-private-key-backup.txt
# Then: paste the contents into 1Password as a secure note, delete the file.
```

**2. Create the Supabase `downloads` bucket.** In the Supabase dashboard: Storage → New bucket → name `downloads`, set Public ON, raise the file size limit to 200 MB. Upload an empty placeholder `appcast.xml` with just the `<channel>` wrapper (the release script prepends `<item>` entries).

**3. Create a Dub shortlink.** Destination: the Supabase appcast URL. Short URL: something stable you won't want to change. Cloaking/frame OFF. Put this shortlink in `Info.plist` under `SUFeedURL`. You can repoint the destination URL later; the slug is forever.

**4. Set up the notarytool profile, Doppler secret, and Sparkle tools on your machine.**

```bash
# App-specific password from appleid.apple.com → Sign-In and Security → App-Specific Passwords
xcrun notarytool store-credentials "agent-server" \
  --apple-id "you@example.com" \
  --team-id "YOURTEAMID" \
  --password "xxxx-xxxx-xxxx-xxxx"

# Verify you can pull the Supabase key
doppler secrets get SB_AGENT_PANEL_SERVICE_ROLE_KEY --project agent-server --config prd --plain

# Confirm Sparkle tools are installed
ls ~/bin/sparkle/  # generate_keys, sign_update, generate_appcast
```

### Per-release flow

```bash
./scripts/release.sh 1.0.3 "<li>Release note one.</li><li>Release note two.</li>"
```

The script runs these steps in order. Any failure aborts immediately.

1. **Bump version** in `macos-app/project.yml` (`MARKETING_VERSION` → new value, `CURRENT_PROJECT_VERSION` → current + 1). The Info.plist uses `$(MARKETING_VERSION)` and `$(CURRENT_PROJECT_VERSION)` variable substitution, so Xcode and the runtime pick these up automatically.
2. **Regenerate** the Xcode project with xcodegen.
3. **Archive** with `xcodebuild archive` in Release configuration.
4. **Export** a Developer ID signed `.app` from the archive (using `scripts/export-options.plist`).
5. **Notarize + staple** the `.app`. Blocks until Apple returns "Accepted", then staples the ticket.
6. **Build the DMG** via `scripts/build-dmg.sh`: create-dmg with the background art, codesign the DMG with Developer ID, submit for notarization, staple, verify with Gatekeeper (`spctl`), then Sparkle-sign it. Produces `dist/AgentServer-<version>.dmg` and `dist/AgentServer-<version>.sparkle.txt`.
7. **Fetch the Supabase service-role key** via `doppler secrets get SB_AGENT_PANEL_SERVICE_ROLE_KEY --project agent-server --config prd`.
8. **Upload the DMG** to the `downloads` bucket via Supabase's Storage REST API with both `Authorization: Bearer` and `apikey` headers (required by the new `sb_secret_*` key format).
9. **Prepend a new `<item>`** to `dist/appcast.xml` with the RFC 822 pub date, new version/build, release notes, and the `edSignature` + `length` from the Sparkle signing step. Upload the updated appcast.
10. **Verify** the uploaded DMG size matches what Sparkle signed and the Dub shortlink resolves to the new appcast.

Wall time: ~5–8 minutes, most of it spent waiting for Apple's notary service.

After the script finishes, commit `macos-app/project.yml` + `dist/appcast.xml` + any code changes. The DMG is gitignored.

### What installed apps see

All previously-installed copies check the appcast every 24 hours in the background, or immediately when the user clicks **Agent Server → Check for Updates…** in the app menu. Sparkle 2 handles the whole download → verify signature → mount DMG → swap `.app` → relaunch flow.

When `./scripts/release.sh` finishes uploading the new appcast, the following things happen without any further action:

- The `agent-panel` website (`web/app/agent-server/page.tsx`) fetches the appcast on the server with a 5-minute revalidate window. The download button's `href` and the visible version label update automatically within 5 minutes.
- Running copies of Agent Server pick up the new version on their next scheduled check.

### Troubleshooting

- **`source=no usable signature` after notarization**: the DMG wasn't codesigned before notarization. Check that `scripts/build-dmg.sh` runs `codesign --force --sign "$SIGN_IDENTITY" --timestamp` before `notarytool submit`.
- **`Invalid Compact JWS` on upload**: Supabase's new `sb_secret_*` key format needs both `Authorization: Bearer` and `apikey` headers. The release script sets both.
- **Website still shows the old version**: Vercel's edge cache matches Next.js's `revalidate: 300`, so the first visitor after the 5-minute window triggers a re-render. Until then, `curl -sI` on the page shows `age:` counting up and `x-vercel-cache: HIT`. Either wait or purge the cache from the Vercel dashboard.
- **`Cannot find generate_keys`**: the Sparkle tools aren't in `~/bin/sparkle/`. Re-run the download in setup step 1, or point `SPARKLE_SIGN_UPDATE` at your preferred location.
- **Sparkle won't relaunch after install (a "pop" sound)**: macOS `NSBeep` — `NSApp.terminate` was blocked by an open sheet. `UpdaterManager.updaterWillRelaunchApplication` dismisses all sheets before terminate to handle this. If you reintroduce a modal somewhere, make sure it's dismissable from that delegate callback.
- **`notarytool` says "Invalid Credentials"**: the keychain profile expired (app-specific passwords rotate). Regenerate one at appleid.apple.com and re-run `xcrun notarytool store-credentials "agent-server" …`.

### Rolling back

Never amend a released `<item>` entry — some clients may already have it cached. To retract a bad release, ship the next version with a fix. If you absolutely must make an installed app downgrade to a prior version, you'd need to bump the build number and ship the old source tree with a new version string — painful, which is why you just fix forward.

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

### Codex executor

The built-in Codex executor uses the official `@openai/codex-sdk`. The SDK runs a compatible local Codex runtime and emits typed streaming events for progress, tool calls, usage, and the final response.

Authenticate once with your ChatGPT account before starting Agent Server:

```bash
codex login
codex login status
```

Choose **Sign in with ChatGPT** in the browser flow. This uses Codex access included with your ChatGPT subscription. Agent Server gives the Codex child a small process environment containing only runtime variables such as `HOME`, `PATH`, and `TMPDIR`. Application secrets, including `OPENAI_API_KEY`, are excluded.

Use it per agent:

```yaml
id: repo-maintainer
name: Repo Maintainer
executor: codex
working_directory: ~/Developer/my-project
codex_sandbox: workspace-write
model: gpt-5.4
prompt: |
  Review the repository and fix the smallest issue you find.
```

Codex support is intentionally implemented as a separate executor. Existing agents keep using `claude-code` until you set `executor: codex`.

Some Claude SDK fields do not have a one-to-one Codex SDK setting. Codex does not enforce `tools`, `disallowed_tools`, `permissions`, or `max_turns`. Kimi Code enforces tool permissions through ACP but does not use `max_turns`. Codex runs disable network access and web search by default. The configured Codex sandbox controls filesystem writes, but Agent Server cannot yet enforce a command allowlist or narrow filesystem read roots for Codex shell commands.

Credential-free agent-level MCP declarations are passed as SDK configuration overrides. Codex agents reject MCP declarations containing `env` or `headers` because SDK overrides can appear in child-process arguments. Keep agents that need private tokens disabled until a token-backed adapter is available:

```yaml
executor: codex
enabled: false
mcp_servers:
  private-service:
    command: private-service-mcp
    env:
      SERVICE_TOKEN: "${SERVICE_TOKEN}"
```

Do not enable a Codex agent that handles sensitive files or requires private service credentials unless its effective Codex sandbox and MCP authentication path meet your security requirements.

Account-level Claude tools such as `mcp__claude_ai_Notion__*` are not available to Codex automatically. To keep existing prompts working, configure equivalent Codex MCP servers using matching server names where possible. For example, a Work Notion server named `claude_ai_Notion` exposes tool calls with the same `mcp__claude_ai_Notion__...` prefix in Agent Server telemetry.

Example Codex config for Work Notion:

```toml
[mcp_servers."claude_ai_Notion"]
command = "npx"
args = ["-y", "@notionhq/notion-mcp-server"]
env = { NOTION_TOKEN = "..." }
enabled = true
required = true
```

Example agent-level Personal Notion config:

```yaml
mcp_servers:
  notion-personal:
    command: npx
    args: ["-y", "@notionhq/notion-mcp-server"]
    env:
      NOTION_TOKEN: "${NOTION_PERSONAL_API_KEY}"
```

### Kimi Code executor

Kimi Code is an installed coding-agent runtime. The executable and orchestration run on this Mac, while prompts and approved context may be processed by Kimi's service under the user's signed-in account. It is separate from the Kimi K3 model preset, which runs through Codex and Moonshot's API. Choosing one never rewrites an agent configured for the other.

Install Kimi Code using its [official instructions](https://moonshotai.github.io/kimi-code/en/guides/getting-started.html), then sign in:

```bash
kimi login
kimi --version
```

Agent Server finds `kimi` in `~/.kimi-code/bin`, then on `PATH`. Set `AGENT_SERVER_KIMI_PATH` for an explicit executable or turn discovery off in Settings. Missing and signed-out installations produce an actionable error and do not fall through to another runtime. Agent Server also disables Kimi's independent scheduler inside managed runs so the Agent Server schedule remains authoritative.

Use the installed runtime per agent:

```yaml
id: manuscript-review
name: Manuscript Review
executor: kimi-code
working_directory: ~/Documents/Novel
permissions:
  allow: [Read, Write, Edit]
  deny: [Bash, WebFetch, WebSearch]
file_access:
  - path: ~/Documents/Novel/manuscript.docx
    kind: file
    access: read_only
  - path: ~/Documents/Novel/review.md
    kind: file
    access: read_write
prompt: Review the manuscript and save the findings in review.md.
```

The executor communicates through Agent Client Protocol instead of parsing terminal decoration. Permission requests are checked against the agent's allow and deny rules. File callbacks normalize paths, resolve symlinks, enforce each reviewed file or folder grant, and cap reads and writes at 2 MB. Agent Server rejects a Kimi Code configuration that combines exact file grants with shell command access because shell commands could bypass those path checks.

Kimi receives a small child-process environment. General application secrets and proxy variables are not inherited. Reviewed MCP servers are forwarded through the ACP session, including only their configured environment or header values. Cancellation sends an ACP session cancel request and then stops the child process. A `provider` block is rejected for `kimi-code` because the installed runtime uses its own login and ACP model selection.

Kimi K3 remains available as a distinct model choice:

```yaml
executor: codex
model: kimi-k3
provider:
  base_url: https://api.moonshot.ai/v1
  api_key: "${MOONSHOT_API_KEY}"
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

## Server architecture

```
server-app/src/
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

  server/                    HTTP, WebSocket, and daemon
    api.ts                     Hono HTTP API routes
    server.ts                  Combined HTTP server + scheduler + Telegram + WebSocket
    websocket.ts               ProgressBroadcaster for real-time run events
    daemon.ts                  CLI-mode runner, list command

  platform/                  OS and environment
    config.ts                  ServerConfig from env vars + .env file
    launchd.ts                 macOS LaunchAgent plist generation
    init.ts                    Scaffolds ~/.agent-server/ with sample agent

  plugins/                   Executor implementations
    claude-code.ts             Claude Code executor (Agent SDK query())
    codex.ts                   Codex executor (official Codex SDK)
    kimi-code.ts               Kimi Code executor (ACP)
    kimi-code-events.ts        Kimi ACP event and permission mapping
    kimi-code-file-policy.ts   Reviewed Kimi file access boundaries

  cli.ts                     Commander CLI entry point
  index.ts                   Barrel exports for library use
  test-factories.ts          Shared test data factories
```

## Development

All development commands run from `server-app/`:

```bash
cd server-app
pnpm install
pnpm test              # 486 tests
pnpm run type-check    # TypeScript strict mode
pnpm run build         # Compile to dist/
pnpm run dev           # Watch mode with tsx
```

Tests are colocated with source files (`*.test.ts`). The project uses TDD with factory functions for test data.

## Tech stack

### Server

- TypeScript strict mode, ES2022, ESM
- [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) for running Claude Code programmatically
- [Agent Client Protocol SDK](https://www.npmjs.com/package/@agentclientprotocol/sdk) for running Kimi Code with structured messages and permissions
- [Anthropic SDK](https://www.npmjs.com/package/@anthropic-ai/sdk) for message routing (agent selection via Haiku)
- [Zod](https://zod.dev/) for schema validation
- [cron-parser](https://github.com/harrisiirak/cron-parser) v5 for schedule evaluation
- [Hono](https://hono.dev/) for the HTTP API
- [@hono/node-ws](https://github.com/honojs/middleware/tree/main/packages/node-ws) for WebSocket streaming
- [Commander](https://github.com/tj/commander.js) for the CLI
- [grammy](https://grammy.dev/) for Telegram bot integration (long-polling)
- [dotenv](https://github.com/motdotla/dotenv) for `.env` file loading
- [Vitest](https://vitest.dev/) for testing

### macOS app

- Swift 5.9+, macOS 14.0+
- SwiftUI + AppKit (NSStatusBar, NSTextView)
- No third-party dependencies

## Requirements

- Node.js 20+
- At least one supported local runtime installed and authenticated: Claude Code, Codex, or Kimi Code

## License

MIT
