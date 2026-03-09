# Agent Server

A lightweight orchestration server that runs AI agents in the background using [Claude Code](https://docs.anthropic.com/en/docs/claude-code) as its execution engine.

Define agents as Markdown or YAML files with cron schedules. Agent Server discovers them, runs them on schedule, prevents concurrent execution with file locks, and reports telemetry in [A2A](https://google.github.io/A2A/) format.

## How it works

Agent Server is a scheduler and process manager for Claude Code. It does not call the Anthropic API directly. Instead, it spawns `claude --print --output-format stream-json` as a child process, pipes the agent's prompt via stdin, and streams structured JSON events from stdout.

This means agents inherit everything Claude Code provides: MCP server integrations (Slack, Linear, Notion, GitHub, etc.), tool permissions, model selection, and context management. The agent server doesn't need to know about any of that. It just runs the prompt and records what happens.

```
~/.agent-server/
  .env                    # Environment variables (panel URL, API keys)
  agents/                 # Agent definition files (.yaml, .yml, .md)
    weekly-report.md
    daily-standup.yaml
  locks/                  # PID-based file locks (managed automatically)
  logs/                   # Server logs
```

### Execution flow

1. The server starts an HTTP API and a cron scheduler
2. Every 60 seconds (configurable), it reads all agent files from the agents directory
3. For each agent whose cron schedule matches the current minute:
   - Acquires a PID-based file lock (skips if already running)
   - Creates a telemetry reporter (or a noop reporter if no panel is configured)
   - Spawns `claude --print` with the agent's prompt piped via stdin
   - Parses the streaming JSON output, extracting tool usage, files read/written, and commands run
   - Reports progress events to the telemetry endpoint on every turn
   - Sends heartbeats every 30 seconds to signal liveness
   - On completion, reports the full execution result with accomplishments and usage data
   - Releases the lock

### Claude Code integration

The executor spawns Claude Code with these flags:

```bash
claude --print --output-format stream-json --max-turns 20 --verbose
```

The prompt is piped via stdin. If the agent specifies allowed tools, they're passed via `--allowedTools`. The process inherits the current environment, so Claude Code uses whatever MCP servers and permissions are configured in `~/.claude/settings.json`.

For headless execution, MCP tool permissions must be pre-approved since there's no interactive prompt. Add them to your Claude Code settings:

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

### Executor plugin registry

The default executor spawns Claude Code, but the system is pluggable. Agents can specify an `executor` field in their config to use a different backend:

```yaml
executor: codex  # defaults to 'claude-code' if omitted
```

Register custom executors programmatically:

```typescript
import { ExecutorRegistry, type ExecutorFn } from '@agent-server/core';

const myExecutor: ExecutorFn = async (agent, reporter) => {
  // call any model, API, or process
};

registry.register('my-executor', myExecutor);
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

## Agent definition formats

Agents live in `~/.agent-server/agents/`. Two formats are supported.

### Markdown with YAML frontmatter (recommended)

YAML frontmatter for configuration, Markdown body for the prompt. This is the preferred format because it gives you full Markdown formatting in the prompt with syntax highlighting in any editor.

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

### Agent configuration fields

| Field | Required | Default | Description |
|---|---|---|---|
| `id` | yes | | Unique identifier |
| `name` | yes | | Display name |
| `description` | no | | What this agent does |
| `schedule` | yes | | Cron expression (e.g., `0 9 * * 1-5`) |
| `timezone` | no | UTC | IANA timezone for schedule evaluation |
| `prompt` | yes* | | The prompt sent to Claude Code (*provided by Markdown body in frontmatter format) |
| `max_turns` | no | 20 | Maximum conversation turns |
| `working_directory` | no | `$HOME` | Working directory for the Claude Code process |
| `tools` | no | `[]` | Allowed tools (empty means all tools are allowed) |
| `enabled` | no | `true` | Whether the scheduler runs this agent |
| `executor` | no | `claude-code` | Which executor plugin to use |
| `on_complete` | no | | Agents to trigger on successful completion |
| `on_failure` | no | | Agents to trigger on failure |
| `watch` | no | | File paths to watch for changes (triggers runs outside the cron schedule) |

### Agent chaining

Agents can trigger other agents on completion or failure:

```yaml
id: research-collector
on_complete:
  - agent: markdown-processor
on_failure:
  - agent: alert-agent
```

### File watch triggers

Agents can watch file paths and run when changes are detected, independent of the cron schedule:

```yaml
watch:
  - path: "~/notes"
    glob: "*.md"
```

## Telemetry

Agent Server reports status events via HTTP POST to a configurable panel endpoint. Events follow the [A2A protocol](https://google.github.io/A2A/) status format.

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
    "tools_used": ["Read", "mcp__claude_ai_Linear__list_projects", "mcp__claude_ai_Slack__slack_search_public_and_private"],
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

**Completion event** (sent when the agent finishes successfully):

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
    },
    "output": {
      "turn_count": 15,
      "tools_used": [
        "Read",
        "Write",
        "Bash",
        "mcp__claude_ai_Linear__list_projects",
        "mcp__claude_ai_Slack__slack_search_public_and_private",
        "mcp__claude_ai_Notion__notion-create-pages"
      ],
      "files_read": ["/Users/you/.claude/settings.json", "..."],
      "files_written": ["~/reports/weekly-2026-03-10.md"],
      "commands_run": ["git log --since='7 days ago'", "..."]
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
    "message": "Claude Code exited with code 1: ..."
  }
}
```

### Telemetry endpoint

Events are POSTed to `{AGENT_SERVER_PANEL_URL}/api/runs/{runId}/status` with an `Authorization: Bearer {apiKey}` header. If no panel URL is configured, a noop reporter is used and nothing is sent.

## CLI

```bash
agent-server init            # Create ~/.agent-server/ with a sample agent
agent-server start           # Start server with HTTP API + scheduler
agent-server run <agentId>   # Run an agent immediately (ignores schedule)
agent-server list            # List all discovered agents
agent-server install         # Install macOS LaunchAgent for auto-start
agent-server uninstall       # Remove macOS LaunchAgent
```

## HTTP API

The server exposes a local API on port 47821 (configurable):

```bash
curl http://localhost:47821/agents                        # List all agents
curl http://localhost:47821/agents/daily-summary           # Get agent detail
curl -X POST http://localhost:47821/agents/daily-summary/run  # Trigger a run
curl http://localhost:47821/runs                           # List recent runs
curl http://localhost:47821/runs?agent_id=daily-summary    # Filter by agent
curl http://localhost:47821/runs/{runId}                   # Run detail with progress
curl http://localhost:47821/health                         # Health check
```

## Configuration

### Environment variables

The CLI loads `~/.agent-server/.env` at startup. Shell environment variables and [Doppler](https://www.doppler.com/) (`doppler run -- agent-server start`) take precedence over the file.

| Variable | Default | Description |
|---|---|---|
| `AGENT_SERVER_AGENTS_DIR` | `~/.agent-server/agents` | Agent definition directory |
| `AGENT_SERVER_LOCK_DIR` | `~/.agent-server/locks` | Lock file directory |
| `AGENT_SERVER_LOG_DIR` | `~/.agent-server/logs` | Log directory |
| `AGENT_SERVER_CHECK_INTERVAL_MS` | `60000` | How often to check schedules (ms) |
| `AGENT_SERVER_PANEL_URL` | | Telemetry endpoint base URL |
| `AGENT_SERVER_PANEL_API_KEY` | | API key for telemetry |
| `AGENT_SERVER_HEARTBEAT_MS` | `30000` | Heartbeat interval (ms) |
| `AGENT_SERVER_PORT` | `47821` | HTTP API port |

### macOS auto-start

```bash
agent-server install
launchctl load ~/Library/LaunchAgents/com.agent-server.daemon.plist

# To stop and remove:
launchctl unload ~/Library/LaunchAgents/com.agent-server.daemon.plist
agent-server uninstall
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

  execution/                 Running agents
    executor.ts                Stream event parsing, tool metadata extraction, types
    executor-registry.ts       Plugin registry for swappable executors
    runner.ts                  Orchestrates lock -> report -> execute -> release
    lockfile.ts                PID-based file locks with stale detection

  reporting/                 Telemetry and state
    reporter.ts                A2A telemetry reporter with heartbeat
    reporter-factory.ts        Creates real or noop reporter based on config
    store.ts                   In-memory run state store with eviction

  server/                    HTTP and daemon
    api.ts                     Hono HTTP API routes
    server.ts                  Combined HTTP server + agent scheduler
    daemon.ts                  Timer loop, single-run, list commands

  platform/                  OS and environment
    config.ts                  ServerConfig from env vars + .env file
    launchd.ts                 macOS LaunchAgent plist generation
    init.ts                    Scaffolds ~/.agent-server/ with sample agent

  plugins/                   Executor implementations
    claude-code.ts             Claude Code executor (spawns `claude --print`)

  cli.ts                     Commander CLI entry point
  index.ts                   Barrel exports for library use
  test-factories.ts          Shared test data factories
```

## Development

```bash
npm install
npm test              # 154 tests
npm run type-check    # TypeScript strict mode
npm run build         # Compile to dist/
npm run dev           # Watch mode
```

Tests are colocated with source files (`*.test.ts`). TDD with factory functions for test data.

## Tech stack

- TypeScript strict mode, ES2022, ESM
- [Zod](https://zod.dev/) for schema validation
- [cron-parser](https://github.com/harrisiirak/cron-parser) v5 for schedule evaluation
- [Hono](https://hono.dev/) for the HTTP API
- [Commander](https://github.com/tj/commander.js) for the CLI
- [dotenv](https://github.com/motdotla/dotenv) for `.env` file loading
- [Vitest](https://vitest.dev/) for testing

## Requirements

- Node.js 20+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## License

MIT
