# V2 product plan

## Goal

Make assistants understandable, trustworthy, and easy to operate while preserving local execution and optional remote visibility.

## Release gates

1. **Plan approval:** Approve all Phase 0 documents and the first screen specifications.
2. **Baseline gate:** Restore green required tests without mixing repairs into V2 commits.
3. **Contract gate:** Approve stable machine identity, targeted commands, decision payloads, state mappings, and telemetry privacy.
4. **Design gate:** Approve Today, assistant home, and activity layouts before broad screen implementation.
5. **Action gate:** Keep the first UI slice read-only until remote actions are authenticated, targeted, atomic, and locally authorized.

## Capabilities to reuse

### Agent Server

- YAML and Markdown definitions and the existing parser
- Scheduler, watchers, locks, timeout, cancellation, and executor registry
- Claude Code, Codex, and Kimi Code adapters
- SQLite run history and local WebSocket events
- Named connection profiles and runtime connection discovery
- Guided creation and reviewed definition writing
- Deterministic security analysis and content-hash reviews
- Debugger, repair proposals, patch preview, compare-and-swap, and bounded rollback
- Existing permission evaluation and output contracts
- Safe-test entry point, after enforcement is documented per executor
- Existing macOS design components, notifications, and navigation primitives

### Agent Panel

- Supabase authentication, organization isolation, RLS, billing, and retention
- Status ingestion and cloud run persistence
- Realtime delivery, after machine scoping
- Decisions and run-trigger tables, evolved rather than replaced
- Web and iOS result, output-link, history, and notification components
- Existing theme and component systems

## Product sequence

### Phase 1: Contract repair and stable identity

- Fix the test baseline as separate, focused work.
- Create one versioned status and decision contract.
- Add stable machine registration and machine-scoped assistant identity.
- Target commands to one machine and claim them atomically.
- Enforce API-key scopes and preserve current keys during transition.
- Define telemetry field classes and defaults.
- Correct stale documentation and examples.

This phase changes no default consumer navigation.

### Phase 2: Shared presentation models

- Implement pure adapters for health, readiness, Today sections, needs-you items, run review, permissions, and human timelines.
- Keep raw schemas and stable APIs where useful.
- Add shared contract fixtures and platform-specific behavior tests.
- Add no new event store.

### Phase 3: Today and Activity

- Make Today the default on Panel web and Agent Server macOS.
- Aggregate Needs you, Working, Finished, Problems, and Upcoming from existing sources.
- Give each item one primary action.
- Replace the default run view with an outcome-led review and human timeline.
- Put logs, tool calls, tokens, costs, IDs, model, and raw payloads under Technical details.
- Keep initial Panel actions disabled or read-only until the action gate passes.

### Phase 4: Assistant home and readiness

- Add one assistant home with purpose, schedule, access, changes, connections, destinations, health, recent outcomes, and attention.
- Reuse deterministic preflight and connection checks to produce readiness facts.
- Present effective permissions in human language from the existing permission engine.
- Support Run now, Pause, Edit, and Safe test with one primary action at a time.

### Phase 5: Pairing and connections

- Add short-lived pairing codes bound to one machine registration.
- Store the resulting long-lived credential only on Agent Server.
- Keep manual API-key setup under Advanced.
- Add local connection health and a metadata-only Panel projection.
- Do not send secret values to Panel.

### Phase 6: iOS alignment

- Replace the current Home and Decisions split with Today, Assistants, Activity, and Settings.
- Prioritize observation, review, approval, answer, retry, and cancellation.
- Repair session authentication, Realtime authentication, and decision decoding before adding actions.
- Avoid deep assistant configuration on mobile.

### Phase 7: Conversations, teach mode, memory, and skills

- Start with reviewed proposals and explicit save actions.
- Keep conversations bound to one machine installation.
- Keep memory local, readable, editable, attributable, and auditable.
- Do not silently change instructions, permissions, memory, or skills.

## Screen disposition

| Current surface | V2 treatment |
|---|---|
| Panel Home | Replace with Today composition |
| Panel Decisions | Merge into Needs you; retain filtered view through Activity |
| Panel Agent detail | Replace with Assistant home; move aggregate statistics to Advanced |
| Panel Run detail | Replace primary area with Run review and human timeline; retain current tabs under Technical details |
| Panel API keys | Move under Settings > Advanced; pairing becomes default |
| Panel billing | Settings > Subscription |
| Panel theme | Settings > Advanced or Appearance |
| macOS MainPane | Evolve into Today using the same section contract |
| macOS Agents sidebar | Rename Assistants and keep it as desktop navigation |
| macOS agent drawer | Evolve into Assistant home; reduce nested technical tabs |
| macOS Connections drawer | Keep as top-level desktop destination; move transport fields under Advanced |
| macOS Security and Debugger | Keep local tools; enter from Assistant health or a problem item |
| iOS Home | Replace after shared models stabilize |
| iOS Decisions | Merge into Today and Activity filters |

No capability is deleted in the first release. Technical routes remain available through Advanced or direct links while usage is measured.

## Schema evolution

- Add stable machine records and a machine-bound credential relationship in Panel.
- Add nullable `machine_id` and `local_agent_id` to the existing assistant projection.
- Replace organization-plus-slug uniqueness with a partial uniqueness rule for registered installations while keeping legacy rows readable.
- Add machine targeting and atomic claim fields to `run_triggers` rather than creating another queue.
- Add contract version and stable machine identity to status, sync, decision, and command payloads.
- Add presentation fields only when they cannot be derived reliably from existing data.
- Do not store credentials, full definitions, or unredacted local content in new Panel columns.

## Compatibility

- Existing agent files remain unchanged.
- Existing API keys continue to ingest legacy telemetry during a bounded transition.
- Historical Panel rows remain visible as legacy, unassigned activity and cannot receive remote commands.
- `worker_id` remains process telemetry and is never promoted to machine identity.
- Old slug routes remain as compatibility routes for a release window but cannot target ambiguous multi-machine assistants.
- Panel failure never blocks local scheduling, execution, history, security, or connections.
- No automatic definition migration is planned.

## Product modes

### Agent Server only

Today, Assistants, Activity, Connections, Settings, guided creation, readiness, safe test, security, debugging, patches, local history, and notifications work locally.

### Agent Server plus Agent Panel

Panel adds remote Today, searchable history, device inventory, notifications, review, and machine-targeted requests. Agent Server may reject any request under local policy.

## Rollout flags

Use existing configuration methods and the smallest number of flags:

- Panel presentation V2 for web accounts
- macOS presentation V2
- machine protocol V2 after successful registration
- remote actions V2 after command tests pass
- iOS presentation V2 after its protocol repair

Flags must not fork data ownership or create two schedulers.

## Explicit non-goals

- Cross-machine sessions, migration, scheduling, failover, or execution
- Cloud execution fallback
- Agent definition synchronization
- Shared credentials or working directories
- A new design system, queue, permission engine, scheduler, or event store
- A public skills marketplace
- Automatic memory or instruction changes
- Broad desktop recording or uncontrolled browser automation
- Model-generated confidence scores

## First implementation slice after approval

The smallest safe slice is read-only presentation:

1. Add tested presentation adapters in each product from the frozen model document.
2. Build Today on Panel web and Agent Server macOS using existing data.
3. Build the outcome-led run review and Technical details disclosure.
4. Capture and review screenshots for empty, healthy, working, needs-you, failed, offline, and mixed states.
5. Keep remote mutations behind the existing interface until the machine protocol gate passes.

Stop after this slice for product and visual review.
