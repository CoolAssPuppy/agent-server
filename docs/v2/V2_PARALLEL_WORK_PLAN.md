# V2 parallel work plan

## Purpose

This plan lets Codex and Claude work at the same time without editing the same repository or independently changing a shared protocol.

No coding begins until the user approves the Phase 0 documents and the baseline and contract gates pass.

## Permanent ownership

| Agent | Repository ownership | Responsibilities |
|---|---|---|
| Codex | `agent-server/**` only | Local machine identity, local protocol client, telemetry adapter, target filtering and command claim client, decision normalization, local presentation adapters, macOS Today and Activity, Server tests and docs links |
| Claude | `agent-panel/**` only | Additive migrations, generated or canonical Panel schemas, registration and pairing endpoints, API-key scope enforcement, targeted command server logic, Panel presentation adapters, web Today and Activity, iOS repair and later UI, Panel tests |

Neither agent edits the other repository. Codex owns the canonical documents in `agent-server/docs/v2/`. Claude may edit only the short Panel cross-link unless the user assigns documentation ownership differently.

## Shared contract ownership

The user approves [V2 interface contracts](V2_INTERFACE_CONTRACTS.md). After approval:

- Claude implements the Panel side without changing field meaning.
- Codex implements the Server side against frozen fixtures.
- Any contract change becomes a proposed document diff first.
- The other agent reviews the proposal before either implementation changes.
- One named integration owner updates canonical fixtures. Default owner: Codex.

## Worktree and branch rules

- Each agent uses a separate branch and, when operating on the same machine, a separate git worktree.
- Branches use `codex/` and `claude/` prefixes.
- Commits contain one logical change and do not include generated build output.
- Agents never reset, reformat, or clean files they do not own.
- Each handoff lists base commit, changed files, commands run, fixtures used, and known risks.

Repository ownership already prevents file clobbering. Worktrees prevent branch and index interference.

## Parallel sequence

### Tranche 0: Baseline repair

Work is independent and must stay separate from V2:

- Codex: diagnose and fix the Server test failures only after explicit approval.
- Claude: enable and run Panel database integration tests and confirm iOS baseline.

Merge gate: both repositories green.

### Tranche 1: Contract preparation

- Claude: write additive Panel migration and endpoint tests against frozen fixtures. No old column or route removal.
- Codex: write local machine identity tests and client serialization tests against the same fixtures. No Panel calls enabled by default.

Merge order: Panel additive schema and compatible endpoints first, then Server client behavior. Feature flag remains off.

### Tranche 2: Read-only consumer slice

- Claude: Panel web presentation adapters, Today, unified Activity, outcome-led run review, Technical details disclosure.
- Codex: Server presentation adapters, macOS Today, unified Activity, outcome-led local run review, Technical details disclosure.

Both agents use the approved information architecture and fixture names. No remote mutations are added in this tranche.

Merge gate: screenshot review of the same state matrix on web and macOS.

### Tranche 3: Assistant home and readiness

- Codex: authoritative local readiness, permission explanations, Assistant home on macOS, local actions.
- Claude: display the last reported readiness, Assistant home on web, device context, and read-only remote states.

Merge gate: Panel never calculates local readiness independently.

### Tranche 4: Pairing and targeted actions

- Claude: pairing code, machine credential, device management, atomic command targeting, web actions.
- Codex: local pairing exchange, credential storage, local policy evaluation, command result reporting, macOS setup.

Merge order: Panel server capability first. Enable actions only after end-to-end multi-machine tests.

### Tranche 5: iOS

- Claude owns iOS protocol repair and approved presentation changes.
- Codex supplies fixture review and Server compatibility evidence only.

## File collision rules

- Do not create mirrored source packages across repositories.
- Do not copy evolving TypeScript definitions into Swift by hand without fixtures and decoder tests.
- Do not edit root README files during feature commits unless the tranche includes documentation correction.
- Do not modify database migrations after they have been applied. Add a new migration.
- Do not let both agents update analytics catalogs, fixtures, or canonical planning docs in the same tranche.

## Integration checklist

Before merging each tranche:

- Base revisions are recorded.
- Contract version is unchanged or an approved change is linked.
- Both repositories pass focused and required suites.
- No secrets, prompts, file content, or unsafe telemetry fields were added.
- Compatibility with V1 is demonstrated.
- Panel outage behavior is tested.
- Screenshot review is complete for UI work.
- Files changed remain inside the assigned repository.

## Handoff format

Each agent reports:

- Objective completed
- Repository and branch
- Base and head commits
- Files changed
- Contract fixture version
- Migrations added
- Tests added and run
- Screenshots or UI state descriptions
- Compatibility risks
- Unresolved questions
- Safe next task for the other agent
