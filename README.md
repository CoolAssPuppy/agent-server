# Agent Server

A lightweight orchestration server that runs AI agents in the background using [Claude Code](https://docs.anthropic.com/en/docs/claude-code) as its execution engine.

Define agents as YAML files with cron schedules. Agent Server discovers them, runs them on schedule, prevents concurrent execution with file locks, and reports telemetry in [A2A](https://google.github.io/A2A/) format to any observability tool.

## Quick start

```bash
# Install
npm install -g @agent-server/core

# Create config directory with a sample agent
agent-server init

# Edit your agent
$EDITOR ~/.agent-server/agents/hello-world.yaml

# Start the server
agent-server start
```

The server starts on `http://localhost:47821` with both an HTTP API and a cron scheduler.

## Agent definitions

Agents are YAML files in `~/.agent-server/agents/`:

```yaml
id: daily-summary
name: Daily Summary
description: Summarizes overnight activity
schedule: "0 8 * * *"
timezone: America/New_York
prompt: |
  Review the git log from the last 24 hours and write a brief summary
  of what changed. Format as bullet points.
max_turns: 10
working_directory: ~/projects/my-app
tools:
  - Bash
  - Read
  - Glob
enabled: true
```

### Agent chaining

Agents can trigger other agents on completion or failure:

```yaml
id: notify-on-failure
name: Failure Notifier
schedule: "* * * * *"
prompt: Send a notification that the daily summary failed.
on_failure:
  - agent: daily-summary
```

### Fields

| Field | Required | Default | Description |
|---|---|---|---|
| id | yes | | Unique identifier |
| name | yes | | Display name |
| description | no | | What this agent does |
| schedule | yes | | Cron expression |
| timezone | no | UTC | IANA timezone |
| prompt | yes | | The prompt sent to Claude Code |
| max_turns | no | 20 | Maximum conversation turns |
| working_directory | no | $HOME | Where Claude Code runs |
| tools | no | [] | Allowed tools (empty = all) |
| enabled | no | true | Whether the agent runs |
| on_complete | no | | Agents to trigger on success |
| on_failure | no | | Agents to trigger on failure |

## CLI

```bash
agent-server start           # Start server with HTTP API + scheduler
agent-server run <agentId>   # Run an agent immediately
agent-server list            # List all agents
agent-server init            # Create config directory
agent-server install         # Install macOS LaunchAgent for auto-start
agent-server uninstall       # Remove macOS LaunchAgent
```

## HTTP API

The server exposes a local API on port 47821 (configurable):

```bash
# List all agents
curl http://localhost:47821/agents

# Get agent detail
curl http://localhost:47821/agents/daily-summary

# Trigger a run
curl -X POST http://localhost:47821/agents/daily-summary/run

# List recent runs
curl http://localhost:47821/runs

# Filter runs by agent
curl http://localhost:47821/runs?agent_id=daily-summary

# Get run detail with progress
curl http://localhost:47821/runs/{runId}

# Health check
curl http://localhost:47821/health
```

## Telemetry

Agent Server reports status in A2A format. Configure with environment variables:

```bash
export AGENT_SERVER_PANEL_URL=https://your-panel.vercel.app
export AGENT_SERVER_PANEL_API_KEY=ap_live_...
```

Status events include: `working`, `completed`, `failed`. Heartbeats are sent every 30 seconds. Progress reports include tool usage, files written, and commands run.

## macOS auto-start

```bash
# Install LaunchAgent (auto-starts on login, auto-restarts on crash)
agent-server install

# Activate immediately
launchctl load ~/Library/LaunchAgents/com.agent-server.daemon.plist

# Stop and remove
launchctl unload ~/Library/LaunchAgents/com.agent-server.daemon.plist
agent-server uninstall
```

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|---|---|---|
| AGENT_SERVER_AGENTS_DIR | ~/.agent-server/agents | Agent YAML directory |
| AGENT_SERVER_LOCK_DIR | ~/.agent-server/locks | Lock file directory |
| AGENT_SERVER_CHECK_INTERVAL_MS | 60000 | How often to check schedules |
| AGENT_SERVER_PANEL_URL | | Telemetry endpoint |
| AGENT_SERVER_PANEL_API_KEY | | Telemetry API key |
| AGENT_SERVER_HEARTBEAT_MS | 30000 | Heartbeat interval |
| AGENT_SERVER_PORT | 47821 | HTTP API port |

## How it works

1. The server starts an HTTP API and a cron scheduler
2. Every 60 seconds (configurable), it discovers all `.yaml` and `.yml` files in the agents directory
3. For each agent whose cron schedule matches the current minute, it:
   - Acquires a PID-based file lock (skips if already running)
   - Spawns `claude --print --output-format stream-json`
   - Streams events, extracts tool metadata, and reports progress via A2A telemetry
   - Releases the lock when done
4. The HTTP API provides real-time access to agents and run state

## Development

```bash
npm install
npm test              # 112 tests
npm run type-check    # TypeScript strict mode
npm run build         # Compile to dist/
npm run dev           # Watch mode
```

## Requirements

- Node.js 20+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## License

MIT
