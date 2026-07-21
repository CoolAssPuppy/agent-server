# Build Week plan: Guided creation, debugging, and security

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
- [ ] Re-run the technical debt audit, prove every finding closed or explicitly retired, and record the final review.

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
