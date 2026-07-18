# Consumer agent tools architecture

## Goals

The architecture adds guided product experiences without replacing Agent Server's agent format, local server, run history, connection catalog, or executor system. Consumer language belongs in presentation models. Technical configuration remains the source of truth.

## Component map

```text
macOS guided views
    |
    v
local authenticated API
    |
    +-- proposal service --> strict proposal schema --> agent configuration
    +-- diagnostic service --> local checks --> optional structured model
    +-- security service --> deterministic rules --> review database
    +-- patch service --> preview --> confirmed apply --> bounded rollback
    |
    v
existing agent files, connections, runs, executors, and schedules
```

## macOS application

The macOS app keeps the existing SwiftUI navigation and drawer patterns. New screens use current cards, badges, colors, spacing, controls, error presentation, and accessibility conventions.

State machines in `AgentServerCore` keep network and business state separate from SwiftUI. They cover proposal questions, proposal review, debugger progress, fix review, security findings, loading, and errors. This permits deterministic Swift tests without launching the app.

The app uses native schedule controls and macOS file selection. Critical controls have accessibility identifiers, descriptive labels, and text or symbols in addition to color.

## Local API and authentication

The macOS app communicates with the Hono server over loopback. Requests use the local API key created during initialization. The health route remains available for local readiness checks while protected routes require authentication.

Analysis routes are mounted into the existing API rather than hosted in a separate process:

- `GET /security/agents/:id` analyzes one agent.
- `POST /security/scan` analyzes all agents.
- `POST /security/agents/:id/review` stores an acknowledgement for the current content hash.
- `POST /configuration-patches/preview` validates and previews a patch.
- `POST /configuration-patches/apply` applies an approved patch.
- `POST /configuration-patches/rollback` restores a bounded backup when the file has not changed again.

Proposal and diagnostic services use the same dependency injection patterns as the existing server. The macOS client does not parse or write agent YAML itself.

## Shared models

The analysis layer defines strict Zod schemas for:

- Risk severity and summary
- Evidence
- Findings
- Recommended actions
- Agent proposals
- Diagnostic results
- Security analysis
- Preflight results
- Configuration patches
- Repair proposals

The API validates every model result before returning or applying it. A model response is evidence for a proposal, diagnosis, or semantic finding. It never writes configuration directly.

## Agent creation data flow

1. The user enters a plain-language request and local time zone.
2. The proposal service sends the request, answers, and connected service names to the local structured model.
3. The model returns JSON matching the creation proposal schema.
4. The service rejects contradictions, invalid schedules, unsafe permission summaries, and malformed output.
5. If required information is missing, the UI presents the schema's concrete questions.
6. The approved proposal is converted into an `AgentConfig` with explicit permissions and narrow defaults.
7. Security Analyzer checks the generated document before save.
8. The normal agent repository writes the compatible Markdown file.
9. A safe test uses the existing run store, live status, cancellation, and run detail navigation.

The dedicated proposal prompt forbids invented credentials, silent write or command access, broad paths, and unexplained network access.

## Diagnostic data flow

1. The debugger receives the agent, stored run, and readiness state.
2. Deterministic rules inspect the parsed configuration and bounded run evidence.
3. Known local causes return immediately with consumer text and an action.
4. An unexplained failure may use a redacted structured model request.
5. The diagnostic result is schema-validated and checked against high-risk automation policy.
6. A repair proposal becomes a structured patch preview.
7. Security Analyzer evaluates the proposed result before apply.
8. The retry creates a new run and retains the failed run.

## Security analysis data flow

Deterministic rules inspect the parsed agent and raw source. Path checks normalize `~`, relative paths, and home roots before comparison. Secret rules report only a redacted count and category. Permission checks use the same effective permission policy as the executors.

The service merges findings, calculates the highest risk, and stores the analysis against:

- Agent ID
- SHA-256 content hash
- Analyzer version
- Analysis and review times
- Acknowledged finding IDs

The record becomes stale when the file hash or analyzer version changes. SQLite stores review state outside the agent document with owner-only file permissions.

Optional semantic analysis may classify meaning that fixed rules cannot establish, such as instructions to follow commands found in an untrusted document. Semantic results cannot lower deterministic severity or declare the agent safe.

## Patch system

Patches describe named fields, a source, reason, expected content hash, and optional confirmation. The patch service performs five checks:

1. Validate the patch schema.
2. Confirm the agent has not changed since preview.
3. Reject forbidden permission or instruction changes.
4. Render and parse the complete result.
5. Replace the file only if its current hash still matches.

High-risk previews require confirmation tied to the preview result hash. Rollback tokens refer to bounded in-memory backups and only work while the applied file still has the expected hash.

## Model use

Codex is the primary structured model integration for proposals, unexplained diagnostics, and semantic prompt findings. It runs with a strict output schema, a bounded prompt, and restricted tools. GPT-5.6 may be selected through a compatible configured runtime when available. GPT-5.6 is optional and core checks do not depend on it.

Deterministic logic remains responsible for parsing, schedule validation, path normalization, secret detection, permission evaluation, risk floors, patch policy, content hashes, review staleness, and final schema validation.

## Cleanup prerequisites

The cleanup audit was treated as architecture work, not a separate cosmetic pass. Prerequisites included:

- Stable run identity across API, storage, reporting, cancellation, and live events
- Always-on local API authentication
- Restricted child-process environments
- Safer executor permission defaults
- Redaction for stored evidence and logs
- Reliable WebSocket reconnection and single-flight polling
- Wrong-agent draft protection in settings
- Shared permission and environment policies instead of duplicate logic

These changes reduce the chance that a new consumer flow applies a change to stale state or leaks configuration details while reporting an error.

## Performance and cancellation

Deterministic analysis is cached by content hash and analyzer version. The UI debounces changes and cancels stale model requests. Large diagnostic values are redacted and truncated before model use. File scans inspect agent definitions rather than walking user folders.

## Logging

Production logs record operation type, agent or run identifiers, status, and redacted errors. Credentials, full prompts, file contents, and raw model evidence are excluded. macOS logging should use OSLog privacy annotations for values that may identify local files or services.
