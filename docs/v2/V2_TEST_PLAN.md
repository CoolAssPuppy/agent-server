# V2 test plan

## Current baseline

- Agent Server type check, lint, build, and 478 Swift behavior tests pass.
- Agent Server Vitest is red because the Codex file-policy test resolves a missing installed binary path. A sync debounce test also failed once and passed on focused rerun.
- Agent Panel web has 443 passing and 46 skipped tests.
- Agent Panel shared types have 68 passing tests.
- Agent Panel lint, type check, and production web build pass.
- Panel database integration tests are skipped without a configured service role.
- Panel iOS ran 46 tests: 45 passed, 1 integration test skipped, and `SupabaseServiceTests.testApiKeyDecodesFromJSON` failed because its fixture lacks required `key_prefix`.

No V2 production test may be added until the baseline failure has a separate disposition.

## Test method

- Write a failing behavior test before each production change.
- Test public routes, adapters, stores, and visible behavior rather than private helpers.
- Use complete factory data validated by the real schema.
- Keep fixtures immutable and versioned.
- Run focused tests for each change, then the required repository suite.
- Capture visual states for review. Component tests alone do not approve consumer UI.

## Cross-repository contract suite

Maintain one canonical fixture set owned by the planning and integration owner. Both repositories copy it only through a reviewed update.

Required fixtures:

- Machine registration and credential rotation
- Assistant sync from two machines with the same local agent ID
- V1 and V2 status events
- Requested, accepted, rejected, started, completed, failed, canceled, and expired commands
- Approve, pick, answer, defer, expiry, and invalid decision payloads
- Telemetry at each privacy class
- Unknown and future enum values

Each repository must prove it accepts current fixtures and rejects malformed, cross-organization, cross-machine, expired, replayed, or over-scoped requests.

## Identity and pairing tests

- Machine ID persists across restart and app update.
- A copied workspace requires explicit identity reset before pairing on another machine.
- Pairing code is short-lived, one-time, organization-bound, and machine-bound.
- Credential values are returned once, hashed in Panel, stored owner-only locally, and never logged.
- Rotation leaves one bounded overlap or uses an atomic cutover.
- Revocation stops Panel access without affecting local execution.
- Existing API keys retain documented V1 behavior.

## Multi-machine tests

- Two machines may have the same local agent ID and different definitions.
- Sync from one machine never updates or deactivates the other.
- One command reaches one target machine.
- Only the target credential can claim it.
- Duplicate delivery produces one local run.
- An offline target remains requested or expires; another machine never takes it.
- Historical rows without machine identity remain viewable and non-actionable.

## Local-first tests

- Schedules, watchers, manual runs, history, connections, security, and debugger work with no Panel configuration.
- Panel timeouts do not delay local terminal state or lock release.
- Terminal telemetry retries do not duplicate a local run.
- Panel loss during a run does not change local outcome.
- Panel reconnect uploads only allowed projections.

## Presentation mapping tests

- Every raw state maps to one documented consumer state.
- Canceled never becomes Failed.
- Unknown never becomes Working or Healthy.
- Needs you wins over Problems and contains an action reason.
- Every waiting state has `waitingFor` and `reason`.
- Readiness cannot be Ready when a required check is unknown or failed.
- Permission text traces to an effective permission rule.
- Operational completeness follows output-contract evidence.
- Human timeline labels trace to stored events and never invent an action.

## Consumer UI behavior tests

### Today

- Sections appear in the approved order and omit empty sections.
- Each card has one primary action.
- Mixed states deduplicate one run into one section.
- Device context appears only when it prevents ambiguity.
- Offline Panel state does not claim local execution stopped.

### Assistant home

- Purpose, health, readiness, schedule, access, destinations, and recent outcomes appear before Advanced.
- Run, resolve, view work, or safe test is chosen as the single primary action by state.
- Raw schedule, engine, model, and identifiers remain under Advanced.

### Run review

- Outcome and outputs appear before metrics and logs.
- A failure shows cause and next action without opening logs.
- A waiting run shows request, reason, action, and expiry.
- Technical details preserve current logs and metadata.

### Connections and devices

- Default connection setup does not require copying a secret when pairing is available.
- Connection rows show label, provider, health, last check, usage, and one action.
- Device rows use stable machine identity and show last heard from.

## Visual review matrix

For Today, Assistant home, Activity detail, Needs you, Connections, and Devices, capture:

- Empty
- One healthy item
- Working
- Needs attention
- Failed with recovery
- Waiting with expiry
- Offline device
- High-volume content
- Long names and localized schedule text
- Light and dark appearance
- Narrow web width, standard desktop, and iPhone width
- Increased text size and reduced motion

Review purpose, reading order, typography, spacing, contrast, action dominance, overflow, focus, keyboard use, and touch targets. Store approved screenshots or named references with the implementation task.

## Security tests

- Route authorization enforces credential scopes.
- RLS isolates organizations and machine-bound tokens.
- Full prompts, file content, credentials, and disallowed metadata never enter Panel fixtures.
- Command claims are atomic and idempotent.
- Local policy can reject any Panel request with a human reason.
- Safe test blocks or simulates every classified external effect for each supported executor.
- Safe-test conformance composes the ephemeral policy with the Claude Code and Kimi Code executor boundaries, including file writes, commands, web tools, MCP tools, native services, notifications, and downstream triggers.
- Codex safe-test requests fail closed until command isolation has executable proof.
- Proposal review and save receipts expose server-owned availability, and safe-test summaries cannot claim readiness.
- Unsupported safe-test configurations state that a protected test is unavailable.

## Required commands

Agent Server:

```bash
cd server-app
pnpm test
pnpm run type-check
pnpm run lint
pnpm run build
cd ../macos-app/AgentServerSwiftTests
swift test
```

Run other Swift packages and the unsigned app build when their files change. Run UI automation only in an agreed window because it takes keyboard focus.

Agent Panel:

```bash
pnpm test:web
pnpm test:types
pnpm lint
pnpm type-check
pnpm build:web
cd ios
xcodebuild -project AgentPanel.xcodeproj -scheme AgentPanel \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```

Run configured Supabase integration tests for every migration, RLS, pairing, decision, or command change.

## Release acceptance

- All required suites are green with skips explained.
- Cross-repository fixtures pass at the intended compatibility versions.
- Multi-machine commands cannot execute on the wrong machine.
- The full first-release consumer journey passes with Panel available and unavailable.
- Screenshot review is approved for web, macOS, and iOS states in scope.
- Existing definitions, schedules, connections, history, accounts, and API keys remain available.
