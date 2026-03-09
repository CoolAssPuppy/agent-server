# Agent Server build plan

## Phase 1: Core runtime

### Step 1.1: Agent definition schema and parser
- [x] Define AgentConfig Zod schema (id, name, schedule, prompt, tools, max_turns, working_directory, etc.)
- [x] Parse YAML files into validated AgentConfig
- [x] Tests: valid YAML, missing required fields, defaults, extra fields

### Step 1.2: Agent discovery
- [x] Scan a directory for *.yaml files
- [x] Return sorted list of validated AgentConfig objects
- [x] Handle parse errors gracefully (warn, skip)
- [x] Tests: empty dir, valid agents, invalid YAML, mixed

### Step 1.3: Scheduler
- [x] Evaluate cron expression against current time
- [x] Support timezone-aware scheduling
- [x] Determine which agents are due
- [x] Tests: cron matching, timezone handling, disabled agents

### Step 1.4: Locking
- [x] PID-based file locks to prevent concurrent runs
- [x] Stale lock detection (dead PID cleanup)
- [x] Tests: acquire, release, stale cleanup, concurrent prevention

### Step 1.5: A2A telemetry reporter
- [x] Post status events to configurable HTTP endpoint
- [x] Async context manager with heartbeat
- [x] A2A-compatible event envelope
- [x] Tests: event posting, heartbeat, error states

### Step 1.6: Claude Code executor
- [x] Invoke Claude Code via CLI (--print --output-format stream-json)
- [x] Parse streaming JSON events
- [x] Extract turn summaries for telemetry
- [x] Tests: successful run, error handling, timeout

### Step 1.7: Runner (orchestrator)
- [x] Wire together: lock -> execute -> report
- [x] Generate run IDs
- [x] Handle errors, always release lock
- [x] Tests: full flow with mocked executor

### Step 1.8: CLI entry point
- [x] `agent-server start` -- daemon mode
- [x] `agent-server run <id>` -- run specific agent
- [x] `agent-server list` -- list discovered agents
- [x] `agent-server init` -- create config directory with sample agent

## Phase 2: Streaming telemetry

### Step 2.1: Agent SDK integration
- [ ] Replace CLI with Agent SDK for streaming
- [ ] Turn-by-turn telemetry extraction
- [ ] Meaningful message summaries per turn

### Step 2.2: Enhanced progress reporting
- [ ] Track tools_used, files_written, turns_completed
- [ ] Send progress metadata with each working event

## Phase 3: Local HTTP API

### Step 3.1: HTTP server
- [ ] GET /agents -- list all agents
- [ ] GET /agents/:id -- agent detail
- [ ] POST /agents/:id/run -- trigger manual run
- [ ] POST /agents/:id/cancel -- cancel running agent
- [ ] GET /runs -- recent runs
- [ ] GET /runs/:id/logs -- logs for a run

## Phase 4: Agent chaining and events

### Step 4.1: Chaining
- [ ] on_complete trigger config
- [ ] Chain execution after successful run

### Step 4.2: File watch triggers
- [ ] fs.watch based trigger
- [ ] Debounce and path matching

## Phase 5: Persistence

### Step 5.1: LaunchAgent
- [ ] Generate macOS LaunchAgent plist
- [ ] Install/uninstall commands
- [ ] Sleep/wake catch-up logic
