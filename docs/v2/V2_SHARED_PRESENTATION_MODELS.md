# V2 shared presentation models

## Purpose

These are presentation contracts, not replacement persistence schemas. Each client adapts its current trusted sources into these shapes. Raw models remain available under Technical details.

The contracts must be frozen before parallel UI work begins. TypeScript and Swift implementations use shared JSON fixtures because the repositories cannot import one another at build time.

## Identity

```text
MachineIdentity
  machineId: stable UUID created by Agent Server
  displayName: user-editable
  availability: online | last_seen | unpaired
  lastSeenAt: timestamp or absent

AssistantIdentity
  installationId: Panel row UUID or local composite key
  machineId: stable machine UUID
  localAgentId: exact Agent Server definition ID
  displayName: user-facing name
```

Global assistant identity is `(machineId, localAgentId)`. Display name and slug are not identity.

## Assistant health

| Consumer state | Deterministic sources |
|---|---|
| Healthy | Enabled, ready, no pending attention, no active run, device available when viewed remotely |
| Working | One active local run |
| Needs attention | Readiness blocker, pending interaction, recoverable failure, stale security review, missing connection, or permission action |
| Paused | Definition is disabled or explicitly paused |
| Offline | Panel has not heard from the machine within the approved availability window |

Priority is Working, Needs attention, Paused, Offline, Healthy for local presentation. Remote presentation may show Offline before other transient state because action is unavailable. The adapter must retain the underlying reasons.

## Today item

```text
TodayItem
  id
  section: needs_you | working | finished | problems | upcoming
  assistant: AssistantIdentity
  headline
  explanation
  occurredAt or scheduledAt
  expiresAt optional
  primaryAction
  secondaryDisclosure optional
  sourceReferences
```

Section rules:

- Needs you: a user action can change the state now.
- Working: execution is active and no user action is required.
- Finished: a successful terminal outcome in the selected recent window.
- Problems: a failed, rejected, skipped, degraded, or offline condition without a pending user request.
- Upcoming: the next deterministic schedule occurrence.

An item appears in one section only. Needs you wins over Problems. Working wins over Upcoming.

## Needs-you item

```text
NeedsYouItem
  reason: answer | choose | approve | reconnect | permission | review | retry
  request
  why
  actionLabel
  expiresAt optional
  consequenceOfExpiry optional
  localPolicyState
```

The source may be a Panel decision, local interaction, connection state, preflight result, security review, or repairable run failure. The adapter must not infer an approval request from model prose alone.

## Readiness

```text
ReadinessPresentation
  state: ready | needs_setup | blocked | checking | unavailable
  summary
  checks: ReadinessCheck[]

ReadinessCheck
  kind: engine | connection | file | destination | permission | schedule | server | mcp | safety
  state: pass | action_required | fail | unknown
  explanation
  action optional
  evidenceSource
```

Rules:

- Use deterministic checks already supported by Server.
- Unknown must remain Unknown. It cannot become Ready.
- Panel may display the last reported readiness with its timestamp but cannot calculate local readiness independently.
- A safe test is offered only when the selected executor and effect policy can enforce it.

## Human permission summary

```text
PermissionStatement
  effect: can | must_ask | cannot
  action: read | edit | execute | send | publish | delete | connect
  targetLabel
  exactScopeReference
  sourceRuleReference
```

Statements are generated from the existing effective permission and security engines. UI text is not a second policy system.

Examples:

- Can read the Books folder.
- Can edit the series bible.
- Cannot modify the Word manuscript.
- Must ask before pushing to GitHub.
- Cannot send email.

## Run review

```text
RunReview
  outcome: succeeded | partial | failed | canceled | skipped | working | waiting | unknown
  headline
  summary
  accomplishments[]
  changes[]
  outputs[]
  problems[]
  suggestions[]
  timeline[]
  operationalCompleteness
  technicalDetailsReference
```

`operationalCompleteness` represents evidence:

- Complete: required output contracts and observed terminal evidence agree.
- Incomplete: a required output or step is missing.
- Not assessed: no deterministic contract exists.

It is not model confidence.

## Human timeline

```text
HumanTimelineEntry
  kind: started | connected | read | changed | produced | waiting | resumed | problem | finished
  label
  detail optional
  occurredAt optional
  evidenceReferences[]
```

Timeline entries are derived from known events, connection identities, output contracts, file operations, and terminal state. Raw tool names remain under Technical details. Unknown tools receive a neutral “Used a configured tool” entry rather than invented consumer meaning.

`occurredAt` is omitted when stored evidence proves that a step happened but does not preserve its exact time. Presentation adapters must not substitute the run completion time for an unknown intermediate timestamp.

## Activity item

```text
ActivityItem
  id
  assistant
  conversationId optional
  state: needs_you | working | finished | problem
  headline
  outcomeSummary optional
  startedAt
  endedAt optional
  primaryOutput optional
  reviewReference
```

Conversation grouping is presentation only. It does not move execution or session state across machines.

## Pause and waiting reason

```text
WaitingPresentation
  waitingFor
  reason
  userAction optional
  expiresAt optional
  timeoutOutcome optional
```

No UI may show only Paused, Waiting, or Input required.

## Connection presentation

```text
ConnectionPresentation
  connectionId
  label
  provider
  methodCategory: account | api | mcp | native | messaging | file
  health: connected | needs_attention | checking | unavailable
  lastCheckedAt optional
  assistantCount
  primaryAction
  advancedMetadataReference optional
```

Credential values are never part of this model.

## State mappings

| Raw state | Consumer outcome |
|---|---|
| local `running`, Panel `working` | Working |
| Panel `submitted` | Upcoming or Requested, depending on source |
| Panel `input_required` | Needs you only when a valid request exists; otherwise Problem |
| local or Panel `completed` | Finished, then derive complete or partial from evidence |
| local or Panel `failed` | Problem |
| Panel `canceled`, local abort | Canceled |
| Panel `rejected` | Problem with local policy reason |
| local `skipped` | Problem or Finished with no change, based on deterministic skip code |
| trigger `queued` | Requested |
| trigger `acknowledged` | Accepted by device |
| trigger `running` | Working |
| trigger terminal | Finished or Problem |

Canceled must not map to Failed, and unknown must not map to Running.

## Privacy classes

| Class | Examples | Default |
|---|---|---|
| Operational identity | machine ID, assistant ID, run ID, timestamps, state | May sync when Panel is paired |
| Consumer outcome | reviewed summary, output label, safe link | Sync only under explicit telemetry setting |
| Sensitive local metadata | file paths, commands, tool inputs, connection labels | Local only by default |
| Content | prompts, file contents, model reasoning, user answers | Local only unless a specific consented feature requires it |
| Secrets | tokens, credential values, secret-bearing headers | Never sync |

Panel presentation must show when information is local-only or last reported.

## Adapter rules

- Adapters are pure and independently tested.
- No adapter writes files, changes permissions, or resolves interactions.
- Every generated sentence carries source references for debugging.
- Unknown values remain visible as unknown under Technical details.
- Presentation mappings never weaken local policy.
- The same fixture must produce equivalent meaning on web, macOS, and iOS.
