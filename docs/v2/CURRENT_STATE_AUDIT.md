# Current state audit

## Outcome

Agent Server has a capable local runtime and several consumer features already worth keeping. Agent Panel has useful remote telemetry, decisions, realtime updates, and account management. The products do not yet share a safe machine identity or one reliable protocol. Their default interfaces also expose operational details before user outcomes.

Implementation must stop at this audit because:

1. Agent Server's baseline test command exits with a failure.
2. Panel cannot represent `machine_id + agent_id` safely.
3. Remote commands are scoped to an organization, so more than one server may receive the same request.
4. Decision request and resolution payloads disagree between the repositories.
5. Existing product documentation conflicts with running code.

These findings do not block planning or read-only UI presentation work. They block protocol rollout, remote control, pairing changes, and claims that the current dry run or decision flow works end to end.

## Repositories inspected

| Product | Revision during audit | Main areas inspected |
|---|---|---|
| Agent Server | `896a9e9` with the pre-existing `tasks/lessons.md` working change | README and product docs, agent schemas, local API, runner and executors, SQLite history, telemetry, direct Realtime client, connections, decisions, creation, debugger, security, patches, macOS navigation and screens, tests, recent commits |
| Agent Panel | clean `main` at `0a8b224` | README and v2 plan, Next.js routes and screens, Supabase migrations and RLS, shared types, realtime token flow, web navigation, iOS navigation and services, tests, recent commits |

Primary evidence includes:

- Agent Server composition: `server-app/src/server/server.ts`
- Agent Server local API: `server-app/src/server/api.ts`
- Agent definitions: `server-app/src/agents/config.ts`
- Local run history: `server-app/src/reporting/sqlite-store.ts`
- Panel telemetry: `server-app/src/reporting/reporter.ts`
- Panel direct Realtime: `server-app/src/reporting/realtime-client.ts`
- macOS root interface: `macos-app/AgentServer/Views/MainWindow.swift`
- macOS home: `macos-app/AgentServer/Views/MainPane.swift`
- Panel database: `../agent-panel/supabase/migrations/`
- Panel status ingress: `../agent-panel/web/app/api/runs/[runId]/status/route.ts`
- Panel sync: `../agent-panel/web/app/api/agents/sync/route.ts`
- Panel web routes: `../agent-panel/web/app/(dashboard)/`
- Panel iOS root: `../agent-panel/ios/AgentPanel/App/AgentPanelApp.swift`

## Current architecture

```text
Agent definition files and local environment
                    |
                    v
          Agent Server on one Mac
  discovery, schedules, locks, execution, local API
  local SQLite runs, connections, reviews, patches
          |                         |
          | loopback API/WebSocket  | optional HTTPS telemetry
          v                         v
     macOS client              Agent Panel API
                                |
                                v
                    Supabase Postgres and Realtime
                       |                    |
                       v                    v
                  Panel web            Panel iOS
```

Agent Server is locally useful without Panel. Panel does not execute agent work. This boundary should remain.

The current remote command path is:

```text
Panel web creates run_triggers row
    -> Panel mints an organization-scoped Realtime token
    -> every paired Agent Server subscribes to organization rows
    -> any server with a matching slug may acknowledge and run it
```

The missing machine target makes this unsafe for the proposed multi-device product.

## Data ownership

| Data | Current authority | V2 authority to preserve |
|---|---|---|
| Agent definition and schedule | Local file, though Panel keeps a projection | Local file |
| Local connections and credential values | Agent Server folder and environment | Agent Server only |
| Execution, locks, preflight, cancellation | Agent Server | Agent Server |
| Local run lifecycle and history | Agent Server SQLite, then enriched from Panel | Agent Server for local truth, Panel for remote projection |
| Security findings and review hashes | Agent Server SQLite | Agent Server |
| Patch preview and rollback token | Agent Server | Agent Server |
| Users, organizations, billing | Panel | Panel |
| Remote telemetry and notifications | Panel | Panel |
| Remote command request | Panel `run_triggers` | Panel request, locally accepted or rejected by one target server |
| Decision presentation | Panel and local stores with different schemas | One versioned wire contract, local execution authority |

## Current user journeys

### Agent Server macOS

- Home shows a greeting, the next 12 hours, current work, and recent activity.
- An Agents sidebar opens an agent drawer with Recent runs, Edit agent, and Run history.
- Guided creation asks for runtime, schedule, files, services, answers, review, save, and a safe test.
- Connections combines saved profiles, runtime account connectors, service templates, messaging, and advanced transport configuration.
- Failed runs can open the deterministic debugger and a reviewed repair flow.
- Security checks can review deterministic findings and preview approved patches.
- Settings, Connections, Security, Debugger, Creation, and agent detail are separate drawer modes.

### Agent Panel web

- Home combines greeting, agents, decisions, upcoming schedules, artifacts, and recent activity.
- Agent detail emphasizes aggregate statistics, history, Run now, cancellation, and deletion.
- Run detail separates Activity, Logs, and Output, then shows tokens, cost, worker ID, key ID, and other telemetry.
- Decisions have list and detail routes.
- Settings expose organization, API keys, billing, and theme.
- Pairing means creating an API key and manually copying values.

### Agent Panel iOS

- Tabs are Home, Decisions, and Settings.
- Home derives agents from recent runs rather than the synced assistant catalog.
- Run detail leads with run ID, duration, trigger, heartbeats, tokens, metrics, logs, and output.
- Run now, decisions, Realtime, and cleanup contain contract or authentication defects described below.

## Feature inventory

| Capability | Server | Panel web | Panel iOS | Assessment |
|---|---:|---:|---:|---|
| Local schedules and file watchers | Yes | Projection | Projection | Reuse Server |
| Claude Code, Codex, Kimi Code | Yes | Metadata only | Metadata only | Keep technical choice local |
| Durable local history | Yes, SQLite | Cloud history | Cloud history | Preserve both authorities |
| Guided creation | Yes | No | No | Reuse on desktop |
| Deterministic security analysis | Yes | No | No | Reuse, expose summary remotely only with consent |
| Debugger and repair proposals | Yes | No | No | Reuse locally |
| Patch preview and hash checks | Yes | No | No | Reuse locally |
| Restricted safe test | Yes | Display only | Display only | Re-audit guarantees per executor |
| Saved local connections | Yes | No model | No model | Add metadata projection only after identity |
| Decisions and interactions | Partial | Partial | Drifted | Contract repair required |
| Remote Run now | Partial | Yes | Broken auth path | Machine targeting required |
| Conversations | Local IDs and Panel grouping | Run presentation | Run presentation | Keep machine-bound |
| Needs-you aggregation | Pending decisions in several places | Decisions and failures | Decisions tab | Merge at presentation layer |
| Daily brief | No unified product | Partial Home summary | Partial Home summary | Later slice |

## Terminology inventory

| Internal or current term | Current surfaces | Consumer term |
|---|---|---|
| Agent | Everywhere | Assistant in presentation only |
| Cron expression | Definition, settings, Panel | Runs every weekday or equivalent schedule text |
| Prompt | Definition and editor | Instructions |
| Executor, coding agent, provider | Mixed Server UI and docs | AI engine, with exact runtime under Advanced |
| Permission mode and tool allowlist | Definition and settings | What it can read, change, or must ask to do |
| Run | All products | Activity item or run where needed under details |
| Decision, input required | Panel and Server | Needs you, with a specific request |
| Heartbeat | Panel default UI | Last heard from under device details |
| Worker ID | Panel run detail | Device, with process ID under Advanced |
| Logs, tool calls, turns, tokens | Run detail | Technical details |
| Failed | All products | Problem plus cause and next action |

Stable API and database names should remain until a planned migration requires a change. Presentation adapters should translate them.

## Duplicated and conflicting concepts

- Three run state vocabularies exist: local runs, Panel A2A status, and trigger queue status.
- Decision schemas exist in both repositories and differ.
- Panel shared `StatusEventSchema` differs from the route that actually accepts status events.
- Agent identity is a local ID in Server, a generated name slug in Panel, and sometimes a display-name-derived slug in iOS.
- Local and Panel run rows are merged differently in list and detail views.
- Connections mean saved profiles, runtime MCP accounts, service templates, environment variables, and messaging setup.
- Home, feed, activity, run history, output, artifacts, decisions, and logs overlap without one consumer model.

## Consumer UI assessment

### First impression

The macOS home is the closest surface to the proposed direction, but it still frames the product around Agents and layered drawers. Panel web looks like an operations dashboard. Panel iOS looks like a telemetry client. None presents a single obvious answer to “what needs me today?” across machines.

### Usability

- Important intervention items are split between decisions, failed runs, security, missing connections, and setup errors.
- Panel web lacks persistent Today, Assistants, Activity, and Settings navigation.
- Agent Server hides major destinations in footer icons and drawers.
- Panel setup asks ordinary users to create and copy API keys.
- Connection setup exposes MCP URLs, commands, headers, prefixes, and environment variables too early.
- Failure and waiting states often require opening run detail or logs to learn the cause.

### Visual hierarchy

- Panel run details place duration, tokens, cost, heartbeats, run ID, and charts above the result story.
- Home pages contain several panels with similar visual weight.
- Agent detail prioritizes aggregate statistics over readiness, access, results, and attention.
- Cards often offer several actions or disclosures without one dominant next step.

### Consistency

- Web, macOS, and iOS use different navigation and status language.
- Panel iOS data derivation differs from Panel web.
- Similar concepts use Agent, task, assistant, run, activity, decision, and interaction inconsistently.
- Existing design components can be reused, but composition and information order need one shared contract.

### Accessibility and responsive behavior

- Existing code includes accessibility identifiers and native controls in several macOS flows.
- The audit did not find a cross-product standard for focus order, keyboard use, reduced motion, Dynamic Type, contrast, or target size.
- UI release review must include these states and cannot depend only on component tests.

## Protocol and security hard stops

### Machine identity

`worker_id` is `hostname-pid` and changes after restart. Panel has no machines table. `agent_tasks` is unique by organization and slug. Sync from one machine can overwrite or deactivate another machine's assistant.

### Remote command targeting

Realtime tokens and subscriptions are organization-scoped. `run_triggers` has no machine target or atomic machine claim. Run now may execute on more than one machine.

### Decisions

Server decision status posts omit the required `agent` property. Panel resolution shapes do not match the Server's expected `{ action_id, input }`. iOS decodes an older row shape.

### API keys and pairing

Key scopes are stored but not enforced. The UI displays scope names that the creation route does not accept. The generated curl example omits a required field and labels a full endpoint as the base Panel URL.

### iOS integration

iOS sends a user session token to endpoints that expect a Panel API key, opens Realtime without the user JWT, calls revoked cleanup RPCs, and derives assistants from recent runs.

### Privacy

Panel currently receives assistant names, descriptions, summaries, file paths, command strings, tools, progress text, and optional reasoning. Redaction targets common secrets but does not remove usernames, customer text, arbitrary paths, or command arguments. V2 requires an explicit telemetry field policy and consent boundary.

## Documentation conflicts

- `agent-panel/docs/agent-panel-v2.md` describes the retired SSE proxy and cloud authority in several sections. Current code uses direct Supabase Realtime.
- Agent Panel README counts, Node requirements, migration counts, and iOS parity claims are stale.
- Agent Server docs describe older run storage, heartbeat defaults, runtime support, native helper targets, and startup permission behavior.
- Agent Server consumer docs promise a visible rollback and file diff that the macOS UI does not expose.
- Source comments still refer to retired SSE paths.

Current code and executable tests take priority over these documents. The conflicts must be corrected before product claims are reused.

## Baseline verification

| Check | Result |
|---|---|
| Agent Server TypeScript type check | Passed |
| Agent Server lint | Passed |
| Agent Server build | Passed |
| Agent Server Vitest | Failed: 1,392 passed, 4 skipped, 2 failed on first run |
| Focused Server rerun | Sync debounce test passed; Codex file-policy test still failed because its installed binary path does not exist |
| Agent Server Swift package | 478 passed |
| Agent Panel web tests | 443 passed, 46 skipped |
| Agent Panel shared type tests | 68 passed |
| Agent Panel lint, type check, web build | Passed; build warned about missing `metadataBase` |
| Agent Panel iOS tests | Failed: 45 passed, 1 skipped, 1 failed because the API-key fixture lacks required `key_prefix` |

The 46 skipped Panel web tests cover real database decisions, triggers, RLS, cleanup, and telemetry. Those areas need a configured integration baseline before protocol changes. The iOS decoding failure is a second baseline hard stop.

## Proposed migration path

1. Approve the product language, information architecture, privacy policy, and versioned contracts.
2. Restore a green baseline without mixing repairs into V2 feature work.
3. Add stable local machine identity and additive Panel machine records.
4. Add machine-scoped assistant identity without reinterpreting historical `worker_id`.
5. Add targeted, atomic command claiming and one canonical decision contract.
6. Build shared presentation adapters over existing raw states.
7. Ship a read-only Today and Activity slice on web and macOS.
8. Add actions only after local policy and remote targeting are proven.
9. Bring iOS to the approved presentation and authentication contracts.

## Phase 0 decision

The platform direction is viable. No feature implementation should begin until the user approves these documents, the Server baseline is green, and the machine and command contracts are frozen.
