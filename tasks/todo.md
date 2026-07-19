# Build Week plan: Guided creation, debugging, and security

Status: Native service integration and final release verification are complete.

## Connection account model correction

- [x] Restore `~/.agent-server/.env` as the single environment file used by the app and server.
- [ ] Replace key-centric connection language with a named, repeatable account model.
- [ ] Define legacy key adoption and exact connection identity rules for multiple Notion and Linear accounts.
- [ ] Run affected server and Swift tests, build both targets, commit, and simplify.

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
