# Model schemas and prompts

## Boundary rule

Model output is untrusted. Agent Server supplies a strict JSON schema for each task, validates the response, applies deterministic consistency rules, and falls back safely when validation fails. A model never writes an agent file or grants a permission.

Source files:

- `server-app/src/analysis/models.ts`
- `server-app/src/creation/proposal-schema.ts`
- `server-app/src/creation/proposal-prompt.ts`
- `server-app/src/diagnostics/diagnostic-types.ts`
- `server-app/src/diagnostics/diagnostic-prompt.ts`
- `server-app/src/diagnostics/repair-schema.ts`
- `server-app/src/analysis/patch.ts`

## Agent proposal schema

An agent proposal contains:

- Schema version
- Name and plain-language description
- Complete instructions and Markdown preview
- Trigger type, machine schedule, and human schedule
- Time zone
- Required capabilities and connections with readiness states
- File paths with read-only or read-write access
- Permission booleans for files, commands, network, connected apps, and messages
- Notification destination
- Optional runtime recommendation with reason
- Risk summary
- Missing information
- Concrete questions and control types

Additional validation rejects invalid schedules and time zones, write permission without a narrow writable path, scheduled triggers without a schedule, watched triggers without a path, message permission without a destination, and understated risk.

### Proposal prompt contract

The proposal prompt instructs the model to:

- Return only schema-compatible JSON
- Use consumer language
- Ask only blocking questions
- Choose the least access needed
- Never invent credentials or file paths
- Never add file changes, commands, or network access silently
- Prefer read-only access, manual triggers, the default runtime, and existing connections
- Explain risky recommendations
- Include success criteria, output expectations, missing-data handling, secret protection, and task safeguards

The request includes the redacted user description, local time zone, connected service names, and confirmed answers. It excludes credentials and unrelated agent or run data.

## Diagnostic result schema

A diagnostic result contains:

- Run ID
- Summary and most likely cause
- Confidence from 0 through 1
- Bounded structured evidence
- Recommended action
- Affected settings
- Risk level
- Whether automation is permitted
- Rerun safety
- Alternative explanations
- Recommended next step
- Deterministic, heuristic, model, or combined source

High-risk model results are rejected when they claim the fix can be automated, omit confirmation, or claim a rerun is safe.

### Diagnostic prompt contract

The diagnostic prompt instructs the model to:

- Use only supplied evidence
- Never invent logs, calls, settings, or certainty
- Separate the likely cause from alternatives
- Recommend the narrowest fix
- Explain safety impact
- Never recommend unrestricted files, arbitrary commands, or credential transmission
- Mark permission-broadening fixes as manual

The diagnostic package includes bounded recent progress, tool names, redacted file and command evidence, selected configuration fields, and readiness states. It excludes agent instructions and tool payloads.

## Semantic security finding schema

Semantic findings use the shared `Finding` schema:

- Stable finding and rule IDs
- Risk level
- Plain-language title and explanation
- Potential impact
- Trigger condition
- One to ten evidence items
- Recommended action and functional impact
- Ignore policy
- Model-generated marker
- Confidence

Model findings can add warnings for meaning that fixed rules cannot reliably classify. They cannot lower a deterministic finding or set the overall result below the highest finding.

## Repair proposal schema

A repair proposal contains a summary, one or more typed operations, a risk level, and whether the run should be retried. Supported operations cover schedules, working folders, runtime, model, Codex sandbox, approval behavior, network, tools, detailed permissions, and notification choice.

The repair guard rejects or requires review for unrestricted files, bypassed permission checks, broad home paths, commands, write tools, wildcard tools, connected-service grants, network enablement, and high-risk model output.

## Configuration patch schema

A configuration patch contains:

- Schema version
- Agent ID
- Expected SHA-256 content hash
- Source: creation, debugger, security analyzer, or user
- Plain-language reason
- Typed field changes
- Confirmation tied to the reviewed preview when required

The patch schema supports name, description, instructions, schedule, enabled state, working directory, actions, denials, detailed permissions, connected services, model, provider, sandbox, network, notifications, interactions, watched paths, and chaining.

Policy and full-document parsing remain deterministic. Literal credentials, unrestricted access, arbitrary command grants, destructive instructions, stale hashes, and agent identity changes are rejected.

## Retry and fallback behavior

The local structured model helper accepts an output schema and an abort signal. Calls are bounded and stale requests are cancelled. A malformed response receives at most one careful retry when the underlying model adapter does not already retry. Creation returns concrete fallback questions. Diagnostics return a low-confidence manual review result. Security analysis retains deterministic findings and marks the model status unavailable, invalid, or timed out.

## Secret handling

Inputs pass through structured redaction before model use. Evidence strings are redacted again during schema parsing. The model receives no literal connection keys, provider keys, authorization headers, or unrelated personal data. Tests use generated fake values and assert that full values never appear in prompts, results, logs, or fixtures.
