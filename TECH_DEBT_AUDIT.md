# Technical debt audit

Audit date: 2026-07-20

Scope: TypeScript server, native macOS app, EventKit helper, build and release scripts, CI, dependencies, tests, and user-facing documentation.

## Executive summary

- Agent chaining follows the opposite direction from the README contract, and cycles have no ancestry or depth limit. A documented `A -> B` chain may not run as expected, while a reciprocal chain can run indefinitely.
- A run timeout releases the agent lock as soon as abort is requested. An executor that does not stop promptly can continue side effects while a replacement run starts.
- Terminal telemetry can be lost during a panel outage because `runAgent` stops the reporter immediately after scheduling its deferred retry.
- Stored run evidence reaches memory and SQLite before redaction, contrary to the documented storage boundary for commands, progress, summaries, and errors.
- The production dependency graph has 2 high and 11 moderate advisories. Direct `ws` and Hono versions are below patched releases, and dependency auditing is absent from CI.
- CI validates only the TypeScript server on Ubuntu. The macOS app, Swift package, EventKit helper, release scripts, and native build are not merge-gated.
- A clean macOS checkout depends on a sibling NerdsUI repository and an ignored `Info.plist`, so the shipped application cannot be reproduced from tracked inputs alone.
- Several macOS lifecycle paths can hang, terminate unrelated processes, lose decision state, or reconcile concurrent runs incorrectly.
- Release verification can accept HTTP error responses, publication is not transactional, and a stale local appcast can overwrite newer release history.
- The architecture is sound in broad shape, but debt is concentrated in high-churn composition roots: `server.ts`, `api.ts`, `proposal-service.ts`, `EventKitHandler.swift`, and three large SwiftUI views.

## Architectural mental model

The repository ships one product through two cooperating runtimes:

1. `server-app` is a local Node.js orchestration daemon. Agent YAML or Markdown files are the source of truth. `startServer` composes discovery, schedules, file watches, chat channels, authenticated Hono routes, WebSockets, run lifecycle, executor adapters, SQLite history, telemetry, and security services.
2. `macos-app` is the native control plane. `AppDelegate` owns application and child-process lifecycle. `StatusMonitor` combines WebSocket events with HTTP polling. SwiftUI views present agent configuration, activity, decisions, and settings.
3. `AgentServerEventKit` is a separate JSON-RPC stdio helper. It exposes Calendar, Reminders, and Contacts to agents while applying native permission grants.
4. Release scripts compile and embed the server, build and notarize the native app and DMG, update the Sparkle feed, and publish artifacts to Cloudflare R2.

The dependency direction is generally reasonable: configuration and discovery feed the composition root, the run lifecycle delegates to executor plugins, reporters normalize external state, and the macOS app consumes the loopback API. The main risk comes from lifecycle code that crosses these boundaries without one shared transaction, cancellation, or identity model.

## Audit evidence

| Check | Result |
|---|---|
| Repository size | 71,797 TypeScript, Swift, and shell source lines |
| TypeScript strict check | Passed |
| ESLint | Passed |
| Server tests | 1,267 passed, 4 opt-in Kimi conformance tests skipped |
| Server coverage | 81.19% statements, 76.55% branches, 84.11% functions, 82.81% lines |
| Production dependency audit | 2 high and 11 moderate advisories |
| Knip | Unused `ws`, unused `@types/ws`, unlisted `which` binary, and exported surface candidates |
| Depcheck | Unused direct `ws` dependency |
| Madge | One type-only cycle between `reporting/store.ts` and `reporting/run-normalization.ts` |

The four skipped tests are opt-in installed-runtime conformance checks at `server-app/src/plugins/kimi-code.test.ts:50`, `:70`, `:96`, and `:120`. Their skip status is intentional and is not counted as ordinary missing coverage.

## Findings

Severity reflects product impact and likelihood. Effort uses S for less than a day, M for roughly one to three days, and L for a larger refactor.

| ID | Category | File:Line | Severity | Effort | Description | Recommendation |
|---|---|---|---|---|---|---|
| TD-01 | Contract correctness | `README.md:304-325`; `server-app/src/agents/triggers.ts:10-24` | High | M | The README defines `A.on_complete -> B`, but trigger evaluation finds agents whose own trigger references A. Tests encode the reverse implementation rather than the documented behavior. | Establish one direction as canonical, migrate existing files if needed, and add an end-to-end A-to-B test through the real server path. |
| TD-02 | Resource control | `server-app/src/server/run-lifecycle.ts:225-228`; `server-app/src/server/server.ts:358-365` | High | M | Every terminal run can launch another trigger with no chain ID, visited set, or depth cap. Reciprocal triggers can consume tokens indefinitely. | Carry chain metadata through triggered runs, reject revisits, and enforce a configurable maximum depth. |
| TD-03 | Concurrency | `server-app/src/execution/runner.ts:183-213` | High | M | Timeout rejection releases the lock immediately after requesting abort. An executor that ignores or delays abort can continue side effects while another run acquires the lock. | Keep the agent quarantined until executor termination is confirmed, with a separate hard-kill or unhealthy-runtime path. |
| TD-04 | Telemetry durability | `server-app/src/reporting/reporter.ts:275-281`; `:350-399`; `server-app/src/execution/runner.ts:152-176` | High | M | Terminal reporting schedules a deferred retry, then `reporter.stop()` cancels that retry before durable handoff. A panel outage can permanently lose the terminal event. | Persist the terminal payload before returning, or let `stop()` await durable handoff instead of canceling it. |
| TD-05 | Timeout coverage | `server-app/src/execution/runner.ts:127-150`; `server-app/src/reporting/reporter.ts:317-326` | High | M | Reporter startup awaits an unbounded `fetch` before the executor timeout race starts. A stalled panel can hold the lock forever despite the configured run timeout. | Add request deadlines and include reporter start and terminal work in the wall-clock budget. |
| TD-06 | Security and privacy | `server-app/src/server/run-progress-reporter.ts:31-45`; `server-app/src/reporting/run-normalization.ts:36-49`; `server-app/src/reporting/sqlite-store.ts:211-219` | High | M | Progress, commands, summaries, and errors are stored before redaction. This conflicts with the storage requirement in `docs/CONSUMER_AGENT_ARCHITECTURE.md:141-150`. | Put one sanitizer at the run-store boundary and test memory, SQLite, API, and WebSocket representations with secret-bearing inputs. |
| TD-07 | Dependency security | `server-app/package.json:51`; `pnpm-lock.yaml:55` | High | S | Direct `ws` resolves below 8.21.0 and is covered by a high-severity memory-exhaustion advisory. Tooling also reports the direct declaration as unused. | Upgrade the transitive WebSocket path, remove redundant direct declarations if confirmed, and rerun WebSocket behavior tests. |
| TD-08 | Dependency security | `server-app/package.json:50`; `pnpm-lock.yaml:52`; `pnpm-lock.yaml:1139` | High | S | Hono resolves below 4.12.25. The audit includes one high CORS advisory and several moderate advisories, although some adapters are unused here. | Upgrade Hono, document which advisory surfaces apply, and rerun API, CORS, authentication, and body-limit tests. |
| TD-09 | Test coverage | `server-app/src/server/server.ts:236`; `server-app/src/server/server.test.ts:13-29` | High | L | The 957-line production composition root has 10.85% line coverage. Its test reimplements downstream triggering instead of executing the production function. | Extract injectable lifecycle components and test actual startup, trigger, channel, WebSocket, and shutdown behavior. |
| TD-10 | CI coverage | `.github/workflows/ci.yml:3-19`; `:25-50` | High | M | CI path filters and an Ubuntu-only job exclude all macOS, Swift, EventKit, release-script, and native build changes. | Add a macOS job for Swift tests and an unsigned app build, and expand path triggers to all shipped inputs. |
| TD-11 | Build reproducibility | `macos-app/project.yml:8-16`; `:58`; `.gitignore:23` | High | M | The macOS project requires a machine-local `../../../../nerdsui/swift` checkout and an ignored `AgentServer/Info.plist`. A clean clone lacks complete build inputs. | Pin NerdsUI as a remote or workspace package and generate the plist from a tracked template plus injected secrets. |
| TD-12 | Release correctness | `scripts/release.sh:287-305` | High | S | Artifact checks grep response headers, so an HTTP error still matches `HTTP`. The feed check only requires an item and does not verify the requested version, build, URL, signature, or length. | Use `curl --fail`, parse the published XML, and compare every expected release field before success. |
| TD-13 | Process safety | `macos-app/AgentServer/Services/ServerProcessManager.swift:141-150`; `:245-258` | High | M | Restart uses `lsof -ti tcp:47821` and sends SIGTERM to every returned PID. Connected clients can be included, not only the listening daemon. | Resolve listening PIDs only and verify executable identity before signaling. |
| TD-14 | Process lifecycle | `macos-app/AgentServer/Services/ServerProcessManager.swift:128-138`; `:239-243` | High | S | Restart waits without a deadline after termination. A wedged child can freeze restart forever. | Centralize bounded shutdown with a grace period, verified escalation, and a user-visible failure. |
| TD-15 | Concurrency | `macos-app/AgentServer/Services/StatusMonitor.swift:145-190` | High | M | Decision polling creates an untracked task every timer tick. Requests can overlap, finish out of order, overwrite newer decisions, and survive `stop()`. | Apply the same coalescing, cancellation, and generation checks used for run polling. |
| TD-16 | State integrity | `macos-app/AgentServer/Services/StatusMonitor.swift:193-207` | High | S | Decision resolution removes local state before proving that a panel client exists. Invalid configuration can make an unresolved decision disappear until a later poll. | Validate the client first and remove local state only after confirmed remote success. |
| TD-17 | Identity model | `macos-app/AgentServer/Views/AgentRunsView.swift:192-225` | High | M | Local and panel runs are matched only by start time within ten seconds, and one local ID can match several panel rows. Concurrent runs can display another run's state. | Propagate one stable run ID across local execution and panel telemetry. |
| TD-18 | Crash risk | `macos-app/AgentServerSwiftTests/Sources/AgentServerCore/EnvFileStore.swift:143-160`; `:191-197`; `macos-app/AgentServer/Views/SettingsDrawer.swift:448-450` | High | S | Duplicate environment keys pass parsing and validation, then `Dictionary(uniqueKeysWithValues:)` can trap. | Reject duplicates with a typed validation error or apply an explicit first-wins or last-wins policy. |
| TD-19 | Secret handling | `macos-app/AgentServerSwiftTests/Sources/AgentServerCore/EnvFileStore.swift:243-270` | High | S | The secret file is replaced before owner-only permissions are applied, and permission failure is ignored. Credentials can remain too broadly readable. | Create the temporary file as mode 0600, verify permissions, then atomically replace the destination. |
| TD-20 | Unicode correctness | `macos-app/AgentServer/Views/MarkdownEditor.swift:290-350`; `:367-478` | High | M | Highlight ranges use Swift character counts while AppKit attributed strings use UTF-16 offsets. Composed characters can shift or exceed ranges. | Calculate all offsets against `NSString.length` and add composed-Unicode editor tests. |
| TD-21 | Resource control | `macos-app/AgentServerEventKit/EventKitHandler.swift:224-252`; `:501-507` | High | M | Permission and reminder callbacks wait on semaphores without a timeout. A missing callback wedges the single-threaded MCP helper. | Convert handlers to async or return a bounded timeout error. |
| TD-22 | Architecture and tests | `macos-app/AgentServerEventKit/EventKitHandler.swift:5-724`; `macos-app/AgentServerSwiftTests/Package.swift:12-19` | High | L | One 724-line class owns schemas, dispatch, three privacy domains, grants, CRUD, formatting, and serialization. The helper is outside the Swift package test target. | Split Calendar, Reminder, and Contacts handlers behind injected protocols and add helper behavior tests. |
| TD-23 | Conversation correctness | `server-app/src/server/server.ts:757-759` | Medium | S | The active user message is added to the conversation and appended again when history is formatted, so the LLM receives it twice. | Format the stored messages after insertion, or format a pre-insert snapshot plus the new message once. |
| TD-24 | Lifecycle contract | `server-app/src/server/run-lifecycle.ts:239-247` | Medium | S | Lock-contention skips update only the store. They do not emit a terminal WebSocket event, invoke completion hooks, or close chat notifications. | Route skipped runs through one explicit terminal handler. |
| TD-25 | Error handling | `server-app/src/server/run-lifecycle.ts:208-210`; `server-app/src/server/server.ts:314-336` | Medium | S | Interaction delivery is fire-and-forget even though it performs asynchronous channel work. Send failures can become unhandled rejections after the run is marked complete. | Await delivery before terminal success or catch and persist a separate delivery failure. |
| TD-26 | Shutdown hygiene | `server-app/src/server/server.ts:913-914`; `:936-953` | Medium | M | Channel setup promises lack rejection handling, and shutdown does not await HTTP close, file watcher stop, or channel teardown. Partial startup and process exit can leak work. | Model startup as staged acquisition with rollback and make `stop()` an awaited, idempotent shutdown. |
| TD-27 | API memory safety | `server-app/src/server/api.ts:239-247`; `:319-328` | Medium | M | Request size enforcement trusts `Content-Length`, then reads the whole body. Chunked or understated authenticated requests can bypass the cap. | Enforce bytes while streaming or apply a body-limit middleware around the actual reader. |
| TD-28 | Memory growth | `server-app/src/server/security-utils.ts:140-164`; `:172-217` | Medium | S | Rate-limit and authentication maps retain entries until the same key returns after expiry or succeeds. Many source keys can grow memory without a cap. | Sweep expired entries periodically and enforce a bounded map size. |
| TD-29 | API truthfulness | `server-app/src/reporting/panel-client.ts:34-57`; `server-app/src/server/api.ts:667-678` | Medium | S | Panel cleanup converts network failures to zero, so `/cleanup` reports success with zero cleaned instead of reporting an unreachable panel. | Propagate a typed error and map it to an honest non-success response. |
| TD-30 | Dynamic configuration | `server-app/src/server/server.ts:715-734`; `server-app/src/agents/file-watcher.ts:27-41` | Medium | M | File watches are fixed from startup definitions. Agent watch edits do not take effect until restart, unlike schedules that are rediscovered. | Reconcile watcher registrations whenever agent definitions change. |
| TD-31 | Input validation | `server-app/src/agents/file-watcher.ts:19-25` | Medium | S | Glob compilation escapes dots but leaves other regular-expression metacharacters. Valid YAML can produce an invalid regex and crash watcher setup. | Use a maintained glob matcher or fully escape before expanding glob tokens. |
| TD-32 | Observability | `server-app/src/agents/discovery.ts:11-27` | Medium | S | Directory read errors become an empty agent list, and invalid-file reports omit parser causes. Permission loss can appear as a valid zero-agent state. | Distinguish missing, unreadable, and invalid sources with sanitized error codes and paths. |
| TD-33 | Release consistency | `scripts/release.sh:239-279` | Medium | M | The script updates a local tracked appcast without comparing the deployed feed or rejecting duplicate version and build entries. A stale branch can overwrite newer history. | Fetch and validate the live feed before mutation, then reject stale or duplicate publication. |
| TD-34 | Release atomicity | `scripts/release.sh:218-237` | Medium | M | The versioned DMG and `latest` alias publish before appcast generation. A later failure leaves the stable download pointing to a release clients were not told about. | Stage all artifacts, validate them, publish immutable objects, publish the feed, and update `latest` last. |
| TD-35 | Release input safety | `scripts/release.sh:33`; `:111`; `:247` | Medium | S | Version and release notes are interpolated into Python and XML without semantic-version validation, CDATA protection, or an XML parse check. | Pass values as arguments or environment data, validate the version, escape XML, and parse the result before upload. |
| TD-36 | Documentation drift | `README.md:994-1064`; `macos-app/SPARKLE.md:171`; `docs/SPARKLE.md:5-163` | Medium | S | Release documentation still describes Supabase and ZIP flows while the current scripts publish a DMG and Sparkle feed to R2. | Make one release guide canonical and replace duplicate guides with links or clearly labeled history. |
| TD-37 | Documentation drift | `README.md:829-929`; `macos-app/project.yml:79-106` | Medium | S | README build instructions describe `pnpm install`, `server-app/package-lock.json`, and a different cache model. Xcode uses the root pnpm lock and `pnpm deploy`. | Generate the build section from the actual project phase or update it in the same change as build scripts. |
| TD-38 | Public interface tests | `server-app/vitest.config.ts:9`; `server-app/package.json:8` | Medium | M | The CLI is excluded from coverage even though it exposes start, run, install, uninstall, cleanup, and init. | Put command construction behind an exported factory and test argument parsing and wiring without spawning a daemon. |
| TD-39 | Coverage policy | `server-app/vitest.config.ts:14-23`; `docs/FINAL_VERIFICATION.md:81` | Medium | S | Coverage thresholds sit about eight points below current line and statement coverage, allowing a large regression while CI stays green. | Ratchet thresholds near the current baseline and raise them with tested refactors. |
| TD-40 | Configuration contract | `README.md:655-718`; `server-app/src/server/server.ts:236-241`; `server-app/src/platform/config.ts:70-120` | Medium | S | The README presents API auth as conditional and omits several supported environment controls, while startup always requires a key. | Generate one environment reference from the configuration schema and document generated-key behavior. |
| TD-41 | Secret display | `macos-app/AgentServerSwiftTests/Sources/AgentServerCore/EnvFileStore.swift:79-115` | Medium | S | Secret detection misses common names such as `PASSWORD`, `PRIVATE_KEY`, and `AUTH`, and secrets of four characters or fewer are shown in plaintext. | Use an explicit secret-field catalog with conservative name fallback and always mask short values. |
| TD-42 | Data minimization | `macos-app/AgentServerEventKit/EventKitHandler.swift:299-337`; `:471-523`; `:607-663` | Medium | M | Event, reminder, and contact list tools have no limit or pagination. Large accounts can create huge responses and expose more native data than needed. | Add bounded defaults, maximum limits, and continuation metadata. |
| TD-43 | UI architecture | `macos-app/AgentServer/Views/GuidedAgentCreationView.swift:63-774`; `macos-app/AgentServer/Views/AgentSettingsView.swift:1-700`; `macos-app/AgentServer/Views/SettingsDrawer.swift:1-669` | Medium | L | Three high-churn views combine layout, navigation, validation, async orchestration, persistence, and AppKit panels. | Extract action and state models first, then split stable sections into focused views. |
| TD-44 | Duplication | `server-app/src/services/registry.ts:67-73`; `server-app/src/connections/adoption.ts:45-51` | Low | S | Two identical recursive value normalizers define digest identity in separate modules. Future drift could make adoption disagree with registry identity. | Export one canonical normalizer and cover it through both public behaviors. |
| TD-45 | Dead architecture | `server-app/src/channels/telegram.ts:330-342`; `server-app/src/server/server.ts:857-862`; `server-app/src/channels/telegram-decision-bot.ts:210-233` | Low | M | The append-only Telegram decision bot is not wired by production server setup while a separate panel decision flow is active. | Confirm the intended decision architecture, then remove this path or wire and test it deliberately. |
| TD-46 | Documentation accuracy | `README.md:1383`; `:1415-1421`; `server-app/package.json:21`; `macos-app/project.yml:8-16` | Low | S | The README claims 486 tests, Node 20+, and no third-party macOS dependencies. Current reality is 1,267 active server tests, Node 22.13+, and three declared Swift packages. | Remove volatile counts where possible and validate requirements against manifests during documentation checks. |

## Top five refactor outlines

### 1. Make trigger direction and chain safety explicit

Target: TD-01 and TD-02.

```diff
- evaluateTriggers(completedAgentId, allAgents)
+ evaluateTriggers(completedAgent, allAgents, chainContext)

+ type ChainContext = {
+   chainId: string
+   visitedAgentIds: readonly string[]
+   depth: number
+ }
```

Interpret `completedAgent.on_complete` and `completedAgent.on_failure` as outgoing edges. Resolve each referenced target by ID. Reject an edge when the target is already visited or depth exceeds the configured cap. Include the chain ID and ancestry in run metadata. Add behavior tests for A-to-B success, failure routing, missing targets, A-to-A, A-to-B-to-A, and depth exhaustion.

### 2. Preserve exclusivity until executor termination

Target: TD-03 and TD-05.

```diff
- const result = await raceWithTimeout(executorPromise, timeout, abortController)
- finally { releaseLock() }
+ const execution = startExecution(...)
+ const outcome = await execution.waitWithin(timeout)
+ if (outcome.timedOut) await execution.terminateWithin(gracePeriod)
+ if (!execution.isTerminated) quarantineAgent(agent.id)
+ releaseLockOnlyAfterTerminationOrQuarantine()
```

Give every executor adapter a termination contract that reports when its child process or SDK stream is actually closed. Apply bounded deadlines to reporter requests and start the wall-clock budget before reporter startup. A quarantined agent should reject new work with a precise reason until process ownership is resolved.

### 3. Make terminal telemetry durable

Target: TD-04.

```diff
- scheduleDeferredRetry(payload)
- reporter.stop() // cancels timer
+ await terminalOutbox.put(payload)
+ reporter.stopLiveUpdates()
+ terminalOutbox.flushInBackground()
```

Use a small SQLite-backed outbox keyed by run ID and terminal sequence. Mark delivery complete only after the panel acknowledges it. Retry with bounded backoff across server restarts. Keep live progress best-effort, while making completion, failure, timeout, and cancellation durable.

### 4. Redact once at the storage boundary

Target: TD-06.

```diff
- runStore.update(runId, rawProgress)
+ runStore.update(runId, evidenceSanitizer.sanitize(rawProgress))
```

Create a single `EvidenceSanitizer` that accepts summaries, errors, commands, tool inputs, and progress metadata. Inject it into every run-store implementation so raw evidence cannot be persisted accidentally. Use the same secret cases against the in-memory store, SQLite store, API response, WebSocket event, and telemetry payload.

### 5. Replace native lifecycle heuristics with owned identities

Target: TD-13 through TD-17.

```diff
- lsof -ti tcp:47821
- match local and panel runs by timestamp
+ persist OwnedServerProcess(pid, executableURL, launchToken)
+ propagate one runId from local start through panel telemetry
```

Record the spawned PID, canonical executable path, and a random launch token. Before signaling, verify all three. Use one bounded shutdown primitive for restart and app termination. Propagate the server run ID to the panel and remove timestamp matching. Give decision polling one tracked task with cancellation and generation checks.

## Quick wins

- [ ] Upgrade Hono to at least 4.12.25 and the effective `ws` version to at least 8.21.0.
- [ ] Remove direct `ws` and `@types/ws` declarations if builds confirm they are redundant.
- [ ] Add `pnpm audit --prod` to CI with an explicit advisory exception process.
- [ ] Make release checks use `curl --fail` and validate the exact appcast version and build.
- [ ] Reject duplicate `.env` keys before dictionary construction.
- [ ] Always mask short secrets and expand secret-name detection.
- [ ] Add a deadline to EventKit semaphore waits.
- [ ] Propagate panel cleanup failures instead of returning zero.
- [ ] Fix conversation history so the newest user message appears once.
- [ ] Escape glob metacharacters or replace the custom compiler.
- [ ] Ratchet coverage thresholds to the current baseline.
- [ ] Correct Node requirements, test counts, dependency claims, and release-host documentation.
- [ ] Add explicit least-privilege permissions and immutable action SHAs to CI.

## Things that look bad but are actually fine

- `server-app/src/reporting/store.ts:1-5` and `server-app/src/reporting/run-normalization.ts:1` form a Madge cycle, but the reverse edge is a TypeScript `import type`. It disappears at runtime and does not create initialization-order risk.
- Synchronous lock operations in `server-app/src/execution/lockfile.ts:49-93` are short critical sections. Exclusive creation, ownership metadata, and `finally` release make synchronous I/O reasonable here.
- `node:sqlite` is synchronous in `server-app/src/reporting/sqlite-store.ts:61-79`, but this is a bounded single-user local daemon. WAL and busy timeout are configured at `:129-140`.
- `AgentConfigSchema.passthrough()` at `server-app/src/agents/config.ts:237-272` preserves unknown fields during forward-compatible editing. Known security-sensitive fields still use strict nested schemas.
- Boundary code uses many `unknown` values, but it generally narrows them before use, as in `server-app/src/plugins/claude-code.ts:384-434`. This is preferable to spreading `any` through the model.
- The generated Xcode project is ignored at `.gitignore:41`, and `scripts/release.sh:130` regenerates it from `project.yml`. Ignoring it is appropriate even if older generated files remain tracked.
- Tracking `dist/appcast.xml:1` is intentional release history. The debt is the missing comparison with remote state, not the tracked file itself.
- UI test scenario shortcuts in `macos-app/AgentServer/App/AppDelegate.swift:21-26` are guarded by `#if DEBUG` and cannot enter the release binary.
- Timers and sockets in `macos-app/AgentServer/Services/StatusMonitor.swift:160-169` and `:435-444` have explicit cleanup. Their presence alone does not show a leak.
- The EventKit dispatcher filters discovery and calls through the grant policy at `macos-app/AgentServerEventKit/EventKitHandler.swift:171-176`; a broad switch does not bypass native-service restrictions.
- The root package remains version 0.1.0 at `package.json:2`, while the shipped server is 3.2.0 at `server-app/package.json:2`. The root is a private workspace command facade and does not need product-version parity.
- The four Kimi tests skipped by default require an installed external runtime. Keeping them opt-in is reasonable as long as ordinary adapter behavior remains covered by deterministic tests.

## Open questions

- Which chaining direction is the compatibility contract: the README's outgoing-edge model or the current evaluator's incoming-reference model? Existing user agent files should be sampled before migration.
- Should timed-out runtime processes be force-killed, or should the server quarantine the agent and require manual recovery when graceful abort fails?
- Is durable terminal telemetry required when the panel is unavailable, or is local SQLite the authoritative record?
- Which run evidence fields may be persisted locally, and what redaction rules apply to commands, paths, tool inputs, and third-party responses?
- Is NerdsUI intended to remain a private sibling checkout, or can it become a pinned remote package?
- Is the ignored macOS plist machine-specific because it contains a PostHog key? If so, should release tooling generate it from a tracked template and Doppler?
- Is the public R2 hostname the current `r2.dev` endpoint or `downloads.strategicnerds.com`? The feed and documentation disagree.
- Are `docs/FINAL_VERIFICATION.md`, `docs/BUILD_WEEK.md`, and the manual test matrix archival records or living instructions?
- Does production use any Hono CORS, JWT, static-file, Lambda, or Lambda@Edge paths? That determines which advisories are reachable before the upgrade.
- Is the append-only Telegram decision bot still planned, or can the panel-backed decision path replace it completely?
