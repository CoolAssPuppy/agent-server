# Agent Server

Lightweight orchestration server that runs AI agents in the background using Claude Code as its execution engine. Agents are defined as YAML files with cron schedules. The server discovers agents, evaluates schedules, acquires locks, spawns Claude Code processes, streams events, and reports telemetry in A2A format.

## Architecture

```
src/
  agent-config.ts    -- Zod schema + YAML parser for agent definitions
  discovery.ts       -- Reads YAML files from agents directory
  scheduler.ts       -- Cron expression evaluation (cron-parser v5)
  lockfile.ts        -- PID-based file locks with stale detection
  reporter.ts        -- A2A telemetry reporter with heartbeat
  executor.ts        -- Spawns `claude --print --output-format stream-json`
  runner.ts          -- Orchestrates lock -> report -> execute -> release
  daemon.ts          -- Timer loop, single-run, list commands (legacy)
  store.ts           -- In-memory run state store with eviction
  api.ts             -- Hono HTTP API routes
  server.ts          -- Combined HTTP server + agent scheduler
  triggers.ts        -- Agent chaining (on_complete, on_failure)
  launchd.ts         -- macOS LaunchAgent plist generation
  config.ts          -- ServerConfig from AGENT_SERVER_* env vars
  init.ts            -- Scaffolds ~/.agent-server/ with sample agent
  cli.ts             -- Commander CLI: start, run, list, init, install, uninstall
  index.ts           -- Barrel exports for library use
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

### HTTP API

Hono app created via `createApi()` with dependency injection. Routes: `/agents`, `/agents/:id`, `/agents/:id/run`, `/runs`, `/runs/:id`, `/health`. The `startServer()` function combines HTTP + scheduler in one process.

## Commands

```bash
npm test              # Run all 112 tests
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

TDD is mandatory. 112 tests across 14 files. Tests are colocated with source files (`*.test.ts`). Use factory functions for test data, never `let`/`beforeEach` mutation.

## Future work

- Agent SDK integration when `@anthropic-ai/claude-code` SDK is stable
- WebSocket streaming for live run progress
- Cancel running agents via API
- File watch triggers (fs.watch with debounce)
- Wire triggers into server run completion flow
- Sleep/wake catch-up logic for LaunchAgent
- Native Mac app (planned)
