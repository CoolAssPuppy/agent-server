# Agent Server

Lightweight orchestration server that runs AI agents in the background using Claude Code as its execution engine. Agents are defined as YAML files with cron schedules. The server discovers agents, evaluates schedules, acquires locks, spawns Claude Code processes, streams events, and reports telemetry in A2A format.

## Architecture

```
src/
  agent-config.ts        -- Zod schema + YAML parser for agent definitions
  discovery.ts           -- Reads YAML files from agents directory
  scheduler.ts           -- Cron expression evaluation (cron-parser v5)
  lockfile.ts            -- PID-based file locks with stale detection
  reporter.ts            -- A2A telemetry reporter with heartbeat
  executor.ts            -- Claude Code executor (spawns `claude --print`)
  executor-registry.ts   -- Plugin registry for model-agnostic execution
  runner.ts              -- Orchestrates lock -> report -> execute -> release
  daemon.ts              -- Timer loop, single-run, list commands
  store.ts               -- In-memory run state store with eviction
  api.ts                 -- Hono HTTP API routes
  server.ts              -- Combined HTTP server + agent scheduler
  triggers.ts            -- Agent chaining (on_complete, on_failure)
  file-watcher.ts        -- File watch triggers with debounce and glob
  launchd.ts             -- macOS LaunchAgent plist generation
  config.ts              -- ServerConfig from AGENT_SERVER_* env vars
  init.ts                -- Scaffolds ~/.agent-server/ with sample agent
  cli.ts                 -- Commander CLI: start, run, list, init, install, uninstall
  index.ts               -- Barrel exports for library use

sample-agents/           -- Example agent YAML configs
```

## Tech stack

- TypeScript strict mode, ES2022, ESM
- Zod for schema validation
- cron-parser v5 (`CronExpressionParser.parse()`, NOT `parseExpression()`)
- Hono for HTTP API
- Commander for CLI
- yaml for YAML parsing
- vitest for testing

## Key patterns

### Executor plugin registry

Agents can specify which executor to use via the optional `executor` field in their YAML config. The `ExecutorRegistry` maps executor names to functions. Claude Code is the default executor. To add a new executor:

```typescript
import { ExecutorRegistry, type ExecutorFn } from './executor-registry.js';

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

The `Reporter` type in `runner.ts` is the interface all reporters implement. The `TelemetryReporter` class implements it for real HTTP reporting. The daemon creates a noop reporter when no panel URL is configured. Never cast to `TelemetryReporter` in daemon or runner code.

### cron-parser v5 API

```typescript
import { CronExpressionParser } from 'cron-parser';
const expr = CronExpressionParser.parse('*/5 * * * *', { tz: 'America/New_York' });
expr.includesDate(date);   // boolean
expr.next().toDate();      // Date
```

The old `parseExpression()` function does not exist in v5.

### Streaming JSON from Claude Code

Claude Code with `--print --output-format stream-json` outputs one JSON object per line. Parse with `parseStreamEvent()`. Extract rich metadata with `extractToolMetadata()`. Event types: `assistant` (has message.content blocks), `result` (final output).

### File locking

PID-based locks in the locks directory. Stale lock detection via `process.kill(pid, 0)`. Always release in a `finally` block.

### Agent chaining

Agents can define `on_complete` and `on_failure` arrays referencing other agent IDs. Use `evaluateTriggers()` to find downstream agents after a run completes.

### File watch triggers

Agents can declare `watch` paths in their YAML config. The `FileWatcher` class monitors these paths with `fs.watch`, applies glob filtering for directories, and debounces rapid changes. The `expandHome()` utility (in file-watcher.ts) handles `~` expansion and is shared with executor.ts.

### HTTP API

Hono app created via `createApi()` with dependency injection. Routes: `/agents`, `/agents/:id`, `/agents/:id/run`, `/runs`, `/runs/:id`, `/health`. The `startServer()` function combines HTTP + scheduler in one process.

## Agent YAML format

```yaml
id: my-agent
name: My Agent
description: What this agent does
schedule: "*/5 * * * *"
timezone: America/Los_Angeles
prompt: |
  Multi-line prompt for the agent...
tools:
  - Read
  - Write
  - Bash
max_turns: 20
enabled: true
working_directory: "~/projects/my-project"
executor: claude-code    # optional, defaults to claude-code
watch:                   # optional file triggers
  - path: "~/output"
    glob: "*.md"
on_complete:             # optional agent chaining
  - agent: downstream-agent
on_failure:
  - agent: alert-agent
```

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
agent-server list            # List discovered agents
agent-server install         # Install macOS LaunchAgent
agent-server uninstall       # Remove macOS LaunchAgent
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| AGENT_SERVER_AGENTS_DIR | ~/.agent-server/agents | Directory containing agent YAML files |
| AGENT_SERVER_LOCK_DIR | ~/.agent-server/locks | Lock file directory |
| AGENT_SERVER_LOG_DIR | ~/.agent-server/logs | Log directory |
| AGENT_SERVER_CHECK_INTERVAL_MS | 60000 | Daemon check interval |
| AGENT_SERVER_PANEL_URL | (none) | Agent Panel URL for telemetry |
| AGENT_SERVER_PANEL_API_KEY | (none) | API key for Agent Panel |
| AGENT_SERVER_HEARTBEAT_MS | 30000 | Heartbeat interval |
| AGENT_SERVER_PORT | 47821 | HTTP API port |

## Testing

TDD is mandatory. Tests are colocated with source files (`*.test.ts`). Use factory functions for test data, never `let`/`beforeEach` mutation.

## Future work

- Agent SDK integration when `@anthropic-ai/claude-code` SDK is stable
- WebSocket streaming for live run progress
- Cancel running agents via API
- Wire triggers into server run completion flow
- Sleep/wake catch-up logic for LaunchAgent
