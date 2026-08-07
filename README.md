<!-- sparkle-sign-warning:
IMPORTANT: This file was signed by Sparkle. Any modifications to this file requires updating signatures in appcasts that reference this file! This will involve re-running generate_appcast or sign_update.
-->
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
corepack enable
pnpm install --frozen-lockfile
pnpm run build
cd server-app
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

Keep shareable agent files independent of the local coding runtime and MCP adapter. The file names each connection, says what it is for, lists semantic operations, and declares logical resources. Agent Server stores the selected Claude Code, Codex, or Kimi Code runtime and all concrete connection details under `~/.agent-server/`.

### Markdown with YAML frontmatter (recommended)

YAML frontmatter for configuration, Markdown body for the prompt. This format gives you full Markdown formatting in the prompt with syntax highlighting in any editor.

```markdown
---
id: weekly-report
name: Weekly Priority Report
schedule: "0 5 * * 1"
timezone: Europe/Lisbon
connections:
  work_projects:
    type: linear
    name: Linear Work
    purpose: Read projects and issues updated during the reporting period.
    operations:
      - linear.project.read
      - linear.issue.search
      - linear.issue.read
  work_messages:
    type: slack
    name: Slack Work
    purpose: Find conversations and decisions related to the selected work.
    operations:
      - slack.message.search
      - slack.message.read
  work_notes:
    type: notion
    name: Notion Work
    purpose: Read supporting documents and create the weekly report.
    operations:
      - notion.search
      - notion.page.read
      - notion.page.create
    resources:
      report_database:
        type: notion.data_source
        purpose: Destination for the weekly report.
        access: write
max_turns: 30
---

Review my work activity from the last 7 days and create a report.

## Sources to check

1. **Linear**: Initiatives, projects, and issues updated in the last 7 days
2. **Slack**: Related conversations and decisions
3. **Notion**: Documents I've edited recently

## Output

Create a new page in `work_notes.report_database` with a structured summary.
```

The connection names are instructions for a person configuring the agent. They are not MCP server names. `linear.issue.search` and the other operation names describe intent. After importing the agent, use the macOS app to:

1. Create or select each saved connection.
2. Check its concrete MCP tool inventory.
3. Map the declared operations to reviewed tools and classify each tool as read or write.
4. Bind logical resources such as `work_notes.report_database` to local service IDs.
5. Select the local runtime after its compatibility check passes.

The local choices are saved in `connections.json`, `connection-capabilities.json`, `connection-operation-bindings.json`, `agent-bindings.json`, and `runtime-assignments.json`. Keep those machine files private. Share only the agent file.

A saved connection can use an MCP process, an MCP URL, or an account already connected to one coding runtime. Runtime-account connections record the owning runtime and its server name. Agent Server accepts them only when that same runtime is selected. Switching an agent to another runtime therefore requires equivalent local connections for that runtime; the shared agent file does not change.

Legacy migrations use the configuration-patch preview API. A preview includes the complete proposed file and a content hash. Applying a high-risk migration requires confirmation of that exact hash. If the source changes after preview, the server refuses the patch. Successful changes include a rollback token.

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
| `connections` | no | | Named service uses with portable type, purpose, semantic operations, and logical resources. |
| `max_turns` | no | `AGENT_SERVER_DEFAULT_MAX_TURNS` (default `20`) | Maximum Claude Code or Codex agentic turns. Kimi Code manages its own ACP session. |
| `working_directory` | no | `$HOME` | Working directory for the executor session. Supports `~`. |
| `tools` | no | `[]` | Allowed tools list. Claude Code receives the list directly; Kimi Code enforces it when ACP asks for tool permission. |
| `disallowed_tools` | no | `[]` | Tools to explicitly deny. Deny rules take precedence. |
| `permissions` | no | | Fine-grained tool permissions with glob patterns. See [tool permissions](#example-tool-permissions). |
| `permission_mode` | no | `bypassPermissions` | Legacy runtime-specific permission setting. Omit from shareable agents. |
| `enabled` | no | `true` | Whether the scheduler runs this agent |
| `executor` | no | local assignment | Legacy runtime selection. New agents store this outside the agent file. |
| `codex_sandbox` | no | `workspace-write` | Legacy Codex-only setting. Omit from shareable agents. |
| `model` | no | local assignment | Legacy model selection. New agents store this outside the agent file. |
| `on_complete` | no | | Agents to trigger on successful completion |
| `on_failure` | no | | Agents to trigger on failure |
| `watch` | no | | File paths to watch for changes (triggers runs outside the cron schedule) |
| `interaction` | no | | Interactive agent config (channel, on_reply, timeout) |
| `mcp_servers` | no | | Legacy inline MCP configuration. New agents use `connections` and saved local profiles. |
| `notification` | no | | Notification config (channel, on_complete, on_failure) |
| `output` | no | | Optional reviewed output contract. See [required output contracts](#required-output-contracts). |

### Required output contracts

An output contract prevents an agent from reporting success when a required service action did not finish. Enforcement is opt-in. Set `output.primary.required: true` only when every normal run must create or update the result. Conditional workflows, such as "publish only when the source changed," should omit `required` or set it to `false` so a valid no-change run can complete.

```yaml
output:
  primary:
    description: Create one report in the approved destination
    use: work_notes
    operation: notion.page.create
    target: report_database
    required: true
    successful_calls:
      min: 1
      max: 1
```

`use` identifies one declared connection, `operation` identifies one operation from that use, and `target` identifies one logical resource. Agent Server compiles them into a concrete tool and destination after resolving the local bindings. `successful_calls` sets the accepted number of successful matching calls and defaults to a minimum of one. Failed calls never count.

Legacy contracts may still use `tool`, `update_tool`, and `target_match`. Tool inputs, outputs, and matched target values are inspected in memory and are not added to run history or error messages.

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

Use `connections[].operations` for remote-service permissions in shareable agents. Each operation states the action the agent needs without naming an MCP server or runtime tool.

```yaml
id: research-agent
name: Research Agent
schedule: "0 9 * * 1-5"
connections:
  work_projects:
    type: linear
    name: Linear Work
    purpose: Read recent projects and issues for the report.
    operations:
      - linear.project.read
      - linear.issue.search
      - linear.issue.read
  work_messages:
    type: slack
    name: Slack Work
    purpose: Find related messages and decisions.
    operations:
      - slack.message.search
      - slack.message.read
prompt: |
  Research recent activity across Linear and Slack.
  Return a concise summary.
max_turns: 20
```

After the local connection is checked, map each semantic operation to one concrete tool. Review whether unknown tools read or write. If an operation targets a resource, map its target argument and resource type too. Agent Server then gives the selected runtime only those mapped tools and rejects calls outside the mapping.

`tools`, `disallowed_tools`, and `permissions` remain available for older definitions and local runtime tools. Concrete `mcp__...` names in those fields make a definition adapter-specific, so omit them from files intended for sharing.

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

MCP servers are saved as local connection profiles. A profile contains:

- A human-readable label such as `Notion Work`.
- A portable service type such as `notion`.
- A technical adapter ID and version.
- A stdio, HTTP, or SSE transport.
- References to credentials stored in `~/.agent-server/.env`.

The adapter ID describes one local implementation. The service type is what a shareable agent requests. This separation lets two people bind the same `type: notion` use to different Notion MCP implementations.

Create a connection in the macOS Connections view, then run its check. The check records the concrete MCP inventory without authorizing new tools. Review the inventory and assign semantic operation names. Unknown tools require an explicit read or write classification. A changed inventory makes the prior review stale and blocks affected runs until it is reviewed again.

The capability identity includes the full transport, adapter version, runtime name, and credential references. Changing any of them makes the prior review stale. Credential values are excluded from that identity. The built-in Notion mapping applies only to the exact reviewed command `npx -y @notionhq/notion-mcp-server@2.5.1`; other versions require an explicit operation review.

Credential values stay out of agent files, generated runtime configuration, command arguments, logs, and prompts. The policy relay resolves them only for the connection process. Remote profiles require HTTPS, except loopback HTTP.

Older `mcp_servers` blocks still parse for migration. Move their transports and credential references into saved connection profiles before sharing the agent.

Calendar and Reminders access supplied by the macOS EventKit helper follows the same rule: an agent declares portable calendar or reminder operations, while the local app selects and reviews the implementation.

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
wscat -c ws://localhost:47821/ws -H "Authorization: Bearer $AGENT_SERVER_API_KEY"
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

Connect to `ws://localhost:47821/ws` with the same API-key header for real-time run events. Events are JSON objects with type `run_started`, `run_progress`, `run_completed`, or `run_failed`:

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
| `AGENT_SERVER_CLAUDE_PATH` |  | Exact path to the required Claude Code executable |
| `AGENT_SERVER_CODEX_PATH` |  | Exact path to the required Codex executable |
| `AGENT_SERVER_USE_INSTALLED_KIMI` | `true` | Set to `false` to turn off installed Kimi Code discovery |
| `AGENT_SERVER_KIMI_PATH` |  | Exact path to the `kimi` executable. An invalid explicit path fails closed. |
| `AGENT_SERVER_ANALYTICS_KEY` |  | Product analytics project key. Injected by the macOS app at launch. Unset means analytics is off. |
| `AGENT_SERVER_ANALYTICS_HOST` | `https://us.i.posthog.com` | Product analytics ingest host |
| `AGENT_SERVER_ANALYTICS_DISTINCT_ID` |  | Per-install identifier passed down by the macOS app so both surfaces resolve to one person |
| `AGENT_SERVER_ANALYTICS_OPT_OUT` | `true` | Product analytics stays off until this is explicitly set to `false`. The value in `~/.agent-server/.env` wins over the shell so the macOS toggle reaches a running daemon. |
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

A native Swift app that lives in the menu bar for monitoring and controlling agents.

### Features

- **Menu bar monitoring**: Icon shows server status at a glance. Turns yellow when agents are actively running. Dropdown shows active runs and scheduled agent count.
- **Real-time updates**: Connects to the server via WebSocket (`ws://localhost:47821/ws`) for instant run progress. Falls back to HTTP polling if WebSocket disconnects.
- **Native notifications**: Fires a macOS notification when an agent completes, fails, or times out. Completion notifications include a brief summary from the agent's final message. Uses `UNUserNotificationCenter` and prompts for authorization on first launch.
- **Calendar and Reminders integration**: Bundled `agent-server-eventkit` helper binary exposes EventKit to agents through a stdio MCP server. Every agent run gets automatic access to tools like `list_events`, `create_event`, `list_reminders`, and `create_reminder`. Calendar and Reminders permissions are requested on first launch via `EKEventStore.requestFullAccess*`.
- **Agent list**: All discovered agents with kind-based icons and colors (scheduled, interactive, watcher, chained, on-demand). Disabled agents show a "Disabled" pill.
- **Agent editor**: View and edit agent definition files with Markdown and YAML syntax highlighting. Save with Cmd+S. Enable/disable agents with a toggle.
- **Create agents**: Create new agents from Markdown or YAML templates directly from the app.
- **Run and cancel agents**: Trigger any agent from the agent list with a single click. Cancel running agents via the API.
- **Environment editor**: Edit `~/.agent-server/.env` with a key-value editor. Contextual icons for each variable type.
- **Server settings**: View server status, agent count, launch-at-login toggle, sleep/wake catch-up toggle, and app version.
- **Bundled server**: The compiled `server-app/dist/`, `package.json`, and production `node_modules/` are copied into `Contents/Resources/` at build time. The app launches the Node server immediately on first run — no pnpm install step, no network required, code signing stays valid because nothing is written inside the bundle post-signing.

### Build

Requires Xcode 15+ and [xcodegen](https://github.com/yonaskolb/XcodeGen), plus the Node.js and pnpm versions listed under [Requirements](#requirements). Install dependencies from the repository root so pnpm uses the checked-in workspace lockfile:

```bash
pnpm install --frozen-lockfile
cd macos-app
xcodegen generate
xcodebuild -project AgentServer.xcodeproj -scheme AgentServer build
```

Or open `AgentServer.xcodeproj` in Xcode after running `xcodegen generate`.

The build consumes the root `pnpm-lock.yaml` and stages the production server with `pnpm --filter @agent-server/core --config.inject-workspace-packages=true deploy --prod --offline --config.node-linker=hoisted "$STAGING"`. The staged package is copied into `Contents/Resources/`, so the installed app does not download dependencies at runtime.

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

### Release and distribution

Use the [Sparkle release guide](docs/SPARKLE.md) for the release command, setup, publication, verification, and troubleshooting.

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

Agent Server can run one shareable definition through Claude Code, Codex, or Kimi Code. Select the runtime in the macOS agent settings. The choice is saved in `~/.agent-server/runtime-assignments.json`, outside the agent file.

Before saving a runtime change, Agent Server checks that every declared connection is bound, every required operation has a current reviewed mapping, every resource is selected, and the runtime can enforce the resulting contract. An incompatible choice is rejected with the missing requirements.

Older files with `executor`, `model`, or `provider` still parse. Their values are migration input. Saving a runtime in the current app creates a local assignment and does not add those fields to the shareable file.

### Codex executor

The built-in Codex executor uses the official `@openai/codex-sdk`. The SDK runs a compatible local Codex runtime and emits typed streaming events for progress, tool calls, usage, and the final response.

Authenticate once with your ChatGPT account before starting Agent Server:

```bash
codex login
codex login status
```

Choose **Sign in with ChatGPT** in the browser flow. This uses Codex access included with your ChatGPT subscription. Agent Server gives the Codex child a small process environment containing only runtime variables such as `HOME`, `PATH`, and `TMPDIR`. Application secrets, including `OPENAI_API_KEY`, are excluded.

Codex receives only the concrete MCP tools compiled from the agent's declared operations. A local policy relay checks every tool call, rejects tools outside the reviewed mapping, enforces bound resource arguments, and supplies connection credentials without adding them to Codex arguments or configuration. Codex runs still use its sandbox for local file and shell access.

Codex and ChatGPT account setup are separate from Agent Server connection setup:

1. Run `codex login` on every machine that will execute scheduled Codex agents.
2. In the Codex app, use `/apps` to connect services you want during interactive Codex sessions.
3. In ChatGPT, add or connect apps from Settings when you want to use them in ChatGPT conversations.
4. In Agent Server, create checked local connection profiles and bind them to the agent's named uses. Codex and ChatGPT apps are not copied into Agent Server.
5. Select Codex for an agent only after the compatibility check says it is compatible.

Scheduled Calendar access on macOS uses the bundled EventKit helper. Give Agent Server Calendar permission in System Settings on each Mac. Connecting Google Calendar in Codex or ChatGPT does not grant Calendar access to the background Agent Server process.

### Kimi Code executor

Kimi Code is an installed coding-agent runtime. The executable and orchestration run on this Mac, while prompts and approved context may be processed by Kimi's service under the user's signed-in account. Custom Kimi-compatible providers can also be selected as local runtime settings. Neither choice changes the shareable agent file.

Install Kimi Code using its [official instructions](https://moonshotai.github.io/kimi-code/en/guides/getting-started.html), then sign in:

```bash
kimi login
kimi --version
```

Agent Server finds `kimi` in `~/.kimi-code/bin`, then on `PATH`. Set `AGENT_SERVER_KIMI_PATH` for an explicit executable or turn discovery off in Settings. Missing and signed-out installations produce an actionable error and do not fall through to another runtime. Agent Server also disables Kimi's independent scheduler inside managed runs so the Agent Server schedule remains authoritative.

The executor communicates through Agent Client Protocol instead of parsing terminal decoration. Permission requests are checked against the agent's allow and deny rules. File callbacks normalize paths, resolve symlinks, enforce each reviewed file or folder grant, and cap reads and writes at 2 MB. Agent Server rejects a Kimi Code configuration that combines exact file grants with shell command access because shell commands could bypass those path checks.

Kimi receives a small child-process environment. General application secrets and proxy variables are not inherited. Portable MCP connections use the same local policy relay as Claude Code and Codex. Cancellation sends an ACP session cancel request and then stops the child process. Custom model providers are local runtime settings and remain outside shareable definitions.

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

Run workspace commands from the repository root with the versions listed under [Requirements](#requirements).

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm run type-check
pnpm run lint
pnpm run build
pnpm run dev
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
- Sparkle 2 for signed application updates
- PostHog for product analytics

## Analytics and privacy

Agent Server can send anonymous product usage data after you turn on "Help improve Agent Server" in Settings. The switch takes effect immediately for both the app and the running server.

What gets sent: agent and run identifiers, executor names, outcome codes, counts, and which screens were opened. What never gets sent: your prompts, agent names, run summaries, file paths, error messages, credentials, your email, or any device fingerprint. You are identified by a random per-install UUID stored on your Mac.

Builds from source have no analytics key baked in and send nothing.

## Requirements

- Node.js 22.13+
- pnpm 11+
- At least one supported local runtime installed and authenticated: Claude Code, Codex, or Kimi Code

## License

MIT
