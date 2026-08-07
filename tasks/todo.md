# Build Week plan: Guided creation, debugging, and security

## Runtime-neutral installed-agent migration

- [x] Add semantic connection declarations and machine-local runtime assignments.
- [x] Add checked local connection profiles, reviewed operation mappings, resource bindings, and runtime compatibility checks.
- [x] Enforce portable output contracts and exact resource targets across Claude Code, Codex, and Kimi Code.
- [x] Add the Notion Personal and Calendar Work profiles on this machine and check their current tool inventories.
- [x] Prove that the personal Notion token cannot access the work Notion data source.
- [x] Add checked local Claude implementations for searchable Slack, Linear, Notion Work, Gmail Work, and Calendar Work.
- [ ] Add Customer.io when `proactive-work` is enabled.
- [x] Generate and apply exact reviewed patches for all seven installed agents.
- [x] Run harmless live Claude Code and Codex checks. Kimi Code is not installed on this machine.
- [x] Run the full server and macOS verification gates.
- [x] Present the exact per-agent changes before any commit.

Review:

- Agent definitions can now name human-readable services, purposes, semantic operations, and logical resources without naming an LLM or concrete MCP tool.
- Runtime and account choices live in local files next to the agents directory. Synced agent Markdown stays shareable.
- Targeted reads now require an approved readable resource when the adapter can enforce one. Dynamic page reads remain valid after a scoped search or query returns a page ID.
- The saved EventKit adapter provides checked Calendar operations for a future non-Claude binding. The enabled `daily-focus` agent currently uses the existing Claude Calendar account.
- Codex account apps work interactively, but the unattended CLI does not expose a narrow per-app tool restriction. Scheduled runs therefore use checked local MCP profiles instead of inheriting every enabled Codex app.
- The seven shared files are migrated. All six enabled agents pass the live server's Claude Code compatibility check. Disabled `proactive-work` reports only its intentionally unbound Customer.io use.
- The running app now uses this repository's verified server build and exposes API version 13. The restart was announced before it happened.
- Verification passes: 133 server test files, 1,686 tests passed, 4 skipped; 572 Swift tests; ESLint; both strict TypeScript checks; server build; unsigned macOS app build; and harmless one-turn Claude Code and Codex executions.

## Version 3.4.5 release

- [x] Stop asking for Claude account setup from an engine that cannot use it.
- [x] Diagnose the manuscript file check, which turned out to be a true report.
- [x] Point the manuscript agent at the real Drive path in the brain repo.
- [x] Run the canonical release pipeline for version 3.4.5, then commit and push main.
- [ ] Confirm on the affected machine that every agent reads healthy.

Review:

- Account connectors belong to the Claude runtime, and `buildServiceRegistry`
  builds none when an agent selects another engine.`accountConnectionFacts` read
  the agent's tool rules regardless, found no registry entry, fell back to the
  bare server label, and reported needing setup. Switching one agent to Codex
  therefore badged it for a connector that engine can never use, and no action
  could have cleared it. The reader now matches the registry and reports no
  account checks for a non-Claude engine.
- The remaining file check was correct. `~/My Drive` is a convenience symlink
  Google Drive for Desktop creates on some Macs and not others; one laptop had
  it and the other did not, so the path resolved here and not there. The agent
  now uses the real `Library/CloudStorage` path, which resolves on both. That
  agent had never been able to hash the manuscript on the affected machine, so
  its runs there were silent no-ops.
- Four badge reports in this sequence, four different causes, one shape: a check
  asserting more than its evidence supports. The exception was the last one,
  which was true, and treating it as another false badge cost time. Confirm a
  check is wrong before fixing the check.
- Verified: `tsc --noEmit` on both configs, 122 test files, 1584 tests passed,
  4 skipped. Released as 3.4.5 build 43, notarized, stapled, Sparkle-signed, and
  live on the update feed, with the appcast, immutable download, and latest
  alias all agreeing at 19,594,353 bytes.

## Version 3.4.4 release

- [x] Read an agent's own inline MCP server instead of a catalog entry sharing its name.
- [x] Stop the discovery probe dropping a connector the runtime already reported.
- [x] Report a refused path check as unchecked rather than missing.
- [x] Run the canonical release pipeline for version 3.4.4, then commit and push main.
- [ ] Confirm on the affected machine that every agent reads healthy.

Review:

- 3.4.3 fixed the probe's stopping rule but left three checks still claiming
  more than their evidence supports, and all three were badging one machine.
- The capability catalog holds a placeholder connection for every known service,
  bound to the same runtime server name an agent may choose. An OAuth service
  can never satisfy `isReady`, so its placeholder sits at `needs_setup`
  permanently. `configuredInlineFacts` chose between that placeholder and the
  connection built from the agent's own `mcp_servers` entry by sorting ids, and
  `catalog:linear` sorts ahead of `mcp:linear:<digest>`. A working inline Linear
  server lost to a placeholder. The reader now asks the registry which
  connection is the agent's, through the exported `inlineConnectionId`.
- The settling loop introduced in 3.4.3 replaced its result with each new read.
  A status read is a snapshot of a runtime still assembling connectors, so a
  later read listing fewer servers discarded connectors already reported. This
  is a regression 3.4.3 introduced, and it is how one machine reported 20
  servers where it should have seen 24. Reads now fold together: later status
  wins, and a server reported once is never dropped.
- `accessSync` refusing with EACCES or EPERM was read as a missing file. A
  daemon cannot answer a macOS privacy prompt, so a protected volume such as
  Google Drive refuses outright. Only ENOENT means the path is gone. A refused
  inspection now reports as could not be checked and lists as deferred.
- Each fix was proved by reverting it and watching its test fail, because 3.4.2
  shipped green against a test factory that fabricated a value the collector
  could not produce.
- Verified: `tsc --noEmit` on both configs, 122 test files, 1583 tests passed,
  4 skipped. Released as 3.4.4 build 42, notarized, stapled, Sparkle-signed, and
  live on the update feed.

## Version 3.4.3 release

- [x] Diagnose why agents still read "Needs attention" on the full-time server after 3.4.2.
- [x] Fix the MCP discovery probe so it waits for account connectors to attach.
- [x] Run the canonical release pipeline for version 3.4.3, then commit and push main.
- [ ] Confirm on the affected machine that `/connections` reports the full connector list.

Review:

- 3.4.2 fixed the readiness rules, but one machine still badged every agent. The
  cause was earlier in the chain: `probeMcpServers` stopped polling as soon as no
  server was pending, and the Claude runtime attaches claude.ai connectors after
  the first `mcpServerStatus()` read. A read that landed early saw only the
  injected eventkit server, found nothing pending, and cached a one-server
  answer, so `accountConnections` reported Notion, Slack, Linear, Gmail, and Hex
  as needing setup while they were connected.
- The probe now treats a result as settled only when nothing is pending and the
  server set has stopped changing between reads. The attempt ceiling is
  unchanged, so a slow connector still cannot hang the probe. The common case
  costs one extra 500ms read, once, on the first connections read after start.
- The machine that showed the bug loses this race; the machine that did not, wins
  it. The fix was verified against the exact status sequence from the affected
  machine's logs, not against that machine.
- Known and unfixed: `runtimeStatus` maps a `pending` connector to `needs_setup`
  (`services/registry.ts:257`). If the settling window ever closes while a
  connector is still connecting, the false badge returns. "Still connecting" is
  unprovable and should stay out of the badge, which needs a new state on
  `ServiceConnectionStatus` and reaches the API and the Swift decoder.
- Verified: `tsc --noEmit` on both configs, 122 test files, 1580 tests passed,
  4 skipped. Released as 3.4.3 build 41, notarized, stapled, Sparkle-signed, and
  live on the update feed.

## Version 3.4.2 release

- [x] Fix the Assistant home badge reading "Needs attention" for every agent.
- [x] Run the canonical release pipeline for version 3.4.2 with release text "Bug fixes".
- [x] Verify tests, type checking, signing, notarization, stapling, Sparkle metadata, immutable download, latest alias, and the live feed.
- [x] Install and launch the released app, verify local API health and per-agent readiness, then commit and push main.

Review:

- Two defects made every agent read "Needs attention". Engine sign-in cannot be
  proven before a run, so the engine readiness check could never pass and any
  unknown check demoted the whole agent. Readiness now reports only what is
  known to be wrong, and unknown checks list apart from blockers.
- Account connectors are keyed by runtime display name ("claude.ai Notion")
  while tool rules carry the sanitized spelling ("claude_ai_Notion"), so Notion,
  Slack, Linear, and Gmail read as needing setup while connected. Both sides now
  compare through `mcpServerKey`.
- The suite stayed green because the test factory fabricated an engine
  authentication value the real collector cannot produce. A test now drives the
  actual collector end to end.
- Verified on the installed 3.4.2 build: all seven local agents report healthy
  (or paused, for the one that is disabled) with "Run now".

## Version 3.4.1 release

- [ ] Confirm main is clean, the live feed is version 3.4.0 build 38, and release credentials and tools are available.
- [ ] Run the canonical release pipeline for version 3.4.1 with release text “Bug Fixes”.
- [ ] Verify tests, type checking, linting, signing, notarization, stapling, Sparkle metadata, immutable download, latest alias, and both feed URLs.
- [ ] Install and launch the released app, verify local API health and runtime discovery, then commit and push main.

Constraints:

- Do not push until the uploaded release and installed app pass verification.
- Preserve the canonical Sparkle publication order and immutable release history.
- Use the full Xcode toolchain for Swift tests, signing, and notarization.

Review:

- Pending release.

## Version 3.4.0 release

- [x] Confirm main is clean, current work is committed, and the live feed is version 3.3.4 build 37.
- [x] Run the canonical release pipeline with release text “Revamped UI, Bug fixes”.
- [x] Verify tests, type checking, linting, signing, app and DMG notarization, stapling, Sparkle signature, immutable download, latest alias, and both feed URLs.
- [x] Confirm version and build metadata changed only as expected.
- [x] Install and launch the released app, verify local API health and runtime discovery, then commit and push main.

Constraints:

- Perform comprehensive verification locally. Do not add or trigger GitHub Actions for the release.
- Do not push until the uploaded release and installed app pass verification.
- Preserve the canonical Sparkle publication order and immutable release history.

Review:

- Agent Server 3.4.0 build 38 passed 1,555 server tests with 4 expected skips, 540 Swift behavior tests, strict TypeScript checking, ESLint, server compilation, and the signed Release archive build.
- Apple accepted application submission `e1cb45ba-7da9-4c26-9f9c-b21b74b25651` and DMG submission `7a27f31d-306f-4d54-8e76-624d511aa315`. Both artifacts were stapled and validated.
- The Sparkle-signed 19,490,542-byte DMG and appcast are live with the release text “Revamped UI, Bug fixes”. Versioned and latest downloads match the local artifact byte for byte.
- The notarized app installed from the DMG, reports version 3.4.0 build 38, starts API version 12 with server version 3.4.0, and finds installed Claude Code, Codex, and Kimi Code runtimes.

## Claude MCP status settling

- [x] Reproduce pending MCP statuses against the installed Claude runtime.
- [x] Wait for connection states to settle without consuming a model turn.
- [x] Bound the wait and preserve truthful pending states on timeout.
- [x] Verify focused tests, full checks, app build, and the running app.

Constraint:

- Do not turn connection discovery into an agent run or incur model-token usage.

Review:

- The installed Claude runtime moved from 15 pending servers to zero pending servers after about four seconds, proving the original UI sampled startup state too early.
- Connection discovery now checks every 500 milliseconds for up to five seconds and returns as soon as all servers settle.
- The probe still aborts before a model turn, and a server that exceeds the bounded window retains its raw pending state.
- A connector still pending when the disposable probe ends is labeled Available in the consumer UI. Its raw Technical details state remains pending.
- Verification passed: 61 focused tests, 1,555 full server tests with 4 expected skips, ESLint, strict TypeScript checks, server build, and unsigned macOS app build.

## CI cost audit

- [x] Inventory GitHub Actions in Agent Server and Agent Panel.
- [x] Identify paid runner exposure, duplicate work, schedules, and expensive matrices.
- [x] Recommend the smallest local-first CI policy without changing workflows.

Constraint:

- Do not add or expand GitHub Actions without explicit approval.

Review:

- Agent Server is public and currently incurs no direct hosted-runner charge, but its macOS job runs for server-only and documentation changes. Split path gates before the repository ever becomes private.
- Agent Panel is private. Its Web CI repeats dependency installation, build work, and the same test selection with and without coverage. Its production workflow runs on every main push and uses a separate runner only for a summary.
- Neither repository uses scheduled Actions, matrices, or artifact upload/download. Existing concurrency cancellation already limits superseded runs.
- Recommended next change, pending approval: narrow Panel production paths, fold the summary into an existing job, run one cheap PR lane, reserve full Supabase integration for relevant changes, and keep Server macOS checks limited to macOS code.

## Coding-agent MCP inventory

- [x] Discover bounded MCP inventories for Claude Code, Codex, and Kimi Code.
- [x] Return only server names and coarse states from the local API.
- [x] Show each coding agent's MCP servers in Connections without duplicating Claude.
- [x] Preserve truthful distinctions between live health and configured state.
- [x] Verify focused tests, full suites, lint, builds, and the running app.

Constraints:

- Never return commands, URLs, headers, environment values, tokens, or executable paths.
- Keep agent-definition MCP servers on the owning Agent home.
- A failed inventory check must not erase the last good result.

Review:

- Claude Code uses its structured live MCP status probe. Codex uses its JSON MCP inventory, and Kimi Code reads its bounded user-level MCP configuration.
- The local API returns only sanitized server names, coarse states, inventory state, and evidence type. It omits paths, commands, URLs, headers, environment values, and raw errors.
- Connections now nests each MCP server under its coding agent. Claude health says Connected when proven; Codex and Kimi entries say Configured because configuration alone does not prove connectivity.
- Project-scoped MCP configuration remains attached to the owning Agent instead of being presented as machine-wide availability.
- Verification passed: 1,553 server tests with 4 expected skips, 540 Swift tests, ESLint, strict TypeScript checks, server build, and unsigned macOS app build.

## Activity skipped-run meaning

- [x] Distinguish a successful already-completed no-op from a blocked skipped run.
- [x] Keep the same state and color in All and Problems.
- [x] Verify the presentation tests, full server suite, and app build.

Constraints:

- Preserve the retained run status and code as the source of truth.
- Do not hide or merge historical runs in this fix.

Review:

- `already_completed_today` remains a green Finished outcome but now says the agent “already ran today.”
- Blocked skips such as `lock_contention` remain red Problems and say the agent “did not run.”
- The shared run review supplies the headline, so All and Problems cannot assign competing meanings to one run.
- Verification passed: 22 focused presentation tests, 1,549 full server tests with 4 expected skips, TypeScript checks, ESLint, server build, and unsigned app build.

## Local coding agents in Connections

- [x] Prove Claude connection discovery uses the installed Claude Code runtime.
- [x] Expose Claude Code, Codex, and Kimi Code availability without paths or false login claims.
- [x] Add an AI engines section to Connections with honest local status.
- [x] Distinguish a failed Claude connection check from a successful empty result.
- [x] Verify focused server and Swift tests, full suites, lint, type-check, and builds.

Constraints:

- Never expose executable paths or claim an agent is signed in without a deterministic check.
- Keep project-scoped Claude MCP connections on the owning agent, not in a global list.
- Preserve the existing connection profile and messaging flows.

Review:

- The machine-local Connections response now includes bounded availability for Claude Code, Codex, and Kimi Code. It never includes executable paths and reports authentication as unknown.
- Claude MCP discovery now uses the installed Claude Code executable, matching the runtime and account used for real agent runs.
- Connections shows an AI engines section and separates checking, failed-check, successful-empty, installed, and unavailable states.
- Verification passed: 156 focused server tests, 6 focused Swift tests, 1,548 full server tests with 4 expected skips, 538 full Swift tests, ESLint, TypeScript checks, server build, and unsigned app build.

## Agent terminology

- [x] Replace consumer-facing Assistant and Assistants copy with Agent and Agents.
- [x] Preserve stable API, schema, YAML, persistence, type, and accessibility identifiers.
- [x] Update behavior tests and verify the complete macOS app.

Review:

- macOS navigation, creation, Agent home, Activity, Connections, Settings, diagnostics, security, and interaction copy now use Agent and Agents.
- Server-owned consumer presentation for Today, Agent home readiness, and run review uses the same language.
- Stable `assistant_id`, `assistant:*`, `/presentation/assistants`, Swift type names, and accessibility identifiers remain unchanged for compatibility.
- Verification passed: 538 Swift tests, 1,548 server tests with 4 expected skips, ESLint, TypeScript checks, server build, and unsigned app build.

## Settings Advanced Bento layout

- [x] Inventory every existing Settings > Advanced control and preserve its behavior.
- [x] Group related controls into a responsive Bento-style card layout.
- [x] Verify narrow widths, keyboard access, VoiceOver order, tests, and the app build.

Review:

- Wide Settings > Advanced uses two independent card stacks: AI engine, Local server, and Environment on the left; Agent Panel, Diagnostics and telemetry, and Security on the right.
- The independent stacks remove empty grid-row space while preserving all six cards and every existing control.
- Widths below 760 points use the original single-column reading order so environment fields, steppers, and action rows do not crowd.
- Card titles now expose heading semantics, and the disclosure announces itself as Advanced settings with expanded or collapsed state.
- Verification passed: 14 focused Settings tests, 538 full Swift tests, and the unsigned app build.

## Compact Activity search

- [x] Add behavior tests for the normal tab labels and expanded search state.
- [x] Put search on the same toolbar row as the Activity filters.
- [x] Expand the search field leftward from a trailing search button.
- [x] Collapse filter labels to circular initials while search is open.
- [x] Verify keyboard focus, accessibility labels, reduced motion, Swift tests, and the unsigned app build.

Constraints:

- Keep Activity filtering and search semantics unchanged.
- Reuse the existing design system and native SwiftUI controls.
- Do not alter Today, server APIs, or persisted state.

Review:

- Activity now keeps filters and search on one row. The trailing search button opens a focused field toward the left while filters animate into 30-point circles labeled A, N, W, F, and P.
- Full filter meaning remains available to VoiceOver, Escape closes and clears search, and reduced-motion settings remove the spring animation.
- The subtitle now reads “History of work performed by assistants on this Mac.”
- Verification passed: 6 focused Activity tests, 536 full Swift tests, and the unsigned Debug app build.

## Agent Server V2 implementation

- [x] Restore and record a green TypeScript, Swift, lint, and build baseline.
- [x] Add stable workspace-local machine identity with owner-only persistence.
- [x] Add V2 status and assistant-sync serialization behind V1 compatibility controls.
- [x] Add the pure machine-targeted command boundary for target, expiry, replay, support, and local policy checks. Keep transport claim blocked until Panel supplies atomic machine-scoped semantics.
- [x] Normalize approve, pick, answer, and defer decisions at the local boundary.
- [x] Add tested consumer presentation adapters for Today, health, readiness, permissions, activity, run review, and human timelines.
- [x] Build consumer-grade macOS Today and Activity with Technical details disclosure.
- [x] Build Assistant home, readiness, Connections, and Settings integrations.
- [ ] Build the pairing client after Agent Panel freezes the secure machine-scoped contract.
- [x] Verify offline operation, privacy defaults, compatibility, and all automated test suites.
- [ ] Complete the signed visual matrix in an unlocked macOS session.

Constraints:

- Work only in Agent Server. Do not edit Agent Panel.
- Keep V1 compatibility throughout V2 and keep all new remote behavior disabled until the compatible Panel capability is proven.
- Write every production change in response to a failing behavior test and commit only verified batches.
- Do not weaken permissions, security analysis, content hashes, output contracts, local API authentication, or executor-specific safety.

Today and Activity review:

- The macOS app now opens on a server-owned Today snapshot with Needs you, Working, Finished, Problems, and Upcoming sections. Each row has one primary action.
- Needs-you choices load through the authenticated local API, expose only safe labels and descriptions, validate the response locally, and atomically claim the interaction before triggering follow-up work.
- Activity is deliberately different from Today. It is a chronological local history with search, status filters, dated groups, and direct run-review navigation. Today remains a bounded current-work queue.
- Run selection now opens the exact retained run in the existing detail drawer. Raw events, logs, models, tool names, and tokens remain behind Technical details.
- Offline snapshot failures retain the last good local presentation instead of blanking the screen. Panel availability is not required.
- Visual inspection covered Today, dated Activity, and the interaction response sheet in the compiled macOS app. The review found and fixed low-contrast secondary actions, content alignment, and excessive Today and Activity similarity.
- Verification passed with 1,495 server tests and 4 expected skips, 513 Swift behavior tests, 12 EventKit tests, strict TypeScript checking, ESLint, server compilation, and an unsigned Debug macOS build. The deterministic UI scenarios remain in the UI-test target; an unsigned XCTest host result is not counted as a passing gate.

Assistant home review:

- Added an authenticated, read-only Assistant home endpoint that composes machine-scoped identity, purpose, health, readiness, schedule, effective permissions, connections, destination, recent outcomes, attention, and server-selected actions.
- Readiness uses deterministic runtime, filesystem, schedule, connection, and permission checks. Unknown or unsupported evidence stays visible as unavailable and cannot enable Run or Safe test.
- Effective permission rules are translated into human statements without creating a second permission system. Secret values, full paths, instructions, and raw technical state remain outside the default presentation.
- The macOS Assistant home now leads with health and one primary action, then readiness, schedule, results, access, connections, recent outcomes, secondary actions, and Advanced details. Edit and History remain available without duplicating the home surface.
- Visual inspection of the compiled light-theme scenario confirmed a clear reading order, one primary action, readable access rules, and calm card density at 1280 by 932 points.
- Verification passed with 1,510 server tests and 4 expected skips, 521 Swift behavior tests, 12 EventKit tests, strict TypeScript checking, ESLint, server compilation, and an unsigned Debug macOS build.

Protected test review:

- Added one server-owned executor support policy used by proposal review, save receipts, Assistant home, and the protected-test endpoint. Clients do not infer safety from an engine name.
- Claude Code and Kimi Code now have composed executor tests proving reviewed local reads remain read-only while file changes, commands, web tools, MCP tools, native services, notifications, conversations, and downstream triggers cannot perform effects.
- Codex protected tests fail closed with a human reason because command isolation is not yet proven. The macOS creation flow hides the protected-test action when Server reports it unavailable.
- Every reviewed file grant becomes read-only in the ephemeral test configuration. The saved assistant definition is unchanged.
- Completed protected tests report recorded reads and blocked effects. They no longer repeat model readiness claims, and saving without a protected test no longer says the assistant is ready.
- Verification passed with 1,519 server tests and 4 expected skips. Focused macOS contract, creation-flow, Connections, Settings, and navigation checks passed with 136 tests.

Connections and Settings review:

- Connections is now a labeled desktop destination. Saved, configured, and discovered rows lead with a human label, consumer method, readiness, and one trailing action.
- Endpoint, command, transport, credential references, environment names, and custom connection setup are under Technical details or an explicitly advanced flow. Existing local credential storage and transactional rollback remain unchanged.
- Settings now leads with General, Notifications, Appearance, and Updates. AI engine, local server paths, Agent Panel manual setup, telemetry, Environment, and Security are under Advanced.
- Security was removed from persistent utility navigation but remains available from assistant context and Settings > Advanced.
- True provider health, last-checked time, and assistant-usage counts remain unclaimed because current local evidence proves configuration readiness only.
- Verification passed with 526 Swift behavior tests and an unsigned Debug macOS build. Visual capture was attempted against the compiled live route, but the overnight display session was locked and returned a black capture; no screenshot is claimed.

Pairing hard stop:

- Agent Server has stable machine identity and secure legacy manual setup, but Agent Panel has not frozen the pairing endpoint, response schema, code consumption point, credential rotation, revocation, recovery, capability negotiation, or machine-scoped RLS semantics.
- A pairing client is intentionally not implemented from assumptions. Doing so could consume a one-time code without recoverable credential persistence or attach a machine credential to organization-scoped routes.
- Manual API-key setup remains under Advanced. Local execution, connections, schedules, and history remain independent of Panel.

Final local-first review:

- Panel startup sync and run reporting no longer block local server readiness, execution, terminal state, history, or lock release. Terminal events are written to the local outbox before asynchronous delivery.
- Production-composition coverage proves manual and scheduled execution, restart, and durable history perform zero external requests when Panel is not configured.
- Panel reporting defaults to operational status only. Instructions, summaries, paths, commands, model names, raw tool names, usage, and credentials stay local.
- Workspace runtime directories are owner-only and SQLite history files, including WAL and SHM sidecars, are owner-readable and writable only.
- Product analytics is off until the user explicitly opts in. Disabling Panel in macOS prevents Panel requests and history enrichment.
- Historical run reviews, Today, Activity, and Assistant home never apply a newly edited output contract to an older run.
- Primary macOS navigation and creation use Assistant and Safe test language. The old technical concepts remain unchanged in APIs and persistence.
- Assistant Advanced details expose the raw schedule, AI engine, configured model, permission mode, exact allow and deny rules, and connection IDs in a collapsed local disclosure. They do not source prompts, credentials, MCP configuration, or the working directory.
- Screen specifications and the visual acceptance matrix are recorded under `docs/v2/`. The previous macOS root was deleted when V2 replaced it, so presentation rollback requires installing the prior signed build rather than maintaining duplicate UI logic behind a flag.
- Final verification passed: 1,546 server tests with 4 expected skips, 535 Swift presentation tests, 12 EventKit tests, strict TypeScript checking, ESLint, server compilation, and an unsigned Debug app build.
- Signed UI automation and final screenshots remain unverified because the overnight display session is locked. Pairing and remote command transport remain blocked on Agent Panel's endpoint, credential, RLS, scope, rotation, revocation, and atomic machine-claim contracts.

Baseline review:

- Runtime discovery now rejects stale Codex wrappers that cannot start and finds valid user-local installs, including NVM and Volta paths.
- Schedule sync begins watching before its initial request, so edits made during startup cannot be missed. Its timing behavior now uses deterministic watcher tests.
- The schedule test passed 25 consecutive runs. The full server suite passed with 1,396 tests and 4 expected skips, followed by TypeScript checking, ESLint, and compilation.
- The unchanged Swift baseline passed earlier in this phase with 478 main-app tests and 12 EventKit tests.

Machine identity review:

- Each Agent Server home now owns one stable UUID in an owner-only `machine-id` file. Custom agent directories do not change identity.
- Initialization and direct server startup both create or validate the identity. Corrupt files and symbolic links fail closed and are never silently replaced.
- Authenticated `GET /machine` returns the stable ID, protocol version, and Server version. Public health does not expose the ID.
- V1 `worker_id` remains the ephemeral hostname and process pair used by current telemetry and cleanup.
- The full server gate passed with 1,405 tests and 4 expected skips, followed by TypeScript checking, ESLint, and compilation.

V2 serialization review:

- Added pure operational status and assistant-sync serializers without connecting them to Panel traffic.
- Status includes stable machine, process, assistant, and run identity. Local skipped runs map to completed with a required stable reason code.
- Assistant sync hashes exact definition content, includes disabled assistants, and omits instructions, paths, descriptions, and capability details by default.
- Frozen JSON fixtures under `docs/v2/fixtures/` give Claude matching payloads for Agent Panel validation.
- Existing V1 reporter and sync behavior remains unchanged. The full server gate passed with 1,417 tests and 4 expected skips, followed by TypeScript checking, ESLint, and compilation.

V2 command and decision boundary review:

- Added strict protocol-versioned command validation for all approved actions, exact machine targeting, expiry, replay protection, support checks, and local policy rejection.
- Added strict approve, pick, answer, and defer normalization. Unknown choices, blank answers, expired deferrals, legacy payloads, and extra fields fail closed.
- Frozen command and decision fixtures under `docs/v2/fixtures/` for Agent Panel.
- Remote claim and acknowledgement transport remains stopped because the current Panel contract does not provide the required atomic machine-scoped claim semantics.

Outcome-first run review review:

- Added the first pure consumer presentation adapter for completed, incomplete, failed, canceled, skipped, and working runs.
- Every generated statement carries an evidence reference. Default output uses file names rather than full paths and replaces raw tool names with a neutral description.
- Intermediate timeline entries omit timestamps when the durable store does not know the exact event time.
- User cancellation now carries the stable `user_canceled` reason through the real abort path. Generic runtime aborts carry `run_canceled`; existing local status remains backward-compatible as failed until presentation normalization.
- Added a frozen completed-run fixture for shared macOS and Agent Panel decoding.
- Added authenticated `GET /runs/:id/review` as a read-only local endpoint. Retained run history remains reviewable after an assistant definition is removed.
- The macOS run detail now opens with the outcome, plain-language summary, outputs, changes, problems, suggestions, and a human timeline. Logs, model details, token counts, and raw activity remain available under Technical details.
- Running work uses the distinct `working` outcome. The UI reserves `waiting` for a state that can explain what response is needed.
- Swift presentation tests cover every outcome label and symbol, ordered section rendering, empty-section omission, evidence retention, and Technical details availability.
- Visual inspection covered the fixed run-review scenario in dark and light themes. The first inspection exposed a white-background theme defect; the summary now owns its themed background and the rebuilt screen is readable in both appearances.
- Verification passed with 1,462 server tests and 4 expected skips, 484 Swift tests, strict TypeScript checking, ESLint, the server build, and the unsigned Debug macOS build. The unsigned UI-test host did not finish launching, so its result is not counted as a passing gate; the deterministic scenario and screenshot assertion remain in the UI test target for a signed run.

## V2 platform audit and planning

- [x] Establish clean evidence maps and baseline results for Agent Server and Agent Panel.
- [x] Document current architecture, user journeys, terminology, features, ownership, UX complexity, and risks.
- [x] Write the six required V2 planning documents in one canonical location with cross-repository links.
- [x] Define non-overlapping workstreams, file ownership, interface contracts, and merge gates for Codex and Claude.
- [x] Verify every material claim against code or tests and stop before feature implementation.

Scope boundary:

- This phase changes documentation only. It must not change product code, schemas, migrations, dependencies, or runtime behavior.
- Completion requires a review section with repositories inspected, files changed, decisions, tests, risks, unresolved questions, and the next phase.

Review:

- Inspected Agent Server at `896a9e9` and Agent Panel at `0a8b224`, including product documents, runtime and API code, persistence, migrations, RLS, shared schemas, web, macOS, iOS, tests, and recent history.
- Added the six canonical documents under `docs/v2/`, plus a parallel work plan, interface contract draft, index, and one Agent Panel cross-link.
- Made consumer UI quality a release gate with approved screen specifications and screenshot review required before broad implementation.
- Assigned Codex to Agent Server and Claude to Agent Panel, with frozen fixtures, repository ownership, deployment order, and contract-change gates.
- Added no production code, schema, migration, dependency, or runtime change.
- Verification found hard stops: no stable machine identity, organization-wide remote commands, decision schema drift, unenforced key scopes, documentation conflicts, a failing Server test baseline, and a failing Panel iOS baseline.
- Next phase requires user approval, separate baseline repair, and an approved V2 interface contract. Feature implementation remains stopped.

## Restore manual runs to Run history

- [x] Reproduce the missing Portuguese and French run across the live API and macOS state.
- [x] Add a failing behavior test at the layer that drops or hides the run.
- [x] Make durable local run history load before optional Agent Panel enrichment.
- [x] Refresh an open history tab when a run appears or changes status.
- [x] Correct structured MCP service errors that omit the protocol error flag.
- [x] Run affected and full tests, rebuild, relaunch locally, and commit without pushing.

Review:

- The manual Portuguese and French run was present in both `~/.agent-server/runs.db` and Agent Panel under the correct stable agent ID. The empty tab came from treating optional panel enrichment as a prerequisite for local history.
- Run history now displays durable local rows first, tolerates panel failures, enriches afterward, and refreshes when a run appears or changes status.
- Personal Notion contains exactly two lesson pages for July 21. Three earlier create attempts returned structured service errors, but Notion MCP omitted `isError`; Agent Server now classifies those attempts as failed instead of counting five successful outputs.
- Verification passed with 1,332 server tests and 4 expected skips, 471 Swift tests, TypeScript checking, ESLint, server compilation, and an unsigned macOS Debug build.

## Match the actual Settings drawer and window footers

- [x] Add behavior contracts for the compact Settings drawer typography and spacing.
- [x] Match the global Settings drawer to Mail Notifier's type scale and card geometry.
- [x] Make the creation wizard footer the same height as the sidebar footer.
- [x] Run focused and full Swift tests, rebuild, relaunch locally, and commit without pushing.

Review:

- The global Settings drawer now matches Mail Notifier's 18 pt title, 10 pt uppercase card headings, 13 pt row labels, 11 pt supporting copy, 14 pt card gaps, and compact header, outer, and card padding.
- The creation wizard and sidebar footers now share one 46 pt height contract and the same top divider treatment.
- The focused presentation tests and all 469 Swift behavior tests passed. The unsigned macOS Debug build passed with only pre-existing notification concurrency warnings.
- The local app and server relaunched from the verified build at `2026-07-21T07:58:50.655Z`.

## Match Edit agent to Mail Notifier settings

- [x] Replace the native Form and Section layout with explicit compact cards modeled on Mail Notifier.
- [x] Use 10 pt card headings, 13 pt field labels, 11 pt supporting text, and 14 pt card spacing.
- [x] Keep the Name field full-width and left aligned while giving Schedule its own stable control row.
- [x] Remove the boxed Delete agent section and use a compact standalone destructive button.
- [x] Run Swift tests, rebuild and relaunch the unsigned local app, and commit without pushing.

## Add Markdown to agent creation

- [x] Replace the creation request TextEditor with the shared MarkdownEditor.
- [x] Let the request editor fill the available creation window above the footer.
- [x] Change the supporting text to explain that agents are Markdown files.
- [x] Cover the presentation contract and include it in the local rebuild.

## Calm the New Agent action

- [x] Remove the selected-state color and background changes from New Agent.
- [x] Keep standard system press feedback and stable foreground styling.
- [x] Cover the stable appearance policy and include it in the local rebuild.

## Show runtime-scoped services during creation

- [x] Ask for file access and the coding agent before asking which service connection to use.
- [x] Refresh services for the selected runtime before building connection choices.
- [x] Show both Personal Notion API and Claude Notion MCP when Claude Code is selected.
- [x] Preserve source pills so the two Notion choices remain distinguishable.
- [x] Reproduce the manuscript-to-Personal-Notion prompt in proposal tests.

Review:

- Matched the Mail Notifier settings card hierarchy and compact typography without reusing SwiftUI Form columns.
- Added the full-size Markdown creation editor and stable New Agent action.
- Live guidance validation now returns Personal Notion as API and Notion from the Claude account as MCP with Needs setup state.
- Server: 1,331 tests passed, 4 skipped. Swift: 468 tests passed. EventKit: 12 tests passed.
- Type-check, lint, server build, and unsigned macOS build passed.
- Local app and server relaunched successfully at `2026-07-21T07:49:07.888Z`.

## Restore Edit agent schedule alignment

- [x] Restore the native Name row structure so the Form keeps its established label column.
- [x] Left-align only the Name editor and retain matching Name and Description label typography.
- [x] Keep the redundant schedule summary removed without moving the schedule controls.
- [x] Run Swift tests, rebuild and relaunch the unsigned local app, and commit without pushing.

Review:

- Added a regression contract that keeps the Schedule controls on the native Form label column.
- Swift package: 467 tests passed.
- Unsigned Debug app build passed and relaunched from `/tmp/agent-server-local-20260721-stabilized/Build/Products/Debug/Agent Server.app`.
- Local server restarted successfully at `2026-07-21T07:31:58.041Z`.

## Edit agent form consistency

- [x] Keep Name editing left aligned and use the same label typography for Name and Description.
- [x] Remove the repeated natural-language schedule summary below the schedule controls.
- [x] Remove runtime helper text that only restates the selected coding agent.
- [x] Remove the repeated agent name, status badge, and Copy all action from run-history detail.
- [x] Run Swift tests, rebuild the unsigned app, relaunch it locally, and commit the fix without pushing.

Review:

- Added behavior coverage for the Edit agent presentation and the stripped-down run-history detail header.
- Swift package: 467 tests passed.
- Unsigned Debug app build passed and relaunched from `/tmp/agent-server-local-20260721-stabilized/Build/Products/Debug/Agent Server.app`.
- Local server restarted successfully at `2026-07-21T07:09:07.235Z`.

## Durable agent edits and LLM-scoped connections

- [x] Add failing tests for stale polls after Save, stale live state, and overlapping Markdown writes.
- [x] Make every agent read and save reconcile against the current Markdown file in `~/.agent-server/agents`.
- [x] Derive environment-backed connections from the current `~/.agent-server/.env` on every request.
- [x] Scope account MCP connections to the LLM or runtime selected in the agent Markdown.
- [x] Keep runtime MCP discovery limited to readiness status so it cannot add, remove, or overwrite configured rows.
- [x] Remove the generic external-service security warning and retain findings for unsafe settings or combinations.
- [x] Run server tests, Swift tests, type-check, lint, build, and relaunch the unsigned local app.

Assumptions and risks:

- The agent Markdown and adjacent `.env` are the only configuration sources of truth.
- The selected executor, provider, and model determine which runtime-owned MCP connections are eligible.
- Runtime status may be temporarily missing without changing the saved connection inventory.

Review:

- Edit agent now applies the exact PUT response, updates both live agent mirrors, and rejects poll responses that began before a completed write. Save and Cancel only appear for a dirty draft; Cancel restores the saved agent without leaving the tab.
- Writes to one agent Markdown file are serialized, preventing concurrent settings actions from overwriting each other. Every request rereads the agent files and adjacent `.env`.
- Personal Notion remains a reusable API connection derived from Markdown and `.env`. Claude account MCP rows appear only for Claude Code agents; Codex and Kimi agents do not inherit them. Runtime probes update status without changing row membership.
- Scoped external service use no longer creates a warning by itself. The live CMO Coaching Report security result is low with no findings, while specific unsafe permission and transport rules remain active.
- The agent header has more vertical space between its name, description, and schedule.
- Verification passed with 1,331 server tests and 4 expected skips, 467 Swift behavior tests, 12 EventKit tests, TypeScript checking, ESLint, server compilation, and an unsigned macOS build. The live API returned the same CMO connection IDs across three reads, zero account MCP rows for Codex, seven for Claude Code, and a low CMO security result.

## Security approval feedback

- [x] Add failing behavior tests for when automatic-run approval is required, available, complete, or irrelevant.
- [x] Replace the ambiguous Mark reviewed control with an explicit automatic-run approval action.
- [x] Allow approval of a current scan when the prior review is stale and show in-progress feedback.
- [x] Replace a successful action with a dated, persistent approval status.
- [x] Remove the repeated single-group risk heading and expand finding details inline instead of opening another panel.
- [x] Keep the same disclosure treatment for every agent and preserve Back and Escape collapse behavior.
- [x] Keep Edit agent selected after Save and show saved or no-change feedback in its footer.
- [x] Run Swift tests and rebuild and relaunch the unsigned local app.

Assumptions and risks:

- High-risk agents need explicit approval before scheduled or other automatic runs.
- Critical findings remain blocked and cannot be approved away.
- Low and needs-review results do not need this control because server preflight already allows them.

Review:

- The old Mark reviewed control is gone. High-risk agents now offer Approve automatic runs, critical agents remain blocked, and lower-risk agents show no unnecessary approval action.
- Approval works when the previous review is stale, shows progress, and becomes a dated Approved for automatic runs status after the server persists it.
- A single finding severity is named only in Summary. Finding rows expand and collapse in place, with the same treatment for every agent and no third panel.
- Saving from Edit agent keeps that tab selected. The footer confirms Saved or No changes to save and clears the confirmation when another edit is made.
- Verification passed with 463 Swift behavior tests, 12 EventKit core tests, and an unsigned macOS Debug build. No release, merge, push, or new commit was performed.

## Agent detail tab bar

- [x] Add failing presentation tests for the three detail tabs and header action states.
- [x] Replace the duplicate-agent action with a compact Run action in the header.
- [x] Move schedule into the stacked header and color the security action by current risk.
- [x] Add Recent runs, Edit agent, and Run history tabs below the header.
- [x] Keep Last run and This agent can in Recent runs while removing duplicate run and security controls.
- [x] Embed editing and run history directly in their tabs without nested side drawers.
- [x] Run Swift tests and rebuild and relaunch the unsigned local app.

Assumptions and risks:

- The security action continues to open the existing top security drawer and returns to the selected agent when dismissed.
- A running agent disables the run action and uses the theme highlight color with a visible activity symbol.
- Run failures remain visible inside Recent runs so moving the button does not remove recovery feedback.

Review:

- The agent drawer now has one stable 780-point surface. Its header stacks name, description, and schedule, with Run and risk-colored Security actions on the right.
- Recent runs, Edit agent, and Run history use one capsule tab bar. Editing and history replace the drawer content instead of opening more drawers.
- Recent runs contains only run feedback, Last run, and This agent can. The old Run now, Security status, duplicate-agent, gear, and View history controls are gone.
- Run starts from the header, stays disabled with a highlighted running symbol while active, and keeps recovery feedback in Recent runs. Security is green only for a current clean check, orange when setup or review needs attention, and red for critical findings.
- Verification passed with 457 Swift behavior tests, 12 EventKit core tests, and an unsigned macOS Debug build. The local build runs from `/tmp/agent-server-local-20260721-detail-tabs`. No release, merge, or push was performed.

## Connection category labels

- [x] Add failing behavior tests for connection category derivation across API, MCP, File, Web, Command, and messaging connections.
- [x] Add one shared compact category presentation and render it in Edit agent capability rows.
- [x] Render the same category presentation beside connections shown from the Create workflow's Add connections panel.
- [x] Verify the live Personal Notion agent binding is presented as API while Claude-account Notion is presented as MCP.
- [x] Run focused tests, the full Swift suite, and an unsigned local macOS build.
- [x] Relaunch the local app for manual testing without publishing, merging, or pushing.

Assumptions and risks:

- Category labels describe how the person connected the capability, not the lower-level protocol used behind an API-backed integration.
- Existing agent configuration and connection identities must remain unchanged. This is a presentation fix, not a migration.
- The local build must not enter the release or Sparkle publication flow.

Review:

- Category pills now label each connection or capability as API, MCP, File, Web, Command, Mac, Messaging, or Tool in Edit agent and the Create workflow connection surfaces.
- Edit agent uses the app-wide connection registry. A saved Personal Notion API connection can be added to another agent, while a Claude account Notion connector keeps a separate identity and MCP category when available.
- The live API exposes Personal Notion to agents that do not yet use it with `enabled: false`, so the toggle can attach the reviewed configuration without copying credentials into the agent file.
- Verification: 1,320 server tests with 4 skips, 451 Swift behavior tests, 12 EventKit tests, ESLint, strict TypeScript checking, server compilation, and the unsigned macOS Debug build passed.
- Local API version 12 is running from `/tmp/agent-server-local-20260721-connection-labels`. No release, publish, commit, merge, or push was performed.

## Technical debt remediation loop

- [x] Commit the audit report and this remediation baseline.
- [x] Batch 1: Fix trigger direction and cycles, timeout ownership, telemetry deadlines and durability, conversation duplication, skipped terminals, interaction delivery, and shutdown handling. Cover TD-01 through TD-05 and TD-23 through TD-26.
- [x] Batch 1 cleanup: Run `clean-and-refactor`, perform a separate simplification pass, rerun all server gates, and commit refinements.
- [x] Batch 2: Fix evidence redaction, body limits, bounded security maps, cleanup errors, dynamic watches, glob parsing, discovery diagnostics, configuration documentation generation, duplicate normalization, and the unused Telegram decision path. Cover TD-06, TD-27 through TD-32, TD-40, TD-44, and TD-45.
- [x] Batch 2 cleanup: Run `clean-and-refactor`, perform a separate simplification pass, rerun all server gates, and commit refinements.
- [x] Batch 3: Upgrade vulnerable dependencies, add dependency auditing and native CI, make macOS build inputs reproducible, test the CLI, and ratchet coverage. Cover TD-07 through TD-11, TD-38, and TD-39.
- [x] Batch 3 cleanup: Run `clean-and-refactor`, perform a separate simplification pass, rerun server, Swift, and build gates, and commit refinements.
- [x] Batch 4: Fix owned-process shutdown, decision polling and resolution, and stable run identity. Cover TD-13 through TD-17.
- [x] Batch 4 cleanup: Run `clean-and-refactor`, perform a separate simplification pass, rerun Swift and integration gates, and commit refinements.
- [x] Batch 5: Fix environment-file safety, Markdown Unicode ranges, EventKit timeouts and pagination, helper decomposition, and native integration coverage. Cover TD-18 through TD-22, TD-41, and TD-42.
- [x] Batch 5 cleanup: Run `clean-and-refactor`, perform a separate simplification pass, rerun Swift and app-build gates, and commit refinements.
- [x] Batch 6: Make release publication verifiable and ordered, prevent stale feeds and unsafe interpolation, and replace obsolete build and release documentation. Cover TD-12, TD-33 through TD-37, and TD-46.
- [x] Batch 6 cleanup: Run `clean-and-refactor`, perform a separate simplification pass, rerun script, documentation, server, Swift, and build gates, and commit refinements.
- [x] Batch 7: Split the three large SwiftUI surfaces along tested state and action boundaries. Cover TD-43.
- [x] Batch 7 cleanup: Run `clean-and-refactor`, perform a separate simplification pass, rerun all repository gates, and commit refinements.
- [x] Batch 8: Close repeat-audit findings in server coverage and dependencies, release recovery and credential handling, native build reproducibility, EventKit production coverage and pagination, and macOS polling and status architecture.
- [x] Batch 8 cleanup: Run `clean-and-refactor`, perform a separate simplification pass, rerun every repository gate, and commit refinements.
- [x] Re-run the technical debt audit, prove every finding closed or explicitly retired, and record the final review.

### Remediation constraints

- Add a failing behavior test before each production change.
- Run focused tests while implementing and the full relevant test, lint, type-check, and build gates before each commit.
- Keep fix commits separate from cleanup and simplification commits.
- Preserve compatibility unless repository evidence establishes a documented migration.
- Do not run focus-stealing macOS UI automation without a separate agreed window.

### Review

Batch 1 fixes trigger direction and bounded chains, preserves locks for timed-out work, makes terminal telemetry durable and request-bounded, removes duplicated conversation input, distinguishes skipped runs, fails undeliverable interactions, and stages startup with bounded rollback and teardown. Its cleanup pass consolidated timeout handling, channel completion handling, and internal-only exports.

Batch 2 redacts run evidence before memory or SQLite persistence and on legacy-row reads, authenticates before bounded body streaming, bounds security maps without evicting active bans, reports panel cleanup failures honestly, reconciles file watches after definition edits, escapes glob patterns safely, and emits source-free discovery diagnostics. It also generates the environment reference from one contract, centralizes stable value normalization, and removes the unwired Telegram decision implementation in favor of the production panel-backed path.

Batch 3 removes the unused direct WebSocket dependencies, pins patched Hono and WebSocket releases, enforces a strict seven-day package age policy, adds a high-severity production audit gate, and expands CI to the native app and all shipped inputs. A clean public clone now builds from a tracked plist and a small Agent Server-owned design-system package without disclosing private source. The CLI is tested through an injected command factory, coverage thresholds are ratcheted, and production server startup now proves listener readiness, API and WebSocket authentication, bind-failure cleanup, and idempotent shutdown.

The Batch 3 cleanup renames the compatibility module to the Agent Server-owned design system, removes unused public theme fields, tests that package in CI, and colocates trigger tests. It also preserves startup failures when cleanup fails, returns a nonzero exit for failed shutdown, logs listener success only after binding, and lets independent downstream triggers continue after one target fails.

Verification through the Batch 3 cleanup passed with 1,290 server tests, 84.92% line coverage, strict type checking, ESLint, the server build, a frozen install, the production dependency audit, three design-system tests, 378 Swift tests, and an unsigned macOS app build. The dependency audit has no high or critical advisories; one low and two moderate transitive advisories remain. Remaining batches are pending.

Batch 4 limits external process discovery to listeners, persists an owned PID/executable/launch-token identity, verifies that identity before both graceful termination and forced escalation, and bounds shutdown waits. Application termination now awaits that path and exposes failures. Decision refreshes coalesce behind a tracked generation, stop cancels stale work, and resolution mutates local state only after panel success. Run reconciliation uses exact run IDs end to end and no longer guesses by timestamp.

Batch 4 verification passed with 1,291 server tests, strict type checking, ESLint, the server build, 392 Swift tests, and a fresh unsigned macOS app build.

The Batch 4 cleanup closes a quit-versus-restart relaunch race, parses only environment entries when verifying ownership tokens, bounds the listener lookup process, and prevents stale startup errors from appearing as shutdown failures. Decision writes are now tracked and generation-bound, monitoring start is idempotent, and duplicate run IDs follow a deterministic first-wins policy. Verification passed with 1,291 server tests, 396 Swift tests, and an unsigned macOS app build.

Batch 5 rejects duplicate environment keys before rendering or saving, creates and verifies owner-only temporary secret files before atomic replacement, expands credential-name masking, and fully masks short secrets. Markdown highlighting now derives every AppKit range from UTF-16 offsets and covers composed Unicode, emoji, YAML, CRLF, and mixed Markdown. The EventKit helper now delegates through focused Calendar, Reminder, and Contacts services, bounds every callback wait, and caps sensitive list results with continuation metadata. Verification passed with 1,291 server tests, 405 Swift tests, 9 EventKit core tests, strict TypeScript checking, ESLint, the server build, direct EventKit helper type checking, and an unsigned macOS app build.

The Batch 5 cleanup stops false-positive masking for trailing-underscore environment names, centralizes duplicate detection, and simplifies atomic-write cleanup. Markdown highlighting caches fixed regular expressions, shares one UTF-16 marker-range path, and validates overflow-safe ranges before AppKit applies attributes. EventKit removes an unused service abstraction, consolidates bounded reminder callbacks, reuses date formatters, narrows public APIs, and rejects invalid pagination types and nonpositive limits. Verification passed with 1,291 server tests, 407 Swift tests, 11 EventKit core tests, strict TypeScript checking, ESLint, the server build, direct helper type checking, and an unsigned macOS app build.

Batch 6 validates release versions and metadata through tested Python value objects, treats the live appcast as authoritative, rejects duplicate or stale releases, and builds XML without source interpolation. Publication now rechecks the live-feed digest before mutation, requires the immutable DMG key to be absent, verifies exact artifact length and all Sparkle fields, and updates the latest alias only after direct and short-link feeds pass. The R2 and DMG guide is canonical, README build steps match the root pnpm lock and deploy phase, and CI enforces release tooling and documentation contracts. Verification passed with 26 release-tool tests, 1,294 server tests, the coverage gate, strict TypeScript checking, ESLint, the server build, shell syntax checks, and real parsing of the 25-entry production appcast.

The Batch 6 cleanup makes namespace matching exact, blocks real XML document types without rejecting harmless CDATA text, requires the actual English channel anchor, and narrows metadata APIs to parsed versions. Publication uses typed release plans, revalidates signed artifacts before network activity, confirms the enclosure and immutable URLs match, shares one atomic writer, and reports command failures with useful context. Documentation removes repeated version-specific instructions and tests stable manifest-derived facts. Verification passed with 37 release-tool tests, 1,294 server tests, the coverage gate, strict TypeScript checking, ESLint, the server build, Bash and ShellCheck validation, and real production appcast and metadata parsing.

Batch 7 replaces the 774-line guided creation view, 700-line agent settings view, and 671-line settings drawer with 222-line, 158-line, and 145-line composition shells. Pure Core models now own creation generations and cancellation, resource selection, typed agent-settings drafts and patches, schedule state, environment validation, restart dirtiness, telemetry bounds, panel gating, and stale workspace reload rejection. AppKit panels and native side effects remain in focused app adapters. Verification passed with 437 Swift tests, 1,294 server tests, 37 release-tool tests, 3 design-system tests, 11 EventKit core tests, strict TypeScript checking, ESLint, the server build, and an unsigned macOS app build.

The Batch 7 cleanup retains and cancels guided prepare, save, permission, safe-test, and workspace reload tasks, and invalidates their generations when views disappear. Settings persistence now rolls back toggles and restart state on failed writes while keeping environment-table errors editable. Agent settings trims multiline whitespace correctly, preserves explicit provider-key removal, avoids duplicate-key traps, and narrows patch construction. Redundant state wrappers and public APIs were removed. Verification passed with 443 Swift tests, 1,294 server tests, 37 release-tool tests, 3 design-system tests, 11 EventKit core tests, strict TypeScript checking, ESLint, the server build, and an unsigned macOS app build using the verified package cache.

Batch 8 closes every issue found by the first repeat audit. Real listening-server tests now cover 73.01% of `server.ts` lines and 60.84% of its branches, with per-file regression floors. Production dependencies have zero advisories. Release preparation is rollback-safe, publication resumes after partial success, existing immutable artifacts require a matching SHA-256, signatures require 64 decoded Ed25519 bytes, notarization uses Keychain indirection, and Node release tools are workspace-pinned. Native run refreshes reject stale work, decision failures are visible, `StatusMonitor` is split below 500 lines, EventKit production services have direct behavior tests, sensitive lists are bounded as early as each framework permits, and clean Xcode builds use tracked package resolution and build server inputs from source. Verification passed with 1,306 server tests, 445 Swift tests, 45 release-tool tests, 12 EventKit core tests, 5 EventKit production tests, 3 design-system tests, strict TypeScript checking, ESLint, the server build, the production dependency audit, and an unsigned macOS app build.

The Batch 8 cleanup fixes metadata temp-file leaks during failed staging and rollback, shares streaming SHA-256 logic, tightens the notarization contract test, and removes repeated server fixtures. Native cleanup centralizes pagination errors, groups injectable authorization operations, removes redundant refresh and WebSocket state, reduces native test work, and preserves one decision failure while another decision succeeds. A combined-load run exposed a shutdown admission race, so the server now closes run admission immediately, tracks and bounds background callback draining, drains admitted terminals before closing stores, and prevents scheduled, watched, channel, or downstream work from starting after shutdown. Verification passed with 1,312 server tests, 446 Swift tests, 47 release-tool tests, 12 EventKit core tests, 6 EventKit production tests, 3 design-system tests, coverage, strict TypeScript checking, ESLint, the server build, the production dependency audit, and an unsigned macOS app build.

The final repeat pass closes three last failure-path findings. Shutdown drains reuse the shared cancellable timeout primitive and leave no referenced timer handles. Notarization setup guidance relies on the secure Keychain prompt, and the temporary app archive is removed after success, failure, or interruption. The native build now fails if its required EventKit helper is missing. Verification passed with 1,314 server tests, 48 release-tool tests, the focused macOS build contract, shell syntax checks, strict TypeScript checking, ESLint, the server build, zero production dependency advisories, and an unsigned macOS app build.

## Tech debt audit

- [x] Read the requested audit skill and orient to the repository architecture, history, size, and churn.
- [x] Run server, macOS, dependency, configuration, security, and documentation checks.
- [x] Rank and deduplicate concrete findings with exact file and line citations.
- [x] Write and validate `TECH_DEBT_AUDIT.md`.

### Review

The audit covers all nine requested dimensions across the TypeScript server, native app, EventKit helper, dependencies, CI, release pipeline, and documentation. It records 46 ranked findings, five concrete refactor outlines, quick wins, rejected false positives, and open compatibility questions. Validation passed: strict TypeScript checking, ESLint, 1,267 active server tests, citation range checks for all 92 full file references, and Markdown whitespace checks. Production dependency auditing reports 2 high and 11 moderate advisories.

## Version 3.2.0 release

- [x] Run the release pipeline for version 3.2.0 with release text “Now you can choose which LLM your agents use”.
- [x] Verify tests, type checking, linting, signing, notarization, and Sparkle metadata.
- [x] Verify the versioned DMG, latest alias, and live update feed.
- [x] Review the release diff, commit the release, and push `main`.

### Review

Agent Server 3.2.0 build 32 passed 1,267 server tests and 378 Swift behavior tests, strict TypeScript checking, ESLint, server compilation, and the signed Release archive build. Apple accepted both the app bundle and DMG, and both notarization tickets were stapled and validated. The versioned DMG, latest alias, and appcast were uploaded successfully. The live update feed reports Version 3.2.0 with the release text “Now you can choose which LLM your agents use”.

## Guided creation LLM picker

- [x] Validate the handoff's runtime restriction claims against the installed Codex CLI, SDK surface, official documentation, and a local sandbox probe.
- [x] Decide whether to add Codex permission-profile execution now or keep Codex disabled for file-scoped agents until that prerequisite lands.
- [x] Add failing server tests for question order, skip behavior, runtime persistence, precedence, and incompatible file-access choices.
- [x] Add failing Swift decoding and flow tests for the runtime picker, back navigation, reissued questions, and explicit skip.
- [x] Implement the deterministic runtime question and apply the selected executor to both model and fallback proposals.
- [x] Implement the three-card macOS picker with brand marks, disabled-reason copy, selection state, and accessibility identifiers.
- [x] Add UI automation coverage without running the focus-stealing UI test suite in this session.
- [x] Run focused tests, full server tests, Swift behavior tests, type-check, lint, server build, and macOS build.
- [x] Perform a simplification pass and document the verified result here.

### Review

Codex file-scoped agents now run through the Codex CLI permission-profile path because the TypeScript SDK cannot serialize the required inline filesystem table. The profile defaults to minimal read access, grants only the reviewed paths as read or write, disables user configuration that could install a conflicting legacy sandbox mode, and retains reviewed agent MCP configuration. Unscoped Codex agents continue to use the SDK path.

Guided creation asks which coding agent to use after file access, preserves skip and back-navigation behavior, and writes the confirmed executor into both model-generated and local fallback proposals. The macOS picker presents Codex, Claude Code, and Kimi Code as equal cards with selection, unavailable-reason, and accessibility states.

Verification passed: 1,267 server tests with 4 skipped, TypeScript strict check, ESLint, server build, 378 Swift tests, an unsigned native macOS build, and a real bundled Codex macOS sandbox probe covering selected reads, denied outside reads, denied writes to read-only paths, and allowed writes to read-write paths. UI automation coverage was added but not launched because it takes over the active desktop.

## Version 3.1.3 release

- [x] Run the release pipeline for version 3.1.3 with release text “Bug fixes”.
- [x] Verify tests, type checking, linting, signing, notarization, and Sparkle metadata.
- [x] Verify the versioned DMG and live update feed.
- [x] Commit the release metadata, simplify, and push `main`.

### Review

Agent Server 3.1.3 build 31 passed 1,257 server tests and 375 Swift behavior tests, strict TypeScript checking, ESLint, server compilation, and the signed Release archive build. Apple accepted the app bundle and DMG, and both notarization tickets were stapled and validated. The versioned DMG, latest alias, and appcast were uploaded successfully. The live update feed reports Version 3.1.3 with the release text “Bug fixes”.

## Settings Updates placement regression

- [x] Identify why the Updates card could return to the left column.
- [x] Add a failing behavior test for stable primary Settings columns.
- [x] Make the two-column primary card arrangement independent of transient drawer geometry.
- [x] Run Swift behavior tests and build the macOS app without UI automation.
- [x] Commit, simplify, and verify the repair.

### Review

Primary Settings cards now use an explicit two-column assignment at every supported main-window size. General, Coding agents, and Notifications stay in the left column. Agent Server folder and Updates stay in the right column. Advanced content keeps its responsive layout. Verification: the regression test failed before the fix, all 375 Swift behavior tests pass, and a disposable unsigned Debug build succeeded. The disposable build and all prior Debug app bundles were removed and deregistered so Spotlight cannot surface them.

## Demo Mode context menu and Settings columns

- [x] Reproduce the selectable-text menu intercepting the General heading's Demo Mode action.
- [x] Add failing behavior tests for contextual heading selection and primary card columns.
- [x] Make contextual headings direct context-menu targets without disabling ordinary text selection.
- [x] Restore Updates to the right settings column at wide window sizes.
- [x] Run Swift tests and a macOS build without UI automation.
- [ ] Commit, simplify, install, verify, and push the repair.

Review:

- The General heading disables inherited text selection only when it owns the hidden Demo Mode action, allowing its native context menu to receive right-clicks.
- Wide Settings restores the approved explicit columns: General, Coding agents, and Notifications on the left; Agent Server folder and Updates on the right. Narrow windows retain one readable column.
- Verification: 373 Swift behavior tests and the unsigned macOS Debug build passed. UI automation was not run.

## Version 3.1 update regressions

- [x] Reproduce the installed 3.1 crash during Sparkle relaunch and the empty agent list from local evidence.
- [x] Add failing behavior tests for the update/runtime failure and the bouncy theme picker regression.
- [x] Restore the existing bouncy theme picker without changing the user's saved theme.
- [x] Fix agent discovery and server startup after an in-place app update.
- [x] Verify an installed upgrade, agent loading, server health, theme behavior, and all non-interactive test gates.
- [x] Commit each verified repair, run a simplification pass, release the corrected build, merge, and push.

Review:

- Restored the direct colored-dot theme picker with hover expansion, spring motion, keyboard access, and Reduced Motion support. The replacement palette menu was removed.
- GUI-launched apps now find Homebrew or `/usr/local` Node even when Sparkle relaunches with the system-only path. Child processes also receive a usable command path.
- A replacement server is fully prepared before an older healthy server is stopped, so a failed preflight cannot empty the app.
- The signed and notarized 3.1.1 app launched through Launch Services without the temporary Node override, started API version 11, and loaded all seven existing agents.
- Verification: 1,256 server tests, 370 Swift tests, TypeScript type-check, lint, server build, signed app validation, notarization validation, and live download checks passed. UI automation was not run.

## Version 3.1 release

- [x] Confirm the existing release workflow, signing prerequisites, current published feed, branch state, and version availability.
- [x] Run the final non-interactive behavior, lint, type-check, production build, and macOS build gates without UI automation.
- [x] Release version 3.1 with the text “Try the new Agent Creator. More to come.” through the existing signed, notarized Sparkle workflow.
- [x] Verify the versioned download, latest download, appcast, signature metadata, notarization, and published release text.
- [x] Commit the version and appcast, run the simplification check, merge `creation-experience` into `main`, and push `main`.

Release constraints:

- Preserve the exact requested customer-facing text.
- Keep the monotonic build number and existing Sparkle signing identity.
- Do not run UI automation.
- Do not push until the uploaded release has passed the existing verification checks.

### Release review

- Released Agent Server 3.1, build 28, with the exact requested release note.
- Apple accepted the app submission `309f73e2-2f9c-4c9b-a48f-18a559a97158` and DMG submission `bf921b24-e37b-4d52-946c-60ff1b4b7015` for notarization.
- Verified the signed and stapled app and DMG with `codesign`, `spctl`, and `stapler`.
- Verified the versioned and latest downloads return HTTP 200 with the signed 191,638,219-byte artifact.
- Verified the local and public Sparkle feeds publish version 3.1, build 28, and the exact release note.
- Removed duplicated release versions from the CLI and Kimi ACP client. Both now read the bundled package version, and the release script updates and builds that package before archiving.
- Final gates passed: 1,255 server tests with 4 skipped, 363 Swift tests, TypeScript type-check, lint, server production build, and macOS release build.

## Kimi Code runtime

- [x] Confirm the installed Kimi Code non-interactive protocol, cancellation behavior, permissions, authentication, and structured event format.
- [x] Add failing server behavior tests for Kimi discovery, configuration, execution, cancellation, and safe environment handling.
- [x] Implement `kimi-code` as a registered executor without changing existing Kimi K3 API-backed agents.
- [x] Add failing macOS behavior tests for installed Kimi status and distinct Kimi Code versus Kimi K3 choices.
- [x] Add Kimi Code to the Coding agents Settings card and agent editor using the existing card and picker patterns.
- [x] Document the two Kimi paths, update the API compatibility boundary, and preserve existing agent files.
- [x] Run full server and Swift verification, build, simplify, commit each consequential batch, and relaunch without UI automation.

Assumptions and risks:

- `kimi-code` will be a new executor value. `kimi-k3` remains a model/provider preset and will not be silently migrated.
- The executor must use Kimi's supported structured output or ACP interface. Parsing decorative terminal text is not acceptable.
- Kimi has no bundled fallback in this app. Missing or unauthenticated installations must remain visible and actionable instead of falling through to another runtime.
- Exact permission enforcement must be proven before Kimi Code can run an agent with reviewed narrow file grants or a safe-test promise.

Review:

- Installed Kimi Code is a third executor backed by its supported ACP server. It uses the installed login, structured tool events, explicit permission decisions, reviewed filesystem callbacks, MCP forwarding, and cancellation.
- Kimi Code and Kimi K3 remain separate choices. Kimi Code stores `executor: kimi-code` and rejects provider settings. Kimi K3 stores a Codex executor, `kimi-k3` model, Moonshot endpoint, and environment-key reference. Existing K2 and other agent files are unchanged.
- Settings controls discovery for all three installed coding agents. The agent editor clears stale provider fields when switching to installed Kimi.
- Local API version 11 replaces older running daemons that cannot execute `kimi-code`.
- Verification: 1,255 server tests across 93 files, 363 Swift tests, 81.02% statement coverage, TypeScript type-check, lint, production build, and unsigned macOS build passed. Nine tests passed against installed Kimi Code 0.28.0. UI automation was not run.

## Recent Activity conversation grouping

- [x] Add failing server coverage for retaining a conversation's Slack or Telegram source.
- [x] Add failing macOS coverage for grouping many conversation turns into one activity item.
- [x] Show one dated Slack, Telegram, or neutral conversation row while preserving ordinary run rows.
- [x] Keep individual conversation runs available in full agent history.
- [x] Run full server and Swift verification, build, simplify, commit, and relaunch without UI automation.

Review:

- Recent Activity now groups every run with the same conversation ID into one Slack, Telegram, or neutral conversation row.
- The row uses the conversation's first timestamp, names the agent, and reports its turn count. Ordinary agent runs remain separate.
- The server persists the source channel with each conversation run. Older stored conversations remain readable and use a neutral label because their channel was not recorded.
- Full run history remains unchanged, so individual turns are still available outside the concise home feed.
- Verification: 1,238 server tests, 359 Swift tests, TypeScript type-check, lint, server build, and the unsigned macOS build passed. UI automation was not run.

## Settings card layout restoration

- [x] Add failing coverage for responsive arranged Settings cards.
- [x] Restore the two-column card grid while preserving current settings behavior and section order.
- [x] Keep sentence-case typography, Advanced grouping, keyboard access, and narrow-window fallback.
- [x] Run Swift verification and the unsigned app build, simplify, commit, and relaunch without UI automation.

Review:

- Settings again uses the arranged card composition the user preferred. Wide drawers show two columns; narrow drawers show one.
- Current section order, persistence, restart notices, Agent Panel placement, environment editing, demo-mode context action, and Advanced disclosure remain unchanged.
- The restored cards keep the newer sentence-case headings and semantic type roles instead of restoring the older uppercase treatment.
- Verification: 359 Swift behavior tests and the unsigned macOS build passed. UI automation was not run.

## Kimi K3 preset

- [x] Verify Moonshot's current K3 model ID and endpoint from official sources.
- [x] Add failing behavior coverage for K3 configuration and version-aware run labels.
- [x] Point the visible Kimi preset and sample agent at `kimi-k3` without embedding credentials.
- [x] Keep existing K2 agents unchanged and label historical K2 and K3 runs accurately.
- [x] Run full server and Swift verification, build the macOS app, simplify, commit, and relaunch.

Review:

- The Kimi preset now creates Codex-backed agents with model `kimi-k3`, Moonshot's existing API endpoint, and a `${MOONSHOT_API_KEY}` reference.
- Existing K2 definitions are not rewritten. They remain editable as custom models, and run history distinguishes Kimi K2 from Kimi K3.
- The server provider path already accepts arbitrary model IDs, so no new execution branch or credential path was added.
- Verification: 1,237 server tests, 358 Swift behavior tests, TypeScript type-check, ESLint, server build, and the unsigned macOS build passed. One file-watch timing assertion failed once under the parallel run and passed with the full suite on immediate rerun.

## Interface copy restraint

- [x] Add failing presentation coverage that forbids redundant instructional copy in agent settings.
- [x] Remove copy that only narrates visible controls from agent settings and nearby primary surfaces.
- [x] Replace the Advanced raw-file disclosure with an Open raw file action in the Instructions header.
- [x] Give the agent description a full-width multi-line editor in Basics.
- [x] Preserve explanations that communicate consequences, safety, privacy, unfamiliar concepts, or recovery.
- [x] Run the Swift behavior suite and unsigned build, simplify, commit, and relaunch without UI automation.

Review:

- Agent settings no longer tells people to review controls and press Save. The Advanced disclosure and its explanatory paragraph are gone.
- Open raw file is a trailing Instructions action. Description is a full-width, three-to-six-line native text field.
- Repetitive progress, creation review, debugger success, runtime, Agent Panel, home, and agent-detail narration was removed or reduced to the state itself.
- Copy that explains file consent, secret handling, destructive-action recovery, retry risk, and safety consequences remains.
- Verification: 358 Swift behavior tests and the unsigned macOS build passed. UI automation was not run.

## Application-wide native macOS visual audit

- [x] Re-audit every primary screen, drawer, sheet, sidebar, toolbar, error, loading, and empty state as one product.
- [x] Inventory every typography role, nested background, border, capsule, custom control, and spacing rule now visible in the app.
- [x] Define and document one native hierarchy for window chrome, drawers, sections, rows, details, actions, and technical disclosures.
- [x] Add failing behavior coverage for reusable presentation policies before changing production views.
- [x] Correct Security Check first, then apply the same hierarchy to creation, details, activity, connections, settings, and errors.
- [x] Verify keyboard navigation, VoiceOver labels, Reduce Motion, and theme-aware presentation without focus-stealing UI automation.
- [x] Commit each consequential screen family, run a simplification pass after every commit, and keep the app buildable throughout.

This re-audit supersedes the earlier audit sign-off. Passing behavior tests did not prove visual coherence, and the live product still has too many competing fonts, nested surfaces, borders, and badges.

Review:

- The app now follows one documented visual hierarchy for window chrome, drawers, sections, rows, details, actions, status, and technical disclosures. See `specs/macos-visual-system.md`.
- Security Check, creation, home, agent details, run details, debugger, Connections, Settings, agent settings, the menu bar, and shared drawer chrome now use restrained native surfaces and semantic text roles.
- Progressive detail panels, keyboard dismissal, VoiceOver labels, selectable technical text, non-color status descriptions, and Reduce Motion behavior remain available.
- Verification: 1,237 server tests across 91 files, 355 Swift behavior tests, TypeScript type-check, ESLint, server build, and the unsigned macOS build passed. UI automation was not run.

## Security Check visual hierarchy

- [x] Audit every font, background, nested card, badge, divider, and action in the Security Check drawer.
- [x] Add failing presentation tests for one restrained summary, list, and detail hierarchy.
- [x] Replace stacked card backgrounds with native rows, sections, spacing, and selection states.
- [x] Standardize typography roles and keep severity understandable without color.
- [x] Preserve progressive panels, keyboard navigation, VoiceOver, and reduced motion.
- [x] Run full Swift verification and unsigned build, commit, simplify, and relaunch without UI automation.

## Saved-agent response reconciliation

- [x] Capture the save-success/error mismatch without retaining agent content or secrets.
- [x] Add a failing behavior test at the server or macOS boundary that reports failure after a successful write.
- [x] Reconcile authoritative agent state before presenting a save failure and avoid duplicate files on retry.
- [x] Preserve the created agent and route the user to it when the write succeeded.
- [x] Run full server and Swift verification, commit, simplify, rebuild, and relaunch.

Review:

- The macOS app stopped waiting after five seconds while model-backed security checks could consume nearly that entire budget. The server then completed the write after the client had shown an error.
- Guided saves now allow 30 seconds. One ambiguous timeout or lost connection retries with the same review identity.
- The server coalesces concurrent saves and replays a minimal completed receipt for 30 minutes. It stores only agent ID, name, and safe-test metadata, caps receipts at 100, and never caches prompts, configuration, or credentials.
- Two lost transport responses produce a truthful “Your agent may already be saved” state. Validated server errors are still shown as their real cause.
- The recovery UI is one centered, borderless group. Retry and Details stay together; technical text expands beneath them. VoiceOver focus moves to the error title.
- Local API version 10 replaces older daemons that lack the idempotent save contract.
- Verification: 1,237 server tests, 333 Swift behavior tests, TypeScript type-check, ESLint, server build, and the unsigned macOS build passed. UI automation was not run.

## Answered-question regression hardening

- [x] Capture the latest creation failure without retaining prompt text or secrets.
- [x] Add a failing regression fixture for model questions already satisfied by structured answers.
- [x] Normalize repeated questions without discarding a valid proposal or user selections.
- [x] Preserve the entered description, selected connections, and resource grants through retry.
- [x] Run full server and Swift verification, commit, simplify, rebuild, and relaunch.

Review:

- The reported technical message was false. It came from a `needs_information` response with zero questions, not from repeated questions.
- Selected connection identities now come from authoritative app state when a valid model draft omits them. Unknown and duplicate model connections remain rejected.
- Invalid time zones fail request validation with a clear 400 response. Proposal fallback can no longer return an empty question set and instead returns a typed retryable service error.
- Exact-bound text sanitization no longer produces a value one character beyond the schema limit.
- The macOS recovery card now uses one title, one outcome sentence, one primary action, and a quiet technical-details disclosure. Empty answers no longer count as completed questions.
- Verification: 1,234 server tests, 330 Swift behavior tests, TypeScript type-check, ESLint, server build, and the unsigned macOS build passed. UI automation was not run.

## Home activity simplification

- [x] Remove the decorative “on watch” count from the home hero.
- [x] Remove redundant Notion account exclusion copy from creation setup.
- [x] Add failing behavior coverage that keeps conversational turns out of Recent Activity.
- [x] Preserve chat runs in full agent history and run detail.
- [x] Run Swift behavior tests and an unsigned build, commit, simplify, and relaunch.

Review:

- Home no longer shows the decorative agent-count claim.
- Recent Activity excludes conversation-linked turns before applying its seven-item limit. Chats remain available in agent history and run detail.
- Service selection no longer explains that unselected Notion accounts will not be added.
- Verification is included in the regression review above. UI automation was not run.

## Required output contract enforcement

- [x] Audit existing agent `output` declarations and captured tool-call evidence.
- [x] Add failing schema tests for a generic required primary output tool and target.
- [x] Add failing runtime tests for missing tool calls, wrong targets, failed writes, and valid outputs.
- [x] Validate required output before recording a run as completed.
- [x] Return an actionable failure code and preserve diagnostic evidence without exposing secrets.
- [x] Run full server and Swift verification, commit, simplify, rebuild, and relaunch.

### Required output contract review

- Required contracts are explicit and opt-in. They validate an exact successful tool, a recursive exact destination field/value, and a reviewed call-count range before any completion record, notification, telemetry event, or downstream trigger.
- Missing calls, failed tools, wrong destinations, and incorrect call counts fail with `output_contract_unmet`. The stored run keeps the safe code and consumer error, while raw tool inputs and outputs remain out of history and diagnostic evidence.
- Safe tests bypass external-output enforcement. Conditional workflows remain advisory until their condition can be represented deterministically.
- Five unconditional live agents now enforce delivery. Daily Focus, Weekly Status Report, Weekly Goals Report, and CMO Coaching require one successful output. Daily Portuguese and French requires two. Proactive Work remains advisory because zero outputs can be correct.
- Verification: 1,231 server tests across 91 files, 325 Swift behavior tests, TypeScript type-check, ESLint, server build, and the unsigned macOS build passed. UI automation was not run.

## Drawer navigation and Advanced settings correction

- [x] Inspect Advanced settings grouping and place Agent Panel telemetry with the controls it affects.
- [x] Add failing behavior coverage for Escape dismissal and sidebar-driven detail replacement.
- [x] Let Escape close agent detail before closing its parent surface.
- [x] Let sidebar selection close the current detail or replace it with the selected agent.
- [x] Trace the latest Weekly Goals Report output to its exact local or connected destination.
- [x] Run Swift behavior tests and an unsigned build, commit focused batches, simplify, and relaunch.

### Drawer navigation and Advanced settings review

- Agent Panel progress reporting now lives inside the Agent Panel card instead of appearing as an unrelated Advanced grid card.
- Agent detail behaves like a macOS inspector. The sidebar remains interactive while the main pane stays inert. Escape closes settings, then history, then the detail drawer.
- The latest Weekly Goals Report produced no document. It read from Notion and Slack, but never called a Notion page-creation tool, sent a Slack message through a tool, or wrote a local file. Agent Server recorded a clean model exit without verifying the required output contract.
- Verification: 324 Swift behavior tests and the unsigned macOS build passed. UI automation was not run.

## Trigger timeout regression

- [x] Add failing coverage for a trigger that outlives the ordinary five-second request timeout.
- [x] Stop reporting request timeouts as server-offline failures.
- [x] Reconcile authoritative runs after an uncertain trigger result before offering Retry.
- [x] Preserve and show the reason when a duplicate invocation is skipped.
- [x] Keep MCP connection credentials out of Claude child-process arguments.
- [x] Run complete server and macOS verification, commit coherent batches, simplify, and relaunch.

### Trigger timeout regression review

- Manual triggers use a 75-second request budget for model-backed safety checks. A timeout is presented as an uncertain operation with a non-destructive Check status action, never as proof that the server is offline.
- Run reconciliation finds a matching run started after the request. A rejected duplicate records `lock_contention`, explains that the agent was already running, and cannot hide the original run's completed outcome.
- Claude MCP configuration is sent through the SDK control stream before the user prompt is released. Connection credentials are not placed in child-process arguments.
- Verification: 1,212 server tests across 90 files, 322 Swift behavior tests, TypeScript type-check, ESLint, server build, and the unsigned macOS build passed. UI automation was not run.

Status: Native service integration and final release verification are complete.

## Connection account model correction

- [x] Restore `~/.agent-server/.env` as the single environment file used by the app and server.
- [x] Replace key-centric connection language with a named, repeatable account model.
- [x] Define legacy key adoption and exact connection identity rules for multiple Notion and Linear accounts.
- [x] Read configured connection readiness from the instance-aware service registry instead of generic catalog keys.
- [x] Show each existing named connection separately and edit its exact environment references without exposing values through the API.
- [x] Run affected server and Swift tests and build both targets without UI automation.
- [x] Commit this correction and complete its post-commit simplification pass.

### Existing key recognition review

- Existing named connections such as Personal Notion now show Connected and Modify keys when their exact referenced key exists in the selected Agent Server folder's `.env` file.
- The local API returns environment variable names needed by a connection, never their values. The edit sheet reads values directly from the local `.env` file.
- Generic catalog readiness no longer overrides a named account's identity. `NOTION_PERSONAL_API_KEY` is not treated as an alias for `NOTION_API_KEY`.
- Verification: 1,153 server tests, 246 Swift behavior tests, TypeScript type-check and build, and the unsigned macOS app build passed. UI automation was not run.
- Post-commit simplification moved reusable connection rows and the key-editing sheet out of the main drawer view. The focused files are 335 and 303 lines, with the same 246 Swift tests and unsigned app build passing.

## Generic connection platform

- [x] Separate a user-chosen connection label from runtime behavior and credential variable names.
- [x] Define opaque connection identity, arbitrary credential references, transport configuration, capability discovery, and reviewed agent grants.
- [x] Compile the current Personal Notion transport into exact real operations instead of tools from a different Notion connection.
- [x] Persist workspace-local connection definitions containing references but no secret values.
- [x] Add conservative adoption planning for existing inline MCP configurations and loose `.env` credential references.
- [x] Add the guided macOS flow for templates and custom connections, readiness checks, discovered actions, and agent selection.
- [x] Update canonical source agents under `~/Developer/brain`, regenerate, verify, and review diffs.

### Connection platform decisions

- Labels are user-owned presentation text. Renaming a connection cannot change its credentials, transport, tools, agent bindings, or runtime identity.
- Templates provide defaults only. Custom MCP, OpenAPI, manual API, and native adapters use the same opaque connection and operation models.
- Credential values remain in `~/.agent-server/.env`. Connection records store only environment variable references.
- Configured operations come from transport discovery or versioned adapter declarations. Unknown operations remain unavailable until reviewed.
- The Connections drawer serves technical knowledge workers with guided defaults plus expandable environment, transport, endpoint, command, inventory, and exact grant details.

## Full macOS experience audit

- [x] Inventory every primary screen, drawer, sheet, empty state, error state, and multi-step flow.
- [x] Audit first impression, task clarity, navigation, visual hierarchy, terminology, repetition, control density, keyboard use, VoiceOver, and reduced motion.
- [x] Define a three-level disclosure model: immediate decision, useful context, and technical details.
- [x] Simplify creation, connections, agent details, run history, debugger, security, and settings without removing advanced control.
- [x] Add behavior tests before each consequential correction and reuse shared components and copy models.
- [x] Verify all Swift behavior tests and an unsigned macOS build without UI automation.
- [x] Document findings, implemented corrections, deferred items, and rationale.

Implemented audit corrections:

- [x] Preserve reviewed creation answers when editing a proposal.
- [x] Observe safe-test and debugger retry runs through their exact terminal state.
- [x] Stage agent capability edits until Save and discard them on Cancel.
- [x] Prevent required missing connections from appearing ready to save.
- [x] Lead proposals with outcome, schedule, missing setup, and risk.
- [x] Explain Run now failures and offer the correct recovery action.
- [x] Keep failed and pending agents visible in completed security results.
- [x] Add progressive saved-connection detail panels with redacted references.
- [x] Persist resume-after-wake and automatic-update settings.
- [x] Reject stale logs and hydration responses after a run selection changes.
- [x] Show Safety and readiness as a visible agent-detail row.
- [x] Respect diagnosis-specific retry safety and hide empty debugger evidence.
- [x] Make open drawers inert behind the active surface and honor Reduce Motion.
- [x] Add composed VoiceOver labels and arrow-key tab navigation to run details.
- [x] Make Settings responsive and place infrastructure controls under Advanced.
- [x] Add rename, duplicate, readiness, and reference-safe removal to saved connection details.
- [x] Replace key-first connection language with named connections and optional templates.

Current verification:

- 315 Swift behavior tests pass.
- The unsigned macOS app builds successfully.
- No UI automation was run.

### Settings hierarchy and responsiveness

- [x] Add failing behavior coverage for primary versus advanced settings and narrow-window layout.
- [x] Make Settings content vertically scrollable and adapt between one and two columns.
- [x] Keep runtime controls visible while placing Agent Panel, raw environment, and telemetry behind Advanced.
- [x] Move support and promotional destinations to About and remove decorative footer copy from Settings.
- [x] Extract focused Settings components so the drawer coordinates state instead of owning every presentation detail.
- [x] Run focused and full Swift tests plus an unsigned build, commit, and complete a simplification review.

Settings now has one predictable reading order and remains usable when the drawer is narrower than two readable cards. General, coding agents, notifications, storage, and updates lead. Agent Panel, raw environment values, and telemetry remain available under Advanced. Support links live in About, and Settings no longer carries promotional links or decorative footer copy. The drawer coordinator fell from 1,077 to 637 lines by extracting the environment editor and reusable settings rows. Verification: 310 Swift behavior tests and the unsigned macOS app build passed. UI automation was not run.

## Utility navigation and drawer consistency

- [x] Put Security check, Connections, and Settings in one bottom-right icon cluster in that order.
- [x] Give every icon a tooltip, accessibility label, and stable test identifier.
- [x] Make Security check use the shared top-drawer surface, geometry, dimming, close control, and motion.
- [x] Verify behavior tests and an unsigned macOS build without UI automation, then commit and simplify.

### Utility navigation review

- Security check, Connections, and Settings now form one trailing icon cluster.
- All three use one top-drawer surface and one overlay implementation, so height, title placement, close control, dimming, shape, shadow, Escape handling, and motion cannot drift independently.
- Agent-specific security review returns to that agent when closed. The global dashboard closes to the main screen.
- Verification: 212 Swift behavior tests and the unsigned app build passed. UI automation was not run.

## Background security scan

- [x] Start a quiet security scan after the main window has loaded its agents.
- [x] Analyze agents sequentially and publish progress without blocking the main thread.
- [x] Show live shield status in the Security drawer header and agent-by-agent progress in the drawer.
- [x] Show an accessible notification badge on the Security footer icon for failures and findings that need attention.
- [x] Keep manual retry and scan-again actions, coalescing duplicate scan requests.
- [x] Verify behavior tests and an unsigned macOS build without UI automation, then commit and simplify.

### Background security review

- Opening the main window starts a coalesced local check after the agent list arrives and repeats when security-relevant agent presentation changes.
- Agents are checked in name order, one at a time. A failed agent receives its own failed row and does not prevent later agents from being checked.
- The bottom-right shield uses a subtle 1.1-second pulse while checking and stops under Reduce Motion. The drawer header uses the shield position as its working or error indicator.
- The footer shows an accessible red error marker for scan failures and a count for high or critical agents. Low and ordinary Needs review results remain in the drawer without turning the footer into a constant alarm.
- Verification: 219 Swift behavior tests and the unsigned app build passed. UI automation was not run.

## Agent storage and runtime settings correction

- [x] Remove the folder action from the agent sidebar.
- [x] Add a Settings card for the active Agent Server folder with Choose, Open in Finder, and restore-default actions.
- [x] Resolve the companion `.env` from the selected Agent Server folder while preserving `~/.agent-server/.env` for the default folder.
- [x] Make agent file access, local API authentication, connection editing, and the launched server use one selected location.
- [x] Move installed Claude and Codex controls into one dedicated card.
- [x] Show the shared restart requirement only after a runtime choice changes, with a Restart now action.
- [x] Put Agent Panel sending and connection state in Advanced, gated by both required credentials.
- [x] Remove developer-only agent counts and panel transport language from General.
- [x] Add behavior tests first, run Swift and server verification without UI automation, commit, and simplify.

### Agent storage and runtime settings review

- The selected setting is an Agent Server folder, not a loose agents directory. It owns `agents/`, `.env`, locks, logs, and local history as one coherent workspace.
- Changing the folder never moves or deletes existing files. The confirmation names the exact agent and private-settings paths before applying the change.
- Claude and Codex share one card because both installed-runtime choices are discovered at server startup. The restart action appears only after either choice changes.
- Agent Panel traffic is enabled by default for compatible existing setups, can be explicitly turned off without deleting credentials, and remains unavailable until both required values are present.
- Cancel now sits directly left of the primary creation action.
- Verification: 1,142 server tests, 226 Swift tests, TypeScript type-check and build, and the unsigned app build passed. UI automation was not run.

## Consolidated creation setup

- [x] Return every unanswered supported service mentioned in the request as one deterministic question group.
- [x] Present one connection card per mentioned service, with no unrelated service cards and no “Your answer” wrapper.
- [x] Use the connection-step title “Let's setup the connections you need for your agent” and the approved explanatory copy.
- [x] Replace the file-access answer box with one native macOS selection surface and the approved permission explanation.
- [x] Keep file access optional when the request does not refer to local files or folders.
- [x] Record privacy-safe unsupported service demand in PostHog without prompt text, paths, credentials, or surrounding context.
- [x] Add server and Swift behavior tests first and build without UI automation.

### Consolidated creation setup review

- The creation service returns one ordered card for each mentioned supported service. Notion, Slack, Linear, and Gmail never appear unless the request names them.
- Each service card selects an exact configured connection and keeps a valid choice when connection readiness refreshes.
- Local file access appears only when the requested job needs local files or folders. A scheduled Slack heartbeat proceeds without asking for disk access.
- File and folder choices use one native macOS panel. Every selected item has its own View only or Can make changes control, with View only as the default.
- Unsupported-service telemetry contains only fixed service identifiers and a count. It excludes request text, file paths, connection names, and credentials.
- Verification: 1,145 server tests, 231 Swift tests, TypeScript type-check and build, and the unsigned app build passed. UI automation was not run.
- Post-commit simplification now derives creation-time service detection from the shared capability catalog, including TripMaster and CalorieNerds, instead of maintaining a second service list. Verification: 1,146 server tests, TypeScript type-check, and server build passed.

### Environment path review

- The app and server now read the documented `~/.agent-server/.env` file only.
- Connection setup writes to that same file and the UI names it accurately.
- Verification: 1,139 server tests, 210 Swift tests, TypeScript type-check and build, and the unsigned app build passed.

## Consumer UI cleanup

- [x] Explain why Notion is requested and show its bundled brand mark.
- [x] Present exact Notion accounts as clear connected choices.
- [x] Replace the sidebar footer card with aligned native action rows.
- [x] Remove duplicate schedule glyphs and make agent rows keyboard-accessible buttons.
- [x] Verify 209 Swift tests and the unsigned app build without UI automation.

## Answered-question fallback correction

- [x] Add failing coverage for model failure after exact service and file answers.
- [x] Produce a validated local proposal without repeating answered questions.
- [x] Preserve the confirmed Notion identity, file grants, and simple daily schedule.
- [x] Prove unrelated workflows do not receive Notion.
- [x] Verify 1,139 server tests, lint, type-check, and build.

## Proposal timeout correction

- [x] Add a failing contract test that gives model-backed guidance routes enough time to finish or fall back safely.
- [x] Keep health and ordinary local API requests on their short timeout.
- [x] Verify 207 Swift tests and the unsigned app build, then relaunch without UI automation.
- [x] Commit the tested correction and run a post-commit simplification review.

## Folder picker correction

- [x] Replace the two file-access actions with one native picker that accepts files and folders.
- [x] Keep the separate folder-only mode for questions that require a working folder.
- [x] Verify 206 Swift tests and the unsigned app build, then relaunch without UI automation.
- [x] Commit the tested correction and run a post-commit simplification review.

The consumer-facing file-access control should present one clear action. The native panel handles the difference between files and folders.

## Unified services and resource grants

- [x] Add a tested local Services registry that presents discovered MCP accounts, configured API-key services, and safe reusable agent-defined MCP services as stable named connections. Native macOS services remain in the next batch.
- [x] Make agent creation select an exact service connection, clearly distinguishing Personal Notion from Work Notion, and materialize the selected runtime configuration without copying secrets.
- [x] Add multiple file and folder grants with independent View only or Can make changes access, preserving every grant in generated agent configuration and security analysis.
- [x] Add scoped Calendar and Reminders grants with exact resource and action review.
- [x] Add read-only Contacts grants with exact group and field review.
- [x] Keep Apple Music visibly unavailable until the signed app has the required MusicKit capability and a tested read-only runtime.
- [x] Use every grant model in proposal review, structured validation, security analysis, and preflight checks. Use file grants for scoped Debugger fixes and Calendar or Reminder mutation grants for current Security Analyzer fixes.
- [x] Add server and Swift behavior coverage first, then run full server tests, Swift tests, type-check, server build, and unsigned Xcode build without UI automation.
- [x] Run a simplification review after every consequential commit, record the final verification here, and launch the verified build.

### Services and file grants review

- Exact connection identities resolve to reviewed runtime bindings at save time. Changed, missing, conflicting, secret-bearing, or arbitrary executable configurations fail closed.
- Only services relevant to the request or explicitly selected are disclosed to the proposal model and eligible for save.
- Each selected file or folder keeps its own read-only or read-write grant. Exact paths are withheld from model prompts and validated with the persisted agent schema.
- Scoped file agents use the Claude runtime because the current Codex boundary cannot enforce individual files without widening access. Commands cannot be combined with exact file scopes.
- Canonical path checks block symlink escapes and apply the narrowest overlapping grant. Missing permission blocks deny every tool by default.
- Post-commit simplification now canonicalizes connection labels, restricts service answers to typed connection questions, recomputes risk after local grants, deduplicates analyzed paths, and precomputes canonical grant roots.
- Verification: 1,093 server tests, 193 Swift tests, TypeScript type-check and build, and an unsigned Xcode build passed. UI automation was not run.

### Architecture constraints

- Consumers choose a named connection such as Personal Notion or Work Notion. MCP, API-key, OAuth, and native framework details remain secondary metadata.
- A service definition, a configured connection instance, and an agent's scoped grant are separate models.
- Agent files contain stable connection references and environment-variable references only. They never contain credential values.
- Existing agent-defined MCP configurations remain compatible and can be offered as reusable local connections when their configuration is safe to copy.
- File and native-service permissions are least-privilege grants. No global write permission is inferred from one writable resource.
- Calendar and Reminders continue through EventKit. Contacts and Apple Music must use native framework or approved local-helper boundaries, not shell automation hidden from the user.

### Native service verification

- Calendar and Reminders use exact resource IDs and reviewed actions in the native helper.
- Contacts is read-only, does not return stable contact IDs, limits returned fields, and disables linked-contact unification so an approved account cannot pull details from another account.
- Contacts combined with network, messaging, or any non-EventKit MCP output is classified as high risk.
- Apple Music remains a documented unavailable capability until MusicKit signing and a read-only runtime are verified.
- Verification: 1,139 server tests across 83 files, 209 Swift tests, TypeScript type-check and build, plus unsigned app and helper builds. UI automation was not run during the final pass.

## Consumer correction batch

- [x] Restore existing Notion Personal and Hex agents without weakening literal-secret protections.
- [x] Repair native Edit menu routing so Command-C, Command-V, Command-X, and Command-A reach the first responder.
- [x] Make read-only consumer content selectable while keeping controls easy to use.
- [x] Resolve required app and service connections before asking for file or calendar scope during creation.
- [x] Verify with behavior tests, full affected suites, an unsigned macOS build, and focused manual checks without UI automation.

### Consumer correction review

- All six local definitions load again, including CMO Coaching and Daily Portuguese and French. No agent files were changed.
- Creation resolves Notion first, preserves stable connection IDs, confirms named Personal or Work accounts, then asks for file scope.
- Native editing shortcuts use the responder chain, repair localized menus without replacing existing commands, and normalize Command key equivalents.
- Static content is selectable in the main window, menu popover, and About view.
- Verification: 1,057 server tests, 191 Swift behavior tests, TypeScript type-check and build, and an unsigned Xcode app build. UI automation was intentionally omitted to avoid taking keyboard focus.

## Approved cleanup integration

The audit at `~/Desktop/codebase-cleanup.md` is part of this plan. Its work is
sequenced as follows so security and reliability fixes land before model-backed
features depend on them:

- [x] Milestone 1 prerequisites: wrong-agent draft overwrite, persistent
  WebSocket reconnect, always-on local API key, authenticated macOS client,
  Claude child environment allowlist, safer default permissions, restricted
  environment substitution, same-origin and Host validation, WebSocket and
  terminal-payload redaction, file-log redaction, real client address rate
  limiting, and heartbeat correction.
- [x] Milestone 2 reliability: split Swift transport and decoding failures,
  resolve Node through the configured child PATH, move process waiting off the
  main actor, wire or remove dead settings toggles, and bound tracking sets.
- [x] Structural work needed by these features: extract the tested run lifecycle,
  consolidate permission decisions, split macOS guidance and security services,
  isolate environment-file access, and add focused process and endpoint seams.
- [x] Local hygiene in scope: untrack Wrangler and Xcode user state, remove the
  replaced creation sheet, and update feature documentation. Broader catalog,
  executor, and generated project-instruction cleanup remains outside this
  feature branch unless a future change needs those seams.
- [ ] Defer Keychain migration until the server has a matching token bridge.
  Keep the current `0600` local secret store during this implementation.

Every cleanup item will be checked against current callers before deletion.
Security fixes receive behavior tests before production changes.

## Verified baseline

- [x] Baseline commit: `5b779736985e918874b80b390372be71645dc19a`
- [x] Branch: `creation-experience`
- [x] Worktree clean before discovery
- [x] Server tests: 862 passed across 60 files
- [x] Swift tests: 126 passed
- [x] Lint, TypeScript check, server build, and unsigned macOS build passed
- [x] Xcode 26.6, Swift 6.3.3, macOS 26.5 SDK, xcodegen 2.45.4 available
- [x] Accessibility Inspector and Apple test tooling available
- [x] Existing creation, connection, agent editing, run history, theme, and drawer patterns inspected

## Product assumptions

- Core operation stays local and requires no cloud account.
- Local Codex with the user's current ChatGPT login is the default model service
  for proposal generation and semantic diagnosis. The model runs with no tools,
  no network, a read-only sandbox, strict output schemas, and a bounded timeout.
- GPT-5.6 remains an adapter option if the installed runtime exposes it. No new
  hosted API dependency or credential is required for this work.
- The Node server owns parsing, deterministic analysis, content hashing,
  structured patches, and model-output validation because it already owns the
  canonical agent schema and lossless writer.
- The macOS app owns native guided state, file and folder selection, connection
  setup, review, confirmation, presentation, accessibility, and undo controls.
- Agent Markdown remains the source of truth. Security review metadata and fix
  history stay in local app data and never enter agent files.
- Existing connection secrets remain in the current `.env` path for this
  milestone. A move to Keychain requires a matching server token bridge and must
  be done as one separate security change.
- Existing agents continue to run after upgrade unless a deterministic critical
  issue is found. New or changed high-risk agents require review before their
  first manual run or schedule activation. Critical agents are blocked until the
  specific critical finding is reviewed or fixed.

## Architecture decisions

### Shared local analysis core

Add `server-app/src/analysis/` as the shared domain boundary:

- `models.ts`: strict Zod schemas for severity, evidence, findings, actions,
  patches, proposal, diagnosis, preflight, and validation results.
- `redaction.ts`: allowlisted redaction for prompts, URLs, headers, command
  arguments, tool evidence, logs, model inputs, model outputs, and API responses.
- `security-rules.ts`: deterministic rules for permissions, paths, secrets,
  commands, external endpoints, triggers, chaining, and prompt risks.
- `diagnostic-rules.ts`: deterministic checks and error-pattern heuristics.
- `patch.ts`: typed patch validation, preview, content hash checks, apply, and
  rollback records built on the existing YAML `Document` writer.
- `structured-model.ts`: local Codex structured-output adapter with one careful
  retry for malformed output and deterministic fallback.
- `prompts/`: versioned proposal, diagnosis, and semantic-risk prompts.
- `review-store.ts`: local SQLite review metadata keyed by agent ID, content
  hash, and analyzer version.

The data flow will be:

```text
SwiftUI guided state
        |
        v
Typed localhost API -> parse and redact -> deterministic rules
        |                                      |
        |                                      v
        |                              immediate safe result
        v
Optional local Codex structured pass -> schema validation -> merged result
        |
        v
Previewed typed patch -> content-hash check -> atomic write -> undo record
```

### Canonical agent document access

Evolve the existing writer into a repository interface that can read a raw local
document internally, parse it, compute its content hash, preview a patch, apply
with compare-and-swap protection, and restore a bounded backup. Raw unredacted
documents never cross the localhost API.

Keep the current guarantees:

- Preserve unknown top-level fields, ordering, comments, and Markdown body.
- Validate the complete result with `AgentConfigSchema` before writing.
- Use atomic temp-file replacement.
- Refuse apply when the source hash changed after preview.
- Return a redacted exact diff for Advanced details.
- Keep a bounded local backup only for applied patches so Undo is practical.

Nested comments inside a replaced field such as `mcp_servers` may not survive a
whole-field replacement. Prefer narrow child edits where the YAML library can
preserve them, test the limitation, and document it.

### Run evidence and identity

Unify run ID ownership before debugger work. The API, WebSocket, local store,
telemetry reporter, cancellation path, retry link, and lock-contention result
must all refer to one run ID.

Persist bounded, structured diagnostic evidence rather than full transcripts:

- Tool name and redacted failure summary
- Exit code and bounded stderr or stdout excerpts
- MCP connection state
- Runtime identity and availability
- Effective sandbox and network settings
- Parsed configuration hash
- Stop reason and error code
- Expected-output checks
- `retry_of_run_id`, `repair_id`, and safe-test mode

Evidence is redacted before storage, size-capped, and returned only for the
requested run. Existing failed runs remain unchanged when a retry starts.

### Before-run policy

Add a deterministic preflight used by creation, Run now, safe test, debugger
fixes, and the scheduler. It returns `allow`, `confirm`, or `block` plus specific
findings. A stored acknowledgement applies only to the same content hash and
analyzer version.

- Low risk: allow.
- Needs review: show context but do not require repeated confirmation.
- High risk: require explicit confirmation before first run or schedule enable.
- Critical: block literal-secret and unrestricted destructive plus network cases
  until reviewed or fixed.

Safe test uses a transient execution override. It never edits the saved agent to
reduce permissions. The override disables writes, commands, network, external
messages, and automatic chaining unless the approved proposal requires a single
narrow capability that can be tested without side effects.

## Milestone plan

### 1. Shared schemas, redaction, and run identity

- [x] Write failing tests for shared schemas, redaction, content hashes, and the
  current duplicate run-ID behavior.
- [x] Add shared analysis models and discriminated unions.
- [x] Replace narrow regex-only redaction with bounded, context-aware redaction.
- [x] Reject literal provider credentials at schema and patch boundaries.
- [x] Sanitize WebSocket metadata and stored diagnostic evidence.
- [x] Unify run IDs across API, store, reporter, WebSocket, cancellation, and
  lock-contention paths.
- [x] Run server tests, lint, type check, and build.

### 2. Security analyzer and review state

- [x] Write failing behavior tests for each deterministic security rule.
- [x] Add normalized sensitive-path detection for home roots, hidden secrets,
  SSH, cloud credentials, browser profiles, Keychain data, signing material,
  application support, `.env`, and password stores.
- [x] Add redacted secret detection for YAML, Markdown, URLs, headers, provider
  config, MCP config, and prompts.
- [x] Analyze tools, denials, permissions, sandbox, network, working directory,
  watch paths, schedules, endpoints, notification targets, interaction targets,
  chaining, command arguments, and automatic triggers.
- [x] Add semantic prompt-risk analysis through validated local Codex output.
- [x] Merge deterministic and semantic findings without allowing the model to
  downgrade deterministic severity.
- [x] Cache analysis by content hash and analyzer version.
- [x] Add local review records, acknowledgements, staleness, and redacted report
  export data.
- [x] Add security analysis, global summary, mark-reviewed, and preflight API
  routes.

### 3. Structured patch preview, apply, and undo

- [x] Expand `AgentPatchSchema` to cover working directory, permissions, Codex
  sandbox, MCP servers, watches, triggers, interactions, conversations,
  telemetry, model settings, notifications, and enabled state.
- [x] Define low, medium, high, and forbidden patch operations.
- [x] Reject attempts to grant `danger-full-access`, unrestricted home access,
  arbitrary command execution, credentials, deletion, or unrelated-agent edits
  through automated fixes.
- [x] Add preview with consumer changes, safety impact, exact redacted diff, and
  expected source hash.
- [x] Add apply with complete-result validation and an audit record containing
  source, time, before hash, after hash, and affected fields.
- [x] Add bounded backup restore for Undo.
- [x] Test unknown-field and comment preservation, concurrent file edits,
  malformed input, stale previews, rollback, and nested-field limitations.

### 4. Conversational agent creation

- [x] Define and test `AgentProposalSchema` with name, description,
  instructions, trigger, schedule, timezone, capabilities, connections, paths,
  read/write intent, commands, network, notifications, runtime, risk,
  explanation, missing information, and required questions.
- [x] Add a dedicated least-privilege generation prompt and strict local Codex
  adapter with timeout, cancellation, one validation retry, and deterministic
  fallback.
- [x] Map proposal capabilities to the existing server capability catalog and
  current connection readiness.
- [x] Generate frontmatter plus Markdown with explicit permissions, safe
  defaults, success criteria, output expectations, missing-data behavior,
  secret handling, and destructive-action constraints.
- [x] Extend creation to save every proposal field without creating a second
  config format.
- [x] Support source-agent redacted cloning and proposal differences.
- [x] Run the security analyzer before save and preflight before safe test.
- [x] Add a safe-test run mode and typed outcome.

### 5. Deterministic and model-assisted debugger

- [x] Persist the bounded evidence required for local diagnosis without Agent
  Panel.
- [x] Add checks for malformed files, schedules, time zones, paths, permissions,
  connections, environment references, runtimes, models, endpoints, network,
  sandbox, notifications, locks, active runs, and expected outputs.
- [x] Add known-error heuristics with consumer explanations and evidence.
- [x] Add a redacted Codex diagnosis only after local checks, with strict schema,
  confidence, alternatives, risk, affected settings, and safe-rerun guidance.
- [x] Add repair preview through the shared patch system.
- [x] Add apply, retry linkage, resolution comparison, and undo.
- [x] Add prevention guidance based on the resolved deterministic cause.

### 6. Native macOS experience

- [x] Preserve the current sheet host and rebuild `CreateAgentSheet` as a guided
  state machine: describe, answer, proposal, connections, security, save/test.
- [x] Reuse NerdsUI tokens, `ScheduleField`, `CapabilityIconView`, connection
  sheets, agent detail drawer, run detail tabs, Markdown editor, and status
  patterns.
- [x] Add folder and file selection with `NSOpenPanel` or `fileImporter` and
  normalized native path presentation.
- [x] Add New agent entry points in the sidebar empty state and Command-N.
- [x] Add Create something similar from agent detail.
- [x] Add a Debugger tab for failed runs, friendly failure banner, fix preview,
  apply/retry status, technical details, copy, and undo.
- [x] Add agent security summary, preflight confirmation, settings entry, context
  action, and a global Security check top drawer.
- [ ] Add notification routing with run and agent IDs so a failed notification
  can open the debugger.
- [x] Add shared card, finding, severity, empty, loading, error, and Advanced
  details components using the existing visual tokens.
- [ ] Complete a manual reduced-motion review of the new flows and existing
  pulsing status views. New consumer states do not rely on motion for meaning.
- [x] Add VoiceOver labels, non-color severity symbols, focus order, status
  announcements, large-text-safe layouts, keyboard shortcuts, and stable
  accessibility identifiers.

### 7. macOS state tests and UI flows

- [x] Add pure Swift state machines and presentation formatters to
  `AgentServerCore` for creation, schedule, permissions, risk, finding groups,
  debugger, patch preview, review staleness, loading, and errors.
- [x] Add XCTest coverage for state transitions and summaries.
- [x] Add an `AgentServerUITests` target through `project.yml` and regenerate the
  Xcode project.
- [x] Add deterministic demo launch fixtures with no credentials or personal
  paths.
- [x] Cover the eight requested UI behaviors with four deterministic signed test
  scenarios. The complete suite passed once; later focus interference is noted
  in the final verification report.
- [x] Add SwiftUI previews for proposal, debugger, findings, global dashboard,
  empty, loading, and error states where practical.
- [ ] Inspect the built app with Accessibility Inspector and keyboard-only use.
  This remains a manual release task and is not claimed by automated checks.

### 8. Documentation, demo, and final verification

- [x] Add feature, architecture, privacy, security, model-use, deterministic
  logic, secret protection, test, limitation, and future-work documentation.
- [x] Add the concise threat model with assets, trust boundaries, attacker
  inputs, mitigations, residual risk, and blocked operations.
- [x] Add a manual matrix for fresh install, upgrade, offline server, missing
  runtime, missing connections, malformed and large inputs, VoiceOver,
  keyboard-only use, themes, reduced motion, no network, and first run.
- [x] Add redacted demo agents and run evidence for the suggested demo flow.
- [x] Add a Build Week section with baseline commit, new work, Codex role,
  GPT-5.6 role, human decisions, tests, session placeholder, and demo steps.
- [x] Add five deterministic SwiftUI previews without personal data. Standalone
  screenshot capture remains a manual release task.
- [x] Run `pnpm test`, `pnpm test:coverage`, `pnpm lint`, `pnpm type-check`,
  `pnpm build`, Swift tests, UI tests, and macOS build.
- [x] Record results, known limitations, file links, commit IDs, and the final
  verification report in this document.

## Commits

Each commit includes its tests and keeps the repository buildable:

1. `65d033a` Harden local execution and add analysis foundation
2. `919c6fe` Simplify local security and reliability policies
3. `2a3b249` Add structured security proposal and diagnostic services
4. `f73f3b1` Fix confirmed network patch materialization
5. `47e5d5e` Add native creation debugger and security flows
6. `3e4e61c` Document consumer agent tools and demo
7. `40e8e1b` Wire guided creation and validated debugging
8. `866fe30` Integrate guided creation security and debugging APIs
9. `aacac2b` Split macOS guidance and security services
10. `53a6cfe` Harden macOS process management and local hygiene
11. `7b43031` Enforce reviewed execution and linked recovery
12. `5d60414` Simplify run trigger contract
13. `67f41a6` Add similar-agent and connection guidance flows
14. `d3877ef` Polish guided creation source layout
15. `f56645e` Remove tracked Xcode user state
16. `5b920a1` Extract tested server run lifecycle
17. `bcf7502` Clarify lifecycle integration boundary
18. `c40aa0d` Add deterministic macOS consumer UI flows
19. `09d8ddc` Inherit shared UI test signing settings
20. `36e6efa` Add Create Agent to main navigation
21. `2f523fe` Consolidate macOS environment and run history state
22. `c6d2a70` Complete Build Week verification and documentation
23. `7214d0f` Anchor agent creation in the main window
24. `ed08e9b` Keep sidebar interactive beside creation drawer
25. `4222e80` Scope file and calendar access during creation
26. `ec36800` Add calendar access recovery guidance

## Plan review questions

- Confirm the before-run policy for existing agents: only deterministic critical
  findings block them after upgrade; high-risk findings warn until the content
  changes or the user edits the agent.
- Confirm local Codex as the default structured model service, with deterministic
  fallback when it is unavailable.
- Confirm a separate local SQLite review database under `~/.agent-server/` rather
  than writing review metadata into agent Markdown.

## Review notes

- Feature implementation and automated verification are complete on
  `creation-experience` through `ec36800`.
- Final server verification passes 1,050 tests across 80 files, lint, strict
  TypeScript checking, and the production build.
- Server coverage is 78.82% statements, 74.59% branches, 80.28% functions, and
  80.23% lines.
- Swift verification passes 183 behavior tests. The full four-test signed
  macOS UI suite passed once in 34.8 seconds and covers the eight requested UI
  behaviors. A later redundant rerun was interrupted after another app stole
  focus, and UI testing stopped at the user's request.
- Five deterministic SwiftUI previews cover creation, proposal review,
  debugging, the global dashboard, and an agent security check. Standalone
  screenshots were not captured.
- Manual Accessibility Inspector, VoiceOver, keyboard-only, large-text,
  reduced-motion, and light and dark appearance checks remain release tasks.
- The final evidence record is in `docs/FINAL_VERIFICATION.md`.
- The existing v2 plan remains below for historical context.

# Agent Server v2 plan

Local-first personal agent runner, powered by the user's own Claude and Codex
subscriptions, simple enough for a non-technical person, safe enough to trust.

## What v2 is

A menu bar app and local server that runs scheduled AI agents on your Mac. No
cloud service, no account. Agents are plain markdown files. You choose, per
agent and in plain language, what it can touch and when it runs. It uses the
Claude and Codex subscriptions you already pay for, and can drive custom models
like Kimi K2. The format supports arbitrarily complex agents; the default path
is dead simple.

## Design principles

- Local-first. Everything runs on localhost. No external dependency to function.
- The markdown file is the source of truth. The UI shapes it; it never becomes
  a second source of truth. Full round-trip fidelity, including complex files.
- Default-deny safety. An agent can do nothing until you grant it, in plain
  language, one capability at a time. Every grant is reversible.
- Your subscription, your models. Claude and Codex run on your existing logins.
  Custom providers plug in without touching agent files (keys live in `.env`).
- Simple by default, powerful when needed. Grandma can create an agent; a power
  user can hand-write a 200-line one and it still works.

## Where we are today (verified)

- Consumer UI (detail drawer, gear editor, capability toggles, New Agent flow)
  exists on branch `claude/mack-consumer-ux-hpapsp` (PR #15). New Agent dialog
  just redesigned; not yet landed.
- Capability model is solid: toggles map to tools/disallowed_tools/mcp_servers,
  disabling never deletes, every toggle reversible, secrets only in `.env` as
  `${VAR}`. 747 server tests, 123 Swift tests pass.
- Subscriptions already work: `cli.ts` strips `ANTHROPIC_API_KEY` so Claude uses
  the subscription login; Codex uses the existing ChatGPT login.
- Panel is already optional: noop reporter when no panel URL. A standalone server
  does zero syncing.

## Gaps that block the vision

- Runtimes are bundled, not the user's install (`pathToClaudeCodeExecutable` /
  `codexPathOverride` unused).
- `agent.model` is not wired into the Claude path (Codex wires it). Blocks custom
  models on Claude.
- Run history is in-memory and seeded from the panel. Losing the panel loses
  history unless we persist locally.
- Panel code is threaded through ~20 server files and ~12 macOS files.

---

## Phase 0 — Land the base (days)

- [ ] Finish and verify the New Agent dialog redesign in the running app.
- [ ] Fix the Claude model gap: wire `agent.model` into `Options.model` in
      `plugins/claude-code.ts` (+ colocated test). Unblocks Phase 2.
- [ ] Land PR #15.

## Phase 1 — Local-first: retire the panel (1-2 weeks)

- [x] Add local run persistence. DONE via SQLite using Node's built-in
      `node:sqlite` (not better-sqlite3) — zero native dependency, so nothing to
      compile or code-sign inside the macOS app bundle. `SqliteRunStore`
      (`reporting/sqlite-store.ts`) is a drop-in for the in-memory `RunStore`
      behind a shared `RunStoreLike` interface; both share
      `run-normalization.ts`. Default db: `~/.agent-server/runs.db`
      (`AGENT_SERVER_RUN_DB`, `:memory:` for ephemeral). Opens with a graceful
      fallback to in-memory if the file is unusable. Verified: a fresh server
      process serves runs persisted before boot, with no panel dependency.
- [x] Local run history no longer depends on the panel. The server already
      writes run state directly into the store (the `Reporter` remains the
      optional panel-telemetry seam); making that store durable is the cleaner
      equivalent of a "local reporter" and keeps every downstream caller
      unchanged via `RunStoreLike`. Seeding from the panel still works but is now
      redundant — removed in the next step.
- [~] Remove panel paths. DECISION (revised): keep Agent Panel OPTIONAL, so the
      server keeps its config-gated panel wiring (`reporter.ts` telemetry,
      `sync-schedule.ts`, `panel-client.ts`, `realtime-client.ts`) as an opt-in
      integration a power user can point at. Only pruned what durable local
      history makes dead: `seed-run-store.ts` deleted (seeding history FROM the
      panel on boot is pointless now), and the scheduler no longer waits on a
      seed race — it starts immediately. All panel code stays inert when
      `panelUrl` is unset (already the case); zero dependency is preserved.
- [DEFERRED] Move decisions/interactions fully local. The simple `interaction`
      path is ALREADY fully local (channels + `on_reply`). The richer in-run
      `decision` block still rides the panel's SSE and no-ops standalone.
      DECIDED: defer and fold into the future bidirectional messaging-apps effort
      (WhatsApp + Telegram, both directions) rather than build a one-off local
      decision transport now. See Future work below.
- [x] Ghost-run cleanup becomes purely local (server owns its runs; no panel).
      `failOrphanedLocalRuns()` (`reporting/local-reconcile.ts`) runs at boot: a
      fresh process owns no in-flight runs, so any run still `running` in the
      durable store is failed with a clear reason. Needed now that history
      persists (an in-memory store was empty on restart, so ghosts couldn't
      exist). Panel-side cleanup stays as the optional path. Verified end-to-end:
      a seeded `running` run boots as `failed`, a `completed` run is untouched.
- [x] macOS: run history already reads local `/runs` as its primary source
      (`AgentRunsView`, `MainPane`) and merges panel rows only when configured.
      REVISED by keep-optional: do NOT delete `PanelClient`/`PanelRun`/cleanup
      UI — they are the optional dashboard enrichment. Local `/cleanup` kept.
- [REVISED] Keep panel env vars: keep-optional means the panel stays a
      config-gated integration, so its env vars remain (inert when unset). The
      standalone result is already zero cloud dependency without removing them.

## Phase 2 — Multi-runtime, subscriptions, custom models (1-2 weeks)

- [x] Discover the user's installed binaries (`~/.claude/local/claude`,
      `which claude`; `which codex`) with fallback to bundled.
      `execution/runtime-discovery.ts`, resolved once at startup.
- [x] Wire `pathToClaudeCodeExecutable` and `codexPathOverride` (threaded through
      `ExecutorFnOptions`). Auto-detected and on by default; opt out with
      `AGENT_SERVER_USE_INSTALLED_CLAUDE/CODEX=false`, override path with
      `AGENT_SERVER_CLAUDE_PATH/CODEX_PATH`. Verified with a real run through the
      installed Claude binary. TODO(macOS): a "Use my installed Claude/Codex"
      toggle in Settings that writes those flags (server side is done).
- [x] Provider/model abstraction. Achieved via three agent fields: `executor`
      (claude-code | codex) picks the runtime, `model` pins the model, and the
      executor-agnostic `provider` block points at a custom Anthropic-/OpenAI-
      compatible endpoint. Claude=subscription and Codex=ChatGPT by default; a
      provider block switches either to a custom endpoint. Keys stay `${VAR}` in
      `.env`. The only remaining piece is the macOS Model dropdown that writes
      these fields (server plumbing done).
- [x] Custom models (Codex path — Kimi K2): agent `provider` block
      (`base_url` + `${VAR}` `api_key`) maps to `CodexOptions.baseUrl`/`apiKey`.
      Moonshot's OpenAI-compatible endpoint + `model: kimi-k2` works directly.
      Schema `ProviderConfigSchema`; resolved via `resolveEnvString`; sample at
      `sample-agents/kimi-summarizer.yaml`. TDD (schema + wiring tests).
- [x] Custom models (Claude path): the same `provider` block drives the Claude
      runtime via `buildProviderEnv()` -> SDK `Options.env`
      (`ANTHROPIC_BASE_URL` + resolved `ANTHROPIC_API_KEY`) for that run only.
      The SDK's per-session env sidesteps the global API-key-strip conflict
      cleanly — no `process.env` mutation, so concurrent subscription agents are
      unaffected. TDD (2 tests). The `provider` block is now executor-agnostic.
- [x] UI: a simple per-agent Model dropdown ("Claude (your plan)", "Codex (your
      ChatGPT)", "Kimi K2", "Custom…"). `macos-app/.../Views/ModelField.swift`
      (ModelDraft + ModelField, mirroring ScheduleField); wired into the gear
      editor's new Model section. Custom reveals endpoint/model/key-variable
      fields; the key stays a `${VAR}` ref in `.env`. Server: `executor` +
      `provider` added to `AgentPatchSchema` + writer field list. Verified via
      the real PUT /agents/:id route: selecting Kimi persists
      executor/model/provider to disk (key ref intact); switching back to Claude
      removes them. macOS build succeeds.
- [x] "Use my installed Claude / Codex" toggles in Settings (General card),
      default on, writing `AGENT_SERVER_USE_INSTALLED_CLAUDE/CODEX` to `.env`
      (key removed when on to keep `.env` clean, explicit `false` when off).
      Note that runtime changes take effect after the next server restart.
- [x] Verify: tool permissions enforced regardless of provider. FIXED via
      DECIDED mapping (map toggles -> Codex sandbox). `execution/codex-safety.ts`
      derives Codex's `sandboxMode` from whether the agent may write/run
      (read-only when it may do neither, workspace-write otherwise; explicit
      `codex_sandbox` and `plan` mode still win) and `networkAccessEnabled` from
      an explicit web-tool grant. Preserves prior Codex defaults (unrestricted ->
      workspace-write, network off) while making the UI toggles gate a Codex
      agent. MCP capabilities already carried over. TDD (17 tests). Note: mapping
      is coarse — Codex safety is broad tiers, not per-tool.

## Phase 2.5 — Connections and auth: API key, MCP, OAuth all first-class (1-2 weeks)

A service an agent needs may authenticate any of three ways. All are supported,
and the Connect flow adapts to whichever the service uses. Secrets and tokens
never land in agent files; agent files only hold `${VAR}` references and URLs.

- [ ] Make the auth model explicit on each connection: `auth: none | api_key |
      oauth`. Drives which Connect UI shows.
- [ ] Service catalog stays single-source on the server. Extend each
      `CAPABILITY_CATALOG` entry (served via `GET /capabilities`) with the `auth`
      model and OPTIONAL OAuth hints (scopes, discovery-URL override) for the rare
      service that needs them. The app consumes this list; it does NOT keep a
      second catalog.
- [ ] Generic, discovery-driven OAuth engine in the app (not per-service config):
      given a service's MCP URL, follow the MCP OAuth discovery chain
      (`WWW-Authenticate` -> `.well-known/oauth-protected-resource` -> auth-server
      metadata -> dynamic client registration -> auth-code + PKCE). Same engine
      handles every `oauth` service.
- [ ] Connections screen in the app: list catalog services with Connect /
      Disconnect / reconnect and live status, backed by the catalog + Keychain.
- [ ] API key: the existing flow. One or more keyed fields, saved to `.env`.
      Already works; formalize and keep.
- [ ] Generic MCP: a UI to ADD a bring-your-own MCP server (stdio command, or
      http/sse URL, with optional API-key header), not just hand-edit. Custom
      connections already surface for display; add the create path.
- [ ] OAuth, interactive: a "Connect with browser" action in the macOS app
      (ASWebAuthenticationSession) that runs dynamic client registration + auth
      code + PKCE against the service's advertised endpoints, and captures the
      access + refresh tokens.
- [ ] OAuth is authenticated inside the macOS app and the tokens are stored in
      the app's Keychain. DECIDED: the app owns the whole flow (runtime-independent),
      not a reuse of Claude Code's cache. One-time in-app sign-in; access + refresh
      tokens saved to Keychain; the app refreshes them.
- [ ] Token delivery to the server (open implementation detail): the Node server
      is spawned by the app and needs the CURRENT bearer at run time, but tokens
      refresh mid-life so a static spawn-time env var is not enough. Options to
      settle in this phase: (a) the app injects/re-injects tokens on refresh via a
      local control channel, or (b) a tiny app-hosted local token broker the MCP
      request path reads a fresh bearer from. Agent files keep only URLs, never tokens.
- [ ] Keychain is the store for OAuth tokens; `.env` stays for static API keys.
- [ ] Re-auth UX: when a token expires and can't refresh, surface a "reconnect"
      prompt (the `needs-auth` signal already exists end-to-end).

## Phase 3 — Grandma-grade simplicity and safety (1-2 weeks)

- [ ] Template library: `init --template` plus in-UI "Start from a template"
      (daily summary, inbox triage, PR reviewer, calendar brief). Real future-work
      item.
- [ ] First-launch onboarding: connect Claude/Codex, create the first agent from
      a template, in under two minutes.
- [ ] Plain-language capability summary on the agent page ("This agent can read
      your files and check your calendar. It cannot run commands or send email.").
- [ ] First-run confirmation and/or dry-run preview: show what an agent will do
      before it acts. This is what makes it safe to hand to a non-technical person.
- [ ] Approval mode for sensitive actions using the existing human-in-the-loop
      interaction system.
- [~] Audit every consumer screen against "simple + confident". DONE so far:
      redesigned the home (MainPane) — one warm "Up next" signature instead of a
      2x2 grid of empty ops cards — and the sidebar rows (two calm lines, plain-
      language schedule, no raw cron, no 3-line description wall). All color from
      theme tokens so it holds across themes. Agent detail + Edit sheet reviewed
      and already clean (Model dropdown reads well). REMAINING: soften the blue
      monospace instructions editor; tokenize any hardcoded styles; give the
      New Agent + Settings screens a polish pass if the user wants.

## Phase 4 — Trust, polish, ship (ongoing)

- [x] Local metrics: per-agent success/failure, duration, token/cost, last run.
      `reporting/metrics.ts` `computeAgentMetrics()` aggregates from the durable
      SQLite store; served at `GET /metrics` (filter `?agent_id`). TDD, 5 tests.
      (macOS surfacing of the metrics still TODO.)
- [ ] Reliability hardening: crash recovery, lock hygiene, sleep/wake catch-up
      (exists), timeout coverage (exists).
- [ ] Signed + notarized release, Sparkle auto-update (integrated), docs and a
      short "make your first agent" guide.
- [ ] Consider: cross-platform later (server is Node; app is macOS-only).

---

## Future work (post-plan)

- [ ] Bidirectional messaging apps: first-class WhatsApp + Telegram support that
      both sends to and receives from the user. Fold the deferred in-run
      `decision` local-resolution work into this channel layer (a paused run's
      question flows out and the reply flows back through the same bidirectional
      transport). Do not build a one-off local decision transport before this.

## Decisions (resolved)

1. Run persistence: **SQLite**, via Node's built-in `node:sqlite` (no native
   dependency to bundle/sign into the macOS app). DONE.
2. Agent Panel: **keep it optional** — a config-gated dashboard a power user can
   point the server at; standalone runs need zero cloud. Do not delete the wiring.
3. Telegram/console channels: keep as-is for now; a unified multi-app messaging
   layer (WhatsApp + Telegram, bidirectional) is future work (see above).
4. Custom-model priority: Kimi K2 first. (Path — Codex vs Claude — to confirm at
   Phase 2.)

## Risks and unknowns to check early

- Subscription terms for automated/scheduled use, and whether background runs hit
  different rate limits than interactive use. Verify before we lean on it hard.
- Headless OAuth for hosted MCP servers (e.g. Linear): a background agent can't do
  an interactive browser sign-in. Solved in Phase 2.5 via a one-time in-app sign-in
  plus cached/refreshed tokens (reuse Claude Code's cache or our Keychain store).
- Custom-provider parity: Kimi and other models may not support every Claude Code
  tool-use feature identically. Test tool-calling and permissions per provider.
- Bundling vs user install: version skew between the user's CLI and our expected
  stream format. Pin a minimum and detect.
```
# Hidden screenshot demo mode

- [x] Add behavior tests for local persistence, menu copy, and deterministic fake agents and runs.
- [x] Add a context menu to the General settings heading that enables or disables demo mode.
- [x] Present fake agents and run history without writing agent files or replacing the live server snapshot.
- [x] Verify the Swift package and unsigned macOS app build without UI automation.

Review:

- Demo Mode is a UserDefaults-backed, local presentation choice revealed only by right-clicking the General heading.
- Six fixed fake agents and eight fixed fake runs cover active, successful, and failed states without credentials or absolute user paths.
- The monitor keeps polling its live snapshot while demo fixtures are shown, then restores that snapshot when Demo Mode is disabled.
- Agent writes, run actions, connection key writes, and security requests are suppressed for demo fixtures.
- Verification: 235 Swift behavior tests passed and the unsigned macOS Debug build succeeded. No UI automation was run.

## Creation and security timeout reliability

- [x] Keep a valid model proposal when all of its required questions were already answered.
- [x] Bound semantic security analysis so deterministic findings still return when the model stalls.
- [x] Give security analysis routes enough client time to complete their bounded work.
- [x] Bump local API compatibility so the app replaces an older server process.
- [x] Add regression tests first and run full verification.

### Creation and security timeout review

- Answered model questions are removed from the proposal while the rest of the validated model output is retained.
- Semantic security review has a four-second deadline. A timeout returns deterministic findings with a timed-out model status instead of failing the whole security check.
- macOS security analysis and scan requests allow 15 seconds; review writes keep the ordinary five-second limit.
- Local API version 4 forces the app to replace older server processes that do not have these reliability contracts.
- Verification: 1,147 server tests, 235 Swift tests, TypeScript type-check and build, and the unsigned macOS build passed. UI automation was not run.

## Security progress meaning correction

- [x] Remove the superfluous local-check explanation.
- [x] Show each analyzed agent's actual risk instead of a generic green completion check.
- [x] Keep progress, error, and accessibility states accurate without relying on color alone.
- [x] Add behavior tests first and build.

### Security progress meaning review

- A finished row now stores and displays Low risk, Needs review, High risk, or Critical from that agent's actual analysis.
- Green is reserved for Low risk. Needs review uses a warning symbol and label; High risk and Critical use destructive symbols and labels.
- “Each agent is checked separately on this Mac” was removed. The current row now says only which agent is being analyzed.
- Verification: 236 Swift behavior tests and the unsigned macOS build passed. UI automation was not run.

## Security progressive panels

- [x] Keep the security agent list visible as the first panel when an agent is selected.
- [x] Open the selected agent's analysis in a panel to the right and compact the list to the left.
- [x] Add an All agents back action and make Escape step back before closing the drawer.
- [x] Preserve direct agent-security entry points inside the same panel structure.
- [x] Add navigation behavior tests first, build, commit, and simplify.

Review:

- Selecting an agent now keeps the dashboard as a compact left panel and opens the analysis on the right.
- The selected row remains visibly selected. All agents and Escape return to the dashboard before the drawer closes.
- Direct security entry points start with both panels visible, and Reduced Motion removes the panel transition.
- Verification: 239 Swift behavior tests and the unsigned macOS build passed. UI automation was not run.

## Existing agent permission editing

- [x] Reproduce removing file-edit permission from an agent that uses the authoritative permissions policy.
- [x] Add failing server behavior tests before changing production code.
- [x] Make consumer capability toggles update the authoritative policy while preserving unrelated grants.
- [x] Keep comments, unknown fields, and reversible capability behavior intact.
- [x] Run server tests, type-check, build the macOS app, commit, simplify, and launch without UI automation.

Review:

- Existing-agent capability switches now update the detailed permissions policy enforced by the runtime, while continuing to maintain legacy tool fields for compatibility.
- Disabling file editing adds explicit Write and Edit denials without removing unrelated local or connected-service grants. Re-enabling removes only those denials.
- Connected services use a server-scoped denial, so one service can be disabled without changing the permissions of another connection.
- Local API version 5 forces the macOS app to replace a running server that still has the old permission behavior.
- Verification: 1,151 server tests, 239 Swift tests, TypeScript type-check and build, and the unsigned macOS build passed. UI automation was not run.

## Lossless existing-agent permission edits

- [x] Add failing tests that require unrelated frontmatter bytes and Markdown bodies to remain unchanged.
- [x] Remove disabled local tools from permissions.allow and add them only to permissions.deny.
- [x] Avoid writing redundant disallowed_tools entries when permissions is authoritative.
- [x] Patch only changed frontmatter fields without reformatting unrelated YAML.
- [x] Verify include-based source generation does not overwrite frontmatter changes.
- [x] Repair the six affected agent diffs to their intended minimal permission changes without altering prose.
- [x] Run full verification, commit consequential batches, simplify, and launch without UI automation.

Review:

- Existing permission edits now use one shared byte-splice editor for direct agent updates and structured security or debugger patches.
- The six affected source agents contain only the intended allow-to-deny moves. Their prompts and unrelated frontmatter are unchanged.
- `build-agents.py` replaces explicit Markdown include regions only, so these frontmatter permissions remain authoritative after generation.
- Verification: 1,153 server tests, 242 Swift tests, TypeScript type-check and build, and the unsigned macOS build passed. UI automation was not run.

## Security panel status layout

- [x] Add presentation tests for header action order, in-place scan progress, and a persistent agent list.
- [x] Move Export and Scan All to icon buttons immediately before Close.
- [x] Remove the explanatory subtitle from the drawer.
- [x] Replace only Overall status with scan progress and keep the agent list visible.
- [x] Left-align agent counts with their risk labels and add space below Overall status.
- [x] Verify, commit, simplify, and launch without UI automation.

Review:

- Export and rescan are compact native icon buttons immediately before Close, with help text, accessibility labels, and a live rescan spinner.
- Overall status alone changes to one-agent-at-a-time progress. The agent list stays visible and completed rows keep their actual risk symbol, color, and text.
- Risk counts align to the leading edge of their labels, and the status card has clear separation from the agent list.
- The obsolete whole-drawer scan view was removed.
- Verification: 242 Swift behavior tests and the unsigned macOS build passed. UI automation was not run.
## Optional file access in agent creation

- [x] Add a failing behavior test that treats no local file access as an explicit choice.
- [x] Allow Continue with no selected files while preserving required validation for other questions.
- [x] Verify the Swift behavior suite and rebuild the local app for testing.
- [x] Commit the focused repair and run a simplification pass.

### Review

Selecting no files now counts as an explicit least-privilege answer to the file-access question. Other required answers still reject empty values. The focused test failed before the change and passes afterward; all 373 Swift behavior tests and the local Debug app build pass.
## Creation wizard navigation and deferred connections

- [x] Add failing Swift tests for Back and Set up later.
- [x] Add a failing server test that preserves deferred services without repeating questions.
- [x] Add Back before Cancel and Continue while keeping Cancel adjacent to Continue.
- [x] Preserve completed question steps so Back moves from files to connections before the description.
- [x] Add a quiet Set up later action inside the connections step.
- [x] Preserve deferred services as Needs setup in the proposal.
- [x] Run focused tests, full Swift and server tests, type-check, and the macOS build.
- [ ] Commit the batch and run a simplification pass.

### Review

The footer reads Back, Cancel, Continue from left to right, with Back separated slightly and hidden on the first step. Completed question steps are retained, so Back from files restores Connections with Set up later still selected, and the next Back restores the description. The connection screen uses one quiet Set up later action rather than adding another permanent footer control. Deferred services survive as required Needs setup items, so the server does not repeat the same question and the proposal still makes the missing setup visible. Verification: 376 Swift behavior tests, 1,257 server tests, strict TypeScript checking, server compilation, and the local Debug macOS build pass.

## Version 3.1.2 release

- [x] Run the release script with version 3.1.2 and release text “Bug fixes”.
- [x] Verify signing, notarization, Sparkle signature, uploaded DMG, and live appcast.
- [x] Confirm version and build metadata changed only as expected.
- [x] Commit release metadata and push main.

### Review

Agent Server 3.1.2 build 30 passed 1,257 server tests and 376 Swift behavior tests, strict TypeScript checking, ESLint, and the signed Release archive build. Apple accepted both the app bundle and DMG, and both notarization tickets were stapled and validated. The versioned DMG, latest alias, and appcast were uploaded successfully. The live appcast reports Version 3.1.2 with the release text “Bug fixes”.
## Normalize Settings drawer geometry

- [x] Audit every Settings card and control against Mail Notifier.
- [x] Add failing presentation tests for row rhythm, dividers, and button sizing.
- [x] Replace mixed native and custom layouts with shared Settings primitives.
- [x] Verify the complete Swift suite and unsigned macOS build.
- [x] Inspect the rebuilt Settings window and commit the focused correction.

### Review

The Settings drawer now uses the same card, row, divider, and control geometry throughout. Storage, update, restart, telemetry, and environment actions share compact Settings button primitives with visible keyboard focus. The header has the reference subtitle and boundary, Advanced is a card-aligned disclosure, and the content background separates cards from the drawer surface. The Apple design and clean-and-refactor passes also split reusable buttons into a focused file. Verification passed with 472 Swift tests, 1,332 server tests with 4 skipped, strict TypeScript checking, ESLint, the server build, and the unsigned Debug macOS build. The rebuilt drawer was inspected from the running local app.
## Version 3.3.0 release

- [x] Run the release script with version 3.3.0 and release text “Bug fixes”.
- [x] Verify signing, notarization, Sparkle signature, uploaded DMG, and live appcast.
- [x] Confirm version and build metadata changed only as expected.
- [x] Commit release metadata and push main.

### Review

Agent Server 3.3.0 build 33 passed 1,332 server tests with 4 skipped, 472 Swift behavior tests, strict TypeScript checking, ESLint, and the signed universal Release archive build. Apple accepted the app submission `4aab5ff3-95d1-4a6b-8fc9-461bbeb17971` and DMG submission `0f81493c-6228-42d0-ac5b-e8dae5ff353b`. Both notarization tickets were stapled and validated. The Sparkle-signed DMG and appcast were published, and the live feed reports Version 3.3.0 with the release text “Bug fixes”.
## Restore Claude runs after an app update

- [x] Reproduce the 3.3.0 exit-code regression from the installed app runtime.
- [x] Add failing behavior tests for Claude installed in `~/.local/bin` after a clean app relaunch.
- [x] Restore user-local command discovery without changing agent Markdown or connection configuration.
- [x] Run focused tests, the complete server and Swift suites, type-checking, lint, and both local builds.
- [x] Install and launch the fixed local app, then prove a Claude-backed run passes runtime startup and appears in Run history.

### Review

The 3.3.0 app relaunched with a sanitized PATH that omitted `~/.local/bin`, so it stopped finding the authenticated Claude installation and every default Claude-backed agent fell into a bundled runtime that exited before turn one. Runtime discovery now probes the native installer path directly, the app adds the user-local bin directory to its child PATH, and vendored runtimes retain their required entitlements when signed. The locally installed app now logs the authenticated Claude runtime. A Portuguese and French run reached five turns and two Notion query calls, appeared in durable Run history, and did not reproduce code 1. It made no writes because both July 21 lesson pages already exist from the earlier run; the output contract therefore reported that no new required output was created. Verification passed with 1,333 server tests and 4 expected skips, 473 Swift tests, 49 release-contract tests, strict TypeScript checking, ESLint, the server build, and the signed Debug macOS build.
## Limit MCP alerts to the running agent

- [x] Reproduce the unrelated Claude account MCP authentication sound.
- [x] Add failing behavior coverage for agent-scoped MCP relevance.
- [x] Notify only for MCP servers explicitly configured or allowed by the running agent.
- [x] Run focused and complete tests, rebuild, and relaunch the local app.
- [x] Verify Personal Notion remains connected and unrelated Figma authentication produces no alert.

### Review

The Portuguese and French run completed successfully in 3 minutes 17 seconds with Personal Notion connected and both lesson pages created. The information chime came from the ambient Figma Claude plugin needing authentication, even though the agent could not use Figma. MCP authentication events are now filtered through the running agent's authoritative permissions, including broad deny rules and legacy unrestricted-agent behavior. The installed local app returns no alert for connected Personal Notion plus unrelated Figma needs-auth metadata. Verification passed with 1,338 server tests and 4 expected skips, 473 Swift tests, 49 release-contract tests, strict TypeScript checking, ESLint, the server build, the signed Debug macOS build, matching installed server hashes, and a successful local relaunch.

## Skip completed daily reruns

- [x] Add failing behavior tests for an explicit same-day completion policy.
- [x] Enforce the policy from durable run history in the agent timezone before model execution.
- [x] Enable the policy in the canonical Daily Focus Markdown file.
- [x] Run focused and complete server tests, type-checking, lint, and builds.
- [x] Install the local Debug app and prove Daily Focus records an immediate skipped run.
- [x] Commit the focused correction without publishing it.

### Review

Daily Focus now opts into a server-enforced same-day rerun policy. Before model execution, the lifecycle checks durable completed history using the agent's configured timezone. A matching completion produces a visible skipped run with code `already_completed_today` and reason `Already completed today.` Safe tests, contextual runs, and explicit retries still execute. Invalid timezone text cannot strand a run in the running state. Verification passed with 1,343 server tests and 4 expected skips, strict TypeScript checking, ESLint, the server build, 473 Swift tests, 49 release checks, and a fresh signed Debug app build. The installed app reproduced the real Run now behavior with zero model turns, zero tools, and zero new execution log lines.

## Version 3.3.1 release

- [x] Run the release script with version 3.3.1 and release text “Bug fixes”.
- [x] Verify signing, notarization, Sparkle signature, uploaded DMG, and live appcast.
- [x] Confirm the installed app can update and start the bundled server.
- [x] Remove stale Agent Server debug builds from Spotlight-visible locations.
- [x] Commit release metadata and push main.

### Review

Agent Server 3.3.1 build 34 passed 1,343 server tests with 4 expected skips, 473 Swift behavior tests, strict TypeScript checking, and ESLint. Apple accepted app submission `0935eb65-5f11-4218-befd-07de2c2ea15b` and DMG submission `f41ed84e-111e-4d79-af08-6fb9b05d63f7`; both tickets were stapled and validated. The Sparkle-signed DMG and appcast are live with the release text “Bug fixes”. The notarized Release app is installed locally, reports version 3.3.1 build 34, starts API version 12, and finds installed Claude, Codex, and Kimi runtimes. Twenty-four duplicate export, archive, DerivedData, and staging directories totaling about 15 GB were permanently removed; Spotlight now returns only `/Applications/Agent Server.app`.

## Version 3.3.2 slim runtime release

- [x] Add failing packaging and runtime-availability behavior tests.
- [x] Remove Claude and Codex platform executables from the app bundle while retaining their JavaScript SDK adapters.
- [x] Require installed Claude and Codex executables with clear setup errors when either runtime is missing.
- [x] Build locally and prove Claude, Codex, and Kimi resolve from the installed app environment.
- [x] Run server, Swift, release-contract, type-check, lint, and build gates.
- [x] Cut version 3.3.2 build 35 with release text “Bug fixes” and verify signing, notarization, publication, and bundle size.
- [x] Install the notarized release, clean temporary build products, commit, and push main.

### Assumptions and risks

- The product requires users to install and authenticate at least one supported coding-agent runtime.
- SDK adapter packages remain bundled because Agent Server imports their JavaScript APIs, but their optional platform executable packages do not.
- Missing runtimes must fail before execution with actionable guidance instead of falling through to an absent bundled executable.

### Review

Agent Server 3.3.2 build 35 retains the Claude and Codex JavaScript SDK adapters but removes their optional platform executable packages. The notarized Release app is 95 MB and its DMG is 18 MB, down from 619 MB and 193 MB in 3.3.1. Missing Claude or Codex installations now fail before SDK execution with direct setup guidance, and obsolete Settings choices for bundled fallbacks are gone.

Verification passed with 1,348 server tests and 4 expected skips, 473 Swift tests, 49 release-contract tests, strict TypeScript checking, ESLint, the server build, and fresh Debug and Release app builds. Apple accepted app submission `6a570139-ae2d-43ba-8012-99aa938a769d` and DMG submission `f5b8d71a-07d4-42fe-b8ad-da9f3db2c541`; both tickets were stapled and validated. The live appcast reports version 3.3.2 build 35 with “Bug fixes”. The notarized app is installed, healthy on API version 12, and resolves Claude, Codex, and Kimi from their installed paths. Temporary archives, exports, build products, and the recoverable installation backup were removed. Spotlight returns only `/Applications/Agent Server.app`.
# Slack posting failure

- [x] Inspect Slack configuration, active process, logs, and notification call path.
- [x] Reproduce the failure from the live runtime state and completion logs.
- [x] Confirm the intended recovery path does not require a code change.
- [x] Record the root cause and verification results.

Constraints:

- Do not expose Slack tokens or other secret values in logs or output.
- Preserve successful agent execution and unrelated channel behavior.

Review:

- The running bundled server loaded both Slack credentials and established its Socket Mode connection.
- `~/.agent-server/slack.json` is absent, so the server has no DM destination for scheduled notifications.
- Successful Daily Portuguese and French and Daily Focus runs were followed immediately by `Slack: no channel configured. DM the bot first to pair it.`
- Sending the bot one direct message updates the channel in memory and persists `slack.json`; a restart is not required.
- No production files changed, so code tests, lint, type-check, and build were not applicable.

# Guided Slack pairing

- [x] Define consumer pairing states and write failing server behavior tests.
- [x] Add authenticated local APIs for pairing status and destination updates.
- [x] Update the live Slack channel when a destination is saved, without a restart.
- [x] Write failing macOS presentation and client tests.
- [x] Add a guided “Open Slack” pairing sheet with automatic readiness polling.
- [x] Add an advanced channel-ID fallback and explicit test-message action.
- [x] Run focused tests, lint, type-check, server build, Swift tests, and the macOS app build.
- [x] Record the design and verification results.

Constraints:

- Keep Slack tokens and destination IDs out of consumer status responses and logs.
- Make the server the sole owner of `slack.json`.
- Preserve Telegram and account-level Slack MCP behavior.
- Do not require a server restart after pairing.

Review:

- Connections now shows Slack setup, pairing, error, and ready states from the running server instead of inferring readiness from token presence.
- The guided sheet opens the bot conversation in Slack, waits for the first direct message, offers a DM-ID migration fallback, and sends an explicit test message.
- The server writes `slack.json` atomically with owner-only permissions and updates the live destination without exposing it through the local API.
- Socket Mode failures remain visible as connection errors, and users can return to credential editing from the pairing sheet.
- Verification passed for the focused Slack server tests, server lint, strict TypeScript checks, server build, all 545 Swift tests, and an unsigned Debug app build.

# Lifecycle reliability hardening

- [x] Audit current shutdown, restart, channel, and startup reconciliation behavior.
- [x] Give active runs a natural-completion grace period before shutdown cancellation.
- [x] Keep channels and reporters alive until terminal run bookkeeping completes.
- [x] Align the macOS termination deadline with the daemon drain budget.
- [x] Coalesce restart requests and defer them while runs are active.
- [x] Verify restart completion using a new `started_at` and the required API version.
- [x] Present Running, Restart pending, Restarting, Failed, and Offline states in the macOS app.
- [x] Expose truthful Slack and Telegram lifecycle states without duplicating provider retry logic.
- [x] Isolate optional channel failures from API, scheduler, and other channel startup.
- [x] Reconcile stale locks before schedules and external triggers begin.
- [x] Use stable machine ownership for cross-process panel cleanup.
- [x] Run focused deterministic tests, static checks, Swift tests, app build, and bounded composition tests.
- [x] Record final behavior, verification, and remaining operational limits.

Constraints:

- Never expose credentials, destination IDs, or raw provider errors through status APIs or telemetry.
- Preserve terminal run records and lock release before process exit.
- Do not add retry loops where Slack or Telegram already provide provider-aware recovery.
- Keep optional messaging failures from preventing local agent execution.
- Use injected clocks and pure state transitions for lifecycle tests.

Review:

- Restart requests now wait for active work, coalesce repeated requests, and prove that a compatible replacement process has a new `started_at` before reporting success.
- Shutdown gives admitted runs time to finish, preserves channels through terminal reporting, applies one stable cancellation reason after grace expires, and gives the daemon enough time before forced termination.
- Slack reports native Socket Mode transitions. Telegram reports polling state and retries only terminal 409 conflicts because grammY owns transient network recovery. One unavailable channel no longer blocks the API, scheduler, or another channel.
- Startup removes malformed and dead regular lock files before trigger admission. Panel cleanup and run telemetry use the workspace machine identity so the next process can reconcile work owned by the prior process.
- Status output contains only channel state, pairing presence, and stable error codes. It never includes tokens, destination IDs, or raw provider errors.
- Pending interaction persistence remains separate from this bounded lifecycle milestone. Pending requests still live in memory and are lost on a process restart.
- Verification passed with 171 focused channel, lock, and API tests; 27 run-lifecycle tests; three startup reconciliation and isolation composition tests; one active-run production composition test; strict TypeScript checking; ESLint; the server build; 549 Swift tests; and an unsigned Debug app build.

# Investigate false agent attention status

- [x] Trace the macOS agent-detail badge to its server readiness inputs.
- [x] Reproduce the status through the installed app's local API.
- [x] Compare reported MCP readiness with each runtime's actual configuration and access.
- [x] Identify the root cause and affected code without changing production behavior.
- [x] Record evidence and the smallest justified correction, if a code change is needed.

Constraints:

- Do not print or persist secret values.
- Treat runtime installation, runtime authentication, MCP configuration, and MCP readiness as separate facts.
- Diagnose before implementing a fix.

Review:

- Five of seven installed agents returned `health.state: needs_attention` because their Claude account Slack, Notion, or Hex checks returned `action_required`.
- The app's cached MCP snapshot still marked those servers `pending`, while Claude's own `mcp list` reported all three as connected.
- The app probe samples for ten 500 ms intervals, so it stops after about five seconds. The machine's authoritative Claude health command took about eleven seconds.
- The registry maps every status except connected, failed, and disabled to `needs_setup`. This turns the temporary `pending` state into a setup failure.
- The cache records that snapshot as discovered. Opening an agent calls `ensure()`, which never checks again while `discovered_at` is set, so the false setup failure lasts until a manual refresh or server restart.
- Inline MCP definitions are separately reported as unknown because local credential presence is not proof of provider health. Unknown checks do not cause the attention badge.
- No production code changed during this investigation.

# Fix false agent attention status

- [x] Add failing behavior coverage for pending and authentication-required account connections.
- [x] Preserve pending as a checking state through the service registry.
- [x] Keep checking connections non-blocking in agent readiness.
- [x] Run focused tests, the full server suite, type-checking, lint, and the build.
- [x] Commit and push the verified fix.

Constraints:

- Keep explicit authentication failures actionable.
- Do not claim a pending connection is ready.
- Do not weaken missing-connection checks.

Review:

- Pending Claude account connections now remain `checking` in the service registry and become non-blocking unknown checks in agent readiness.
- Explicit `needs-auth`, missing required connections, failed connections, and disabled connections remain actionable.
- The new behavior tests failed against the prior implementation and pass with the correction.
- Verification passed with 1,586 server tests and 4 expected skips, strict TypeScript checking, ESLint, and the server build.
- Swift tests could not compile because this machine's active Command Line Tools installation does not include XCTest. The same machine also lacks the Developer ID identity, notarization profile, and Sparkle signing tool required for a release.

# Prevent incompatible Codex runtime switches

- [x] Add a failing behavior test for switching an agent with unbound credential-based MCP servers to Codex.
- [x] Reject the incompatible settings save with a direct connection-migration message.
- [x] Keep compatible Codex runtime changes and existing Claude Code agents unchanged.
- [x] Run focused tests, the full server suite, type-checking, lint, and the server build.
- [x] Record the overnight diagnosis and verification results.

Constraints:

- Do not expose credential values in errors, logs, or tests.
- Do not weaken the Codex executor's credential boundary.
- Do not rewrite agent MCP configuration or claim that Claude account connectors exist in Codex.

Review:

- Nine scheduled runs failed before model execution. Personal Notion and Slack MCP entries contained inline credential references that the Codex executor requires to come from saved connection bindings.
- Daily Focus and the weekly agents also depend on Claude account Slack, Notion, Linear, Hex, Gmail, Calendar, or search tools. The installed Codex runtime has none of those connections.
- The shared agent writer now rejects both incompatible runtime switches before it changes the Markdown file. Agents with saved credential bindings and agents without runtime-specific connection requirements can still switch to Codex.
- All seven installed agents currently use the default Claude Code executor. A manual Daily Focus retry completed after the overnight failures.
- Verification passed with 32 focused writer tests, 1,589 full server tests and 4 expected skips, strict TypeScript checking, ESLint, the server build, and `git diff --check`.

# Runtime-portable agent implementation plan

Status: superseded by “Runtime-neutral agent framework implementation” below.

## Objective

Let one agent declare the external operations it needs, bind those operations to reviewed connections, and run through Claude Code, Codex, or Kimi Code without concrete runtime tool names in its task instructions. A runtime change must show compatibility before saving and must preserve the agent's access limits and required-output checks.

## Contract decisions

- Agent Markdown owns task intent, selected connection identities, approved operations, destination limits, and the selected executor.
- Saved connection profiles own transport and credential references.
- Derived capability snapshots own the operations reported by each saved connection. They contain no credential values.
- Concrete names such as `mcp__notion__API-post-page` exist only in the prepared in-memory agent passed to an executor and in executor-neutral tool-call evidence.
- Curated operation IDs such as `notion.search` and `notion.create_page` are stable product contracts. Unknown MCP tools remain runtime-specific until a reviewed mapping exists.
- Existing `tools`, `permissions`, `mcp_servers`, and `output.primary.tool` fields remain supported during migration.

Proposed portable definition:

```yaml
executor: codex
connection_bindings:
  notes: 018f47a2-9a13-7d61-bf4f-f9a5d8f67c21
requirements:
  operations:
    - connection: notes
      operation: notion.search
    - connection: notes
      operation: notion.create_page
output:
  primary:
    description: One daily report in the approved database
    operation: notion.create_page
    connection: notes
    required: true
    target_match:
      field: data_source_id
      equals: 8dd5004b-775f-8339-b38f-87b1e08ebe79
```

## Milestone 1: Portable operation schema

- [ ] Add `AgentRequirementsSchema` with unique `{ connection, operation }` entries.
- [ ] Add curated semantic operation IDs to connection capability classification while retaining each MCP runtime operation name.
- [ ] Allow required outputs to reference either the legacy concrete `tool` or a portable `{ connection, operation }` pair.
- [ ] Reject missing bindings, duplicate requirements, unknown fields, and portable outputs absent from the approved requirements.
- [ ] Keep parsing and execution behavior unchanged for legacy agents.

Primary files:

- `server-app/src/agents/config.ts`
- `server-app/src/connections/capability-snapshot.ts`
- New `server-app/src/connections/operation-catalog.ts`
- `server-app/src/execution/output-contract.ts`

Tests first:

- Schema acceptance and rejection tests.
- Curated Notion operation mapping tests.
- Legacy agent compatibility tests.
- Portable output range and destination tests.

## Milestone 2: Connection operation inventory

- [ ] Extend saved-connection checks to start the MCP transport and request `tools/list` within a bounded timeout.
- [ ] Classify reported tools through the curated operation catalog.
- [ ] Store derived snapshots atomically in an owner-only cache keyed by connection ID and capability version.
- [ ] Refresh the snapshot after connection creation, credential changes, explicit checks, and transport changes.
- [ ] Mark missing, stale, failed, and unknown operation inventories separately.
- [ ] Keep credential names and values out of snapshots, API responses, logs, and telemetry.

Primary files:

- `server-app/src/connections/connection-executor.ts`
- `server-app/src/connections/capability-snapshot.ts`
- New `server-app/src/connections/capability-store.ts`
- `server-app/src/server/api.ts`
- `macos-app/AgentServer/Views/SavedConnectionViews.swift`

Tests first:

- Stdio, HTTP, and SSE `tools/list` behavior.
- Timeout, malformed response, missing credential, and transport failure behavior.
- Atomic cache writes and stale snapshot invalidation.
- Secret-redaction tests for every returned error shape.

## Milestone 3: Execution preparation

- [ ] Add one shared preparation function used by scheduled, manual, chained, conversational, retry, and CLI runs.
- [ ] Resolve every connection binding from the current saved profile registry.
- [ ] Resolve every portable operation against the current capability snapshot.
- [ ] Produce concrete MCP tool names and executor configuration in memory.
- [ ] Route credential-bearing stdio connections through a bundled connection launcher that receives a profile ID, reads only that profile's reviewed credential references, and adds values only to the final MCP child environment.
- [ ] Keep credential values out of Claude, Codex, and Kimi command arguments and top-level runtime environments.
- [ ] Generate the exact allow rules required by the approved operations and retain explicit denials.
- [ ] Convert a portable required-output operation into the concrete tool names accepted by output validation.
- [ ] Return a stable compatibility error before model execution when a binding or operation is unavailable.
- [ ] Record the resolved operation ID beside each tool-call trace without exposing arguments or credentials.

Primary files:

- New `server-app/src/execution/prepare-agent.ts`
- `server-app/src/connections/connection-executor.ts`
- `server-app/src/execution/executor.ts`
- `server-app/src/execution/output-contract.ts`
- `server-app/src/plugins/claude-code.ts`
- `server-app/src/plugins/codex.ts`
- `server-app/src/plugins/kimi-code.ts`

Tests first:

- The same portable agent prepares correctly for all three executors.
- The same output contract passes from all three executor event formats.
- Missing, stale, unknown, and denied operations fail before the model starts.
- A runtime receives no unapproved MCP server or operation.
- The connection launcher refuses unknown profile IDs, undeclared credential references, and changed transport identities.
- Process argument and environment capture proves that only the final MCP child receives its declared credential values.
- File, command, network, credential, and approval policies remain independently enforced.

## Milestone 4: Runtime compatibility API and macOS flow

- [ ] Add `GET /agents/:id/runtime-compatibility?executor=<name>`.
- [ ] Return `compatible`, `needs_replacement`, or `blocked` with each required operation and its current connection evidence.
- [ ] Return eligible saved connection replacements for each missing operation.
- [ ] Require a user choice when several accounts or connections qualify.
- [ ] Save executor, replacement bindings, and portable requirements in one atomic agent patch.
- [ ] Check compatibility in guided creation before showing connection choices.
- [ ] Replace the current save-time error with an inline compatibility review beside the runtime picker.
- [ ] Keep the current agent file unchanged when the review is canceled or a replacement fails.

Primary files:

- `server-app/src/server/api.ts`
- New `server-app/src/agents/runtime-compatibility.ts`
- `server-app/src/agents/writer.ts`
- `macos-app/AgentServerSwiftTests/Sources/AgentServerCore/AgentSettingsDraft.swift`
- `macos-app/AgentServer/Views/AgentSettingsForm.swift`
- New macOS compatibility presentation and review views.

Tests first:

- Compatibility response tests for portable, Claude-account-only, missing, ambiguous, and stale connections.
- Atomic save and stale-write rejection tests.
- macOS draft, presentation, cancellation, keyboard, and accessibility tests.
- Creation and editing must use the same compatibility rules.

## Milestone 5: Existing-agent migration

- [ ] Add a read-only migration analyzer for legacy tools, permission rules, output contracts, bindings, and prompt references.
- [ ] Map only exact curated tool identities to portable operations.
- [ ] Produce a lossless patch preview protected by the current file hash.
- [ ] Require saved shared connections before replacing Claude account connections.
- [ ] Present every account choice and every changed permission or output rule.
- [ ] Keep unsupported tools as named blockers and leave the source file unchanged.
- [ ] Rewrite runtime-specific prompt instructions only through an explicit reviewed text diff.
- [ ] Migrate Personal Notion agents first, then Slack and Linear agents, then Calendar, search, Hex, and other services with verified shared connections.

Primary files:

- New `server-app/src/agents/portable-migration.ts`
- `server-app/src/analysis/patch.ts`
- `server-app/src/agents/lossless-yaml-editor.ts`
- `server-app/src/connections/adoption.ts`
- New macOS migration review views.

Tests first:

- Byte preservation outside changed nodes.
- Exact mapping, ambiguity refusal, unsupported-operation refusal, and stale-hash behavior.
- Prompt text remains unchanged until its diff is approved.
- Existing schedules, destinations, denials, and notification rules survive migration.

## Milestone 6: Verification and rollout

- [ ] Run focused tests after every failing behavior test and implementation increment.
- [ ] Run `pnpm test`, `pnpm run type-check`, `pnpm run lint`, and `pnpm run build` from `server-app/`.
- [ ] Run all Swift behavior tests and build the macOS app without launching UI tests during active user work.
- [ ] Run bounded live checks with one read-only connection and one write connection on Claude Code and Codex.
- [ ] Prove that both runtimes create the required output at the approved destination.
- [ ] Prove that switching back preserves the same requirements and bindings.
- [ ] Ship the schema and preparation path before enabling migration actions.
- [ ] Keep legacy execution available for one release cycle and report legacy status in agent readiness.
- [ ] Remove the temporary Codex switch guard only after the compatibility review covers every agent-editing path.

## Acceptance criteria

- A newly created portable agent can run through Claude Code and Codex with one executor-field change and no prompt edit.
- The runtime picker reports missing operations before it writes the agent file.
- Shared saved connections retain the same identity, credential references, and access limits across runtimes.
- Required-output validation succeeds from each executor's tool-call events.
- Runtime-specific account connections are identified clearly and require a reviewed replacement.
- Unknown MCP operations never receive a portable classification automatically.
- Existing legacy agents continue to run unchanged until migrated.
- No credential value appears in agent Markdown, child-process arguments, snapshots, API responses, logs, telemetry, or run history.

## Explicit exclusions

- Claude account OAuth connectors remain Claude-only.
- Arbitrary unknown tools retain runtime-specific identities.
- Personal, Work, and other accounts always require a user choice.
- Task instruction changes always require a reviewed diff.

# Runtime-neutral agent framework implementation

Status: active goal. This section replaces the earlier proposal where the two differ.

## Product contract

The framework separates five records:

1. **Agent definition in Markdown**: identity, schedule, task instructions, named connection uses, purpose, approved operations, resource limits, output, notifications, and generic file or network access.
2. **Local connection bindings**: a server-owned file maps each logical agent connection slot to a saved connection profile on this machine.
3. **Saved connection profile**: stable UUID, local account name, portable service type, adapter identity, transport, and credential references. Observed capabilities and reviewed operation mappings are separate records.
4. **Runtime assignment**: executor, model, custom provider, and other runtime selection details. This lives in a server-owned file beside `connections.json`.
5. **Prepared run**: a temporary in-memory agent containing concrete MCP server names, tool names, and executor options. This record is discarded after the run.

Changing Claude Code to Codex or Kimi changes only the runtime assignment. The Markdown agent definition remains byte-for-byte unchanged.

## Agent YAML

Target frontmatter:

```yaml
id: daily-focus
name: Daily Focus List
schedule: "0 7 * * 2-5"
timezone: Europe/Lisbon

connections:
  work_notes:
    type: notion
    name: Notion Work
    purpose: Read work notes and publish the daily focus page
    operations:
      - notion.search
      - notion.page.read
      - notion.page.create
    resources:
      report_database:
        type: notion.data_source
        purpose: Destination for the daily focus page
        access: write

  work_messages:
    type: slack
    name: Slack Work
    purpose: Find messages that directly involve Prashant
    operations:
      - slack.messages.search
      - slack.thread.read
    resources:
      company_workspace:
        type: slack.workspace
        purpose: Workspace to search for relevant activity
        access: read

output:
  primary:
    description: One daily focus page in Notion Work
    use: work_notes
    operation: notion.page.create
    required: true
    successful_calls:
      min: 1
      max: 1
    target: report_database
```

Rules:

- `name` is the human connection name shown in prompts and the app.
- Each mapping key, such as `work_notes`, is a stable logical slot inside this shareable agent package.
- `type` identifies the portable service contract and the semantic operation namespace.
- `purpose` is added to the run context so the model knows why the connection is present.
- `operations` contains semantic operations. The local tool maps them to concrete capabilities.
- Each resource mapping key is another portable slot. Actual workspace, database, folder, calendar, and account IDs stay in local bindings.
- New agent files contain no local profile UUID, executor, model, provider, `codex_sandbox`, `permission_mode`, concrete `mcp__...` tools, inline credential transport, or executor-specific account connection.

The shareable file says what `Notion Work` means for this task. Each orchestration tool decides how that slot is fulfilled locally.

## Local connection bindings

New server-owned file: `~/.agent-server/agent-bindings.json`.

```json
{
  "schema_version": 1,
  "agents": {
    "daily-focus": {
      "revision": 1,
      "connections": {
        "work_notes": {
          "connection_id": "018f47a2-9a13-7d61-bf4f-f9a5d8f67c21",
          "resources": {
            "report_database": {
              "id": "8dd5004b-775f-8339-b38f-87b1e08ebe79"
            }
          }
        },
        "work_messages": {
          "connection_id": "028f47a2-9a13-7d61-bf4f-f9a5d8f67c22",
          "resources": {
            "company_workspace": {
              "id": "T_WORKSPACE"
            }
          }
        }
      }
    }
  }
}
```

Rules:

- Slot keys come from the shareable agent definition.
- Connection UUIDs remain local to one Agent Server workspace.
- Provider resource IDs remain local to one Agent Server workspace.
- Importing an agent creates unresolved slots and starts local connection selection.
- Copying or publishing an agent excludes `agent-bindings.json` and `runtime-assignments.json`.
- Another orchestration tool may fulfill the slots through MCP, native APIs, hosted connectors, or another enforceable mechanism.

## Runtime assignment

New server-owned file: `~/.agent-server/runtime-assignments.json`.

```json
{
  "schema_version": 1,
  "assignments": {
    "daily-focus": {
      "executor": "codex",
      "revision": 1,
      "updated_at": "2026-08-06T08:00:00.000Z"
    }
  }
}
```

Rules:

- Agent Server writes this file atomically with owner-only permissions.
- Runtime assignment precedence is saved assignment, then legacy frontmatter during migration, then `claude-code` as the compatibility default.
- Runtime changes use a dedicated API and never patch agent Markdown.
- The app shows the effective assignment and its source.
- After migration, legacy runtime fields are removed through a reviewed lossless patch.

## Connection operation contract

Each connection adapter provides a versioned map:

```text
semantic operation    concrete MCP tool               effect
search                API-post-search                 read
read_page             API-retrieve-page-markdown      read
create_page           API-post-page                   create
```

Rules:

- `tools/list` confirms which concrete tools the current connection provides.
- Curated maps assign stable semantic operations only for reviewed adapter and transport identities.
- A user may give an unknown concrete tool a semantic name only through an explicit version-pinned review.
- A connection is portable when its transport can be prepared for the selected runtime and every approved semantic operation is present.
- Human labels never determine provider identity, tool mapping, credentials, or access.

## Prepared run compiler

For every run:

1. Load the agent definition.
2. Load its runtime assignment.
3. Resolve each logical slot key through the local agent binding store.
4. Resolve the resulting local connection ID to the current saved profile.
5. Load or refresh the connection's operation inventory.
6. Resolve each semantic operation to one concrete MCP tool.
7. Compile exact server and tool allow lists for the selected executor.
8. Resolve local resource slots and compile argument checks for each allowed operation.
9. Compile the portable output contract into concrete tool evidence checks.
10. Add a short connection-purpose block to the prompt.
11. Start the selected executor only after preparation succeeds.

The compiler output is immutable and exists only for that run.

## Credential handling

- Agent Markdown stores no credential names or values.
- Connection profiles store credential references and transport configuration.
- The server resolves credential values immediately before starting the final MCP process.
- Codex receives `enabled_tools` and `disabled_tools` for each MCP server.
- Credential-bearing stdio connections use an Agent Server launcher so credential values appear only in the final MCP child environment.
- HTTP bearer and header credentials use a local Agent Server MCP relay until every selected runtime has a verified secret-reference mechanism that keeps values out of model-visible commands and inherited shell environments.
- The relay accepts only a run-scoped connection grant and the approved operation set.

## Runtime compatibility states

- `compatible`: every connection, operation, resource rule, and output contract can be enforced.
- `needs_connection`: an equivalent saved connection must be selected.
- `needs_review`: the connection label, transport, operation inventory, or capability version changed.
- `blocked`: the runtime cannot enforce one or more required operations or resource rules.

The runtime picker shows these states before saving. It never changes an assignment while the result is `needs_connection`, `needs_review`, or `blocked`.

## Implementation sequence

### Phase 1: Separate runtime assignment

- [x] Add runtime assignment schemas and an atomic owner-only store.
- [x] Add effective runtime resolution with legacy fallback.
- [x] Add dedicated read and update APIs.
- [x] Make every server run path use effective runtime resolution.
- [x] Update macOS decoding, editing, runtime compatibility, and local persistence calls.
- [x] Prove that changing runtime leaves agent Markdown unchanged.

### Phase 2: Add named connection uses

- [x] Add the `connections` schema with stable logical key, human name, purpose, operations, and resource grants.
- [x] Add lossless writer support and redacted API presentation.
- [x] Add an atomic owner-only local agent-binding store.
- [x] Add unresolved, missing, stale, and compatible slot-binding checks.
- [x] Keep legacy `connection_bindings`, `mcp_servers`, tools, and permissions operational.
- [x] Update editing UI to select a saved connection and choose resources for each declared use.
- [x] Update guided creation to author named connection uses directly and save its runtime separately.

### Phase 3: Build operation inventories

- [x] Capture concrete operation names and input fields in capability snapshots.
- [x] Implement bounded MCP initialize, paginated `tools/list`, duplicate rejection, and inventory limits.
- [x] Store observed snapshots in an owner-only cache.
- [x] Add a trusted Notion REST map with exact adapter and transport identity checks.
- [ ] Add curated maps or complete explicit reviews for Slack, Linear, EventKit, and other connections needed by the installed agents.
- [x] Store reviewed semantic mappings separately and make changed inventories stale.

### Phase 4: Compile prepared runs

- [x] Add the shared prepared-run compiler.
- [x] Compile connection transports and exact tool allow lists for Claude Code, Codex, and Kimi Code.
- [x] Compile connection purpose into runtime context.
- [x] Compile resource argument enforcement for mapped target arguments.
- [x] Route all three runtimes through a policy-enforcing local MCP relay for portable connections.
- [x] Normalize concrete tool calls back to logical use, semantic operation, and resource evidence.

### Phase 5: Make output portable

- [x] Add portable output `{ use, operation, target }` schema where `use` is the logical slot key.
- [x] Compile it into concrete tool evidence checks for each run.
- [x] Preserve successful-call ranges and exact resource targets.
- [x] Keep legacy concrete output contracts operational.

### Phase 6: Add compatibility review

- [x] Add runtime compatibility and replacement APIs.
- [x] Add the macOS runtime review with exact missing operations and eligible connections.
- [x] Save runtime assignments independently from agent edits.
- [x] Enforce compatibility during runtime changes, binding changes, and every prepared run.
- [x] Use named connection uses directly during guided creation.
- [ ] Use named connection uses during the reviewed installed-agent migration.

### Phase 7: Migrate installed agents

- [x] Stop before changing live agent files or committing and present a per-agent migration report for user review.
- [x] For each agent, list removed runtime and MCP fields, added connection uses and operations, required local bindings, resource IDs, and runtime-specific prompt text that must change.
- [x] Allow hash-protected reviewed patches to add portable connections and output contracts while preserving untouched file bytes and rollback support.

- [ ] Import existing executor, model, and provider choices into runtime assignments.
- [ ] Create or select shared saved connections for every required service.
- [ ] Convert concrete tools and permissions into named connection uses.
- [ ] Convert output contracts into portable connection operations.
- [ ] Show reviewed lossless patches before removing legacy fields.
- [ ] Keep unsupported Claude account connections on Claude until a shared replacement exists.
- [ ] Run each migrated agent through its current runtime before testing another runtime.

### Phase 8: Verify and release

- [x] Run all focused behavior tests after each TDD increment.
- [x] Run the complete server suite, type-check, lint, and build.
- [x] Run focused Swift behavior tests and build the macOS app during implementation.
- [x] Re-run the complete Swift suite and macOS app build after final documentation and contract changes.
- [ ] Run live read and write checks through Claude Code and Codex.
- [ ] Prove exact output creation, resource enforcement, credential isolation, cancellation, timeout, and run-history behavior.
- [ ] Install the verified local build and run the migrated scheduled agents.
- [ ] Keep legacy compatibility for one release cycle before removing deprecated fields.

## Completion criteria

- Changing an agent from Claude Code to Codex changes only `runtime-assignments.json`.
- The agent Markdown names logical connection slots and their purpose without local profile IDs, executor fields, or concrete MCP vocabulary.
- Copying one agent Markdown file to another machine creates unresolved local slots and never copies accounts or credentials.
- Both runtimes receive the same approved semantic operations and resource limits.
- Both runtimes produce normalized evidence that satisfies the same output contract.
- A runtime switch is refused before execution when any rule cannot be enforced.
- Existing agent definitions and run history survive migration.
- Credential values remain absent from agent files, runtime arguments, runtime-wide environments, logs, telemetry, and run history.

## Current implementation review

### Codex cutover on Prashant's Mac

- [x] Confirm Gmail, Google Calendar, Linear, Notion, and Slack are accessible through the local Codex login.
- [x] Compile named connection uses into selected Codex apps and exact runtime tool names.
- [x] Disable every unapproved tool found in each checked Codex app inventory.
- [x] Create machine-local Codex connection profiles, capability snapshots, operation mappings, bindings, and runtime assignments.
- [x] Remove unused Claude account profiles after proving no agent binding references them.
- [x] Verify all six enabled agents are compatible with Codex.
- [x] Add the newly authorized CustomerIO Codex app, review its complete tool inventory, and bind its five read operations to Proactive Work.
- [x] Prove Codex can read Slack, Linear, and Notion through Agent Server.
- [x] Prove Codex can create a page in the approved Notion data source and satisfy Agent Server's required-output check.
- [x] Keep the shared agent Markdown free of executor names, app IDs, account IDs, and concrete tool names.
- [ ] Show the user the exact per-agent impact before committing.
- [ ] Commit only after user approval.

- The server suite passes: 1,675 tests passed and 4 expected tests skipped across
  132 files.
- Strict TypeScript checking, ESLint, and the production server build pass.
- The Swift package passes 571 tests with zero failures.
- Xcode project generation and the unsigned macOS Debug app build pass with
  Xcode 26.6.0. The build reports only the existing AppIntents metadata warning.
- The installed-agent audit found seven definitions. No installed definition,
  local connection profile, runtime assignment, or portable binding has been
  changed.
- The exact proposed changes and current local setup gaps are documented in
  `tasks/runtime-neutral-agent-migration-report.md` for user approval before
  migration or commit.
- Capability identity now changes with the complete saved transport, adapter,
  runtime name, or credential references. The reviewed Notion map requires the
  exact `@notionhq/notion-mcp-server@2.5.1` package.
- Preparation enforces nested provider target fields, resource access by
  operation effect, provider availability, provider credential presence, and
  unambiguous portable output evidence before execution.
- This Mac now assigns every installed agent to Codex. All seven agents are
  compatible. Proactive Work still has `enabled: false` in its shared definition.
- Codex runs use only the selected app IDs. Each checked app inventory is
  compiled into explicit enabled and disabled tool settings for the run.
- A live Agent Server verification created one page through
  `notion.notion-create-pages`; its exact destination and successful tool call
  satisfied the required output contract.
- A restricted live Codex run called only
  `customerio.cio_auth_status`, confirming that the new CustomerIO account is
  available to unattended Agent Server runs.
- Guided creation writes local runtime and connection selections outside the
  agent file. Resource IDs remain unresolved until the user selects them.

## Agent Server 3.5.0 release

- [x] Verify the current implementation diff, release contract, signing identity, Sparkle key, notarization profile, Doppler access, and live 3.4.6 appcast.
- [x] Reproduce and fix the agent-detail HTTP 500 caused by saved Codex account profiles.
- [x] Restart the local server and verify the affected presentation and services endpoints return HTTP 200.
- [x] Run the complete release script for version 3.5.0 with the note `Better support for Codex`.
- [x] Verify the signed and notarized DMG, published appcast, latest-download alias, and update-feed redirect.
- [x] Record the published build number and local artifacts.
- [ ] Leave source changes uncommitted until the required per-agent review and explicit commit approval.

### Release-blocking fix review

- A saved `runtime_account` profile now stays an account connection in the service registry.
- The registry binds that profile to its runtime server name without resolving it as an injected MCP transport.
- The regression test fails with the original exception before the fix and passes after it.
- The focused server test, strict type check, lint, build, and live authenticated endpoint checks pass.
- Version 3.5.0 is build 45. Apple accepted app submission `3ca84d9e-2545-4943-9293-f3b5691889fe` and DMG submission `8b8797ec-cb45-4a40-bcc6-f84c323ef390`.
- The published immutable DMG and latest-download alias match the local SHA-256 `0949473292035ed2d37728ffedbf225a3a68188bbc5dae01a3b2879ab460ba0b`.
- The live appcast contains version 3.5.0, build 45, the requested release note, byte length 19887612, and a Sparkle signature.
- Gatekeeper accepts the DMG as Notarized Developer ID, and the stapled ticket validates.

## 2026-08-07 overnight agent recovery

- [x] Inspect the scheduled manuscript, language lesson, and focus runs.
- [x] Reproduce unattended Codex MCP approval refusal and scoped macOS command failures.
- [x] Add failing behavior tests for false completion, failed tool calls, and failure artifacts.
- [x] Pre-approve reviewed MCP tools for unattended Codex runs.
- [x] Give scoped Codex commands read access to required macOS system resources.
- [x] Replace the manuscript conversion and hash commands with built-in macOS tools.
- [x] Support separate local read and create IDs for one logical connection resource.
- [x] Split Notion page bodies larger than 100 blocks inside the connection relay.
- [x] Recover the completed manuscript analysis into Notion and update the stored hash.
- [x] Update all three Personal Notion write bindings on this Mac.
- [x] Run focused tests, type checking, lint, server build, and the unsigned macOS app build.
- [x] Restart the installed server and verify all seven agent definitions load through the authenticated API.
- [x] Run an unchanged-manuscript check and confirm that it creates no duplicate page.

### Review

- The recovered manuscript review is page `3b5a555c-5905-81fe-b1ff-c444e2c58813` with all 130 blocks present.
- The live server started at `2026-08-07T06:32:04.216Z` and returns HTTP 200 for the agent list and manuscript detail.
- The complete server suite passes: 1,694 tests passed and 4 expected tests skipped across 133 files. Strict TypeScript checking, ESLint, the production server build, and the unsigned macOS Debug app build pass.
- Swift Package Manager used the active Command Line Tools path and could not find XCTest. The same Swift sources compile in the Xcode project with `DEVELOPER_DIR` set to Xcode 26.6.0.
- Slack still reports `account_inactive`. This did not stop the Daily Focus List itself, but its Slack notification cannot succeed until that Slack account or token is replaced.
- Source changes remain uncommitted pending the required per-agent review and user approval.

## Portable reusable skills

- [x] Add semantic skill requirements to shareable agent definitions.
- [x] Store the selected skill implementation in machine-local agent bindings.
- [x] Validate and prepare skill instructions before choosing Codex, Claude Code, or Kimi.
- [x] Bind Daily Manuscript Review to the maintained fiction diagnostic skill.
- [x] Prove the same prepared skill instructions reach Codex and Claude Code.
- [x] Run focused tests, the complete server suite, type checking, lint, and builds.
- [x] Document the exact per-agent change before committing.

### Review

- Shareable agent files now name a skill and its purpose. Each machine stores the selected `SKILL.md` path in its local agent bindings.
- Agent Server validates and adds the selected skill instructions before it selects Codex, Claude Code, or Kimi. Missing or invalid skill files stop the run with a setup error.
- Daily Manuscript Review now requires `Fiction manuscript diagnostic` through the logical `editorial_diagnostic` slot. This Mac binds it to `/Users/prashant/Developer/brain/skills/fiction-diagnostic`.
- The executor tests prove Codex and Claude Code receive the same prepared skill instructions. Claude Code 2.1.224 is installed and authenticated on this Mac.
- The complete server suite passes: 1,703 tests passed and 4 expected tests skipped across 134 files. All 574 Swift tests pass. Strict TypeScript checking, ESLint, the server build, and the unsigned macOS Debug app build pass.
- Only Daily Manuscript Review changed its shareable definition. The other agents require no edits until they choose to declare a reusable skill.
- Source changes remain uncommitted pending user approval.

## Agent Server 3.5.1 release

- [x] Confirm the requested patch version and exact release-note text.
- [x] Validate the runtime-neutral agent and local-skill implementation.
- [ ] Commit the verified source changes.
- [ ] Run the complete signed and notarized 3.5.1 release process.
- [ ] Verify the published DMG, appcast, and Sparkle update metadata.
- [ ] Commit generated release metadata and push `main`.
- [ ] Validate, commit, and push the seven agents and three fiction skills in the brain repository.
