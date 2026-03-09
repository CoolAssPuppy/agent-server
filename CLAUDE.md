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
  daemon.ts          -- Timer loop, single-run, list commands
  config.ts          -- ServerConfig from AGENT_SERVER_* env vars
  init.ts            -- Scaffolds ~/.agent-server/ with sample agent
  cli.ts             -- Commander CLI: start, run, list, init
  index.ts           -- Barrel exports for library use
```

## Tech stack

- TypeScript strict mode, ES2022, ESM
- Zod for schema validation
- cron-parser v5 (`CronExpressionParser.parse()`, NOT `parseExpression()`)
- Commander for CLI
- yaml for YAML parsing
- vitest for testing
- No runtime dependencies beyond these

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

Claude Code with `--print --output-format stream-json` outputs one JSON object per line. Parse with `parseStreamEvent()`. Event types: `assistant` (has message.content blocks), `result` (final output).

### File locking

PID-based locks in the locks directory. Stale lock detection via `process.kill(pid, 0)`. Always release in a `finally` block.

## Commands

```bash
npm test              # Run all 76 tests
npm run type-check    # TypeScript strict check
npm run build         # Compile to dist/
npm run dev           # Dev mode with tsx watch
```

## CLI

```bash
agent-server init            # Create ~/.agent-server/ with sample agent
agent-server start           # Start daemon (timer loop)
agent-server run <agentId>   # Run one agent immediately
agent-server list            # List discovered agents
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

## Testing

TDD is mandatory. 76 tests across 10 files. Tests are colocated with source files (`*.test.ts`). Use factory functions for test data, never `let`/`beforeEach` mutation.

## Future phases

- Phase 2: Agent SDK integration for richer streaming telemetry
- Phase 3: Local HTTP API on localhost:47821
- Phase 4: Agent chaining and event triggers
- Phase 5: macOS persistence (LaunchAgent) and native Mac app
