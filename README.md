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

# Start the daemon
agent-server start
```

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

## CLI

```bash
agent-server start           # Start the daemon
agent-server run <agentId>   # Run an agent immediately
agent-server list            # List all agents
agent-server init            # Create config directory
```

## Telemetry

Agent Server reports status in A2A format. Configure with environment variables:

```bash
export AGENT_SERVER_PANEL_URL=https://your-panel.vercel.app
export AGENT_SERVER_PANEL_API_KEY=ap_live_...
```

Status events include: `working`, `completed`, `failed`. Heartbeats are sent every 30 seconds while an agent is running.

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

## How it works

1. The daemon wakes up every 60 seconds (configurable)
2. It discovers all `.yaml` and `.yml` files in the agents directory
3. For each agent whose cron schedule matches the current minute, it:
   - Acquires a PID-based file lock (skips if already running)
   - Spawns `claude --print --output-format stream-json`
   - Streams events and reports progress via A2A telemetry
   - Releases the lock when done

## Development

```bash
npm install
npm test              # 76 tests
npm run type-check    # TypeScript strict mode
npm run build         # Compile to dist/
npm run dev           # Watch mode
```

## Requirements

- Node.js 20+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## License

MIT
