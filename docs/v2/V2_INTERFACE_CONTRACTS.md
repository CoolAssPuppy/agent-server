# V2 interface contracts

## Status

Approved for parallel implementation. It records the minimum cross-repository agreement needed by Agent Server and Agent Panel. It is not an implementation specification for unrelated features.

## Current contract defects

- No stable machine identity exists.
- Assistant sync is organization plus slug and can deactivate another machine's assistants.
- Remote triggers are visible to all organization daemons.
- Status route types, shared types, Server payloads, and iOS models disagree.
- API-key scopes are not enforced.
- Decision resolution shapes disagree.
- Telemetry includes sensitive local metadata without a field-level product policy.

## Versioning

Every V2 payload includes:

```json
{
  "protocol_version": 2,
  "machine_id": "uuid",
  "local_agent_id": "string"
}
```

Unknown major versions fail closed with a human setup message. Additive optional fields may be introduced within a major version. Field meaning cannot change within a version.

## Identity

- `machine_id`: stable UUID created and stored by one Agent Server workspace.
- `process_id`: ephemeral diagnostic string such as hostname plus PID.
- `local_agent_id`: exact ID from the local definition.
- `assistant_installation_id`: Panel database UUID for the projection.
- `run_id`: UUID shared by local execution and cloud projection.

Slugs and names are labels, not identity.

## Machine registration

Request:

```json
{
  "protocol_version": 2,
  "pairing_code": "short-lived-secret",
  "machine_id": "uuid",
  "display_name": "Office Mac",
  "server_version": "string"
}
```

Response returns a machine-bound credential once, its scopes, expiry or rotation policy, and the Panel organization reference. Panel stores only a secure hash. Agent Server stores the credential owner-only.

## Assistant sync

Each item contains protocol version, machine ID, local agent ID, display name, enabled state, plain schedule data, timezone, and a hash of the exact local definition content. Description is omitted by default and includes only the explicit description after user opt-in. Instructions are never used as a description fallback. Capability summaries remain omitted until their field allowlist is approved.

Sync reconciliation is limited to one machine ID. It cannot deactivate rows from another machine.

## Status event

Required envelope:

```json
{
  "protocol_version": 2,
  "machine_id": "uuid",
  "process_id": "string",
  "local_agent_id": "string",
  "run_id": "uuid",
  "state": "working",
  "timestamp": "ISO-8601",
  "privacy_level": "operational",
  "reason_code": "optional_stable_code"
}
```

States are `submitted`, `working`, `input_required`, `completed`, `failed`, `canceled`, and `rejected`. Local `skipped` is reported with a terminal state plus a stable reason code until the wire contract explicitly adds it.

The initial Server adapter emits operational fields only. `reason_code` is optional for ordinary events and required when local `skipped` maps to `completed`. Rich review fields remain local until their opt-in wire shape is approved.

Terminal results use the Run review evidence fields defined in the shared presentation document. Sensitive local fields are omitted unless the configured privacy level allows them.

## Command request

The existing trigger record evolves to include:

```text
commandId
targetMachineId
localAgentId
action: run | cancel | retry | pause | resume | answer | approve | test_connection
idempotencyKey
requestedAt
expiresAt
status: requested | accepted | rejected | started | completed | failed | canceled | expired
```

Only the target machine credential can claim the command. Claiming is atomic. Agent Server evaluates local policy after claim and may reject it with a stable code and human explanation.

Panel displays Requested separately from Accepted and Started.

## Decision request

Decision types remain approve, pick, and answer. Shared fields include title, body, reason, bounded options where applicable, expiry, and safe source links. The full payload is validated before the run becomes `input_required`.

Resolution is discriminated by the same type:

```json
{ "type": "approve", "approved": true }
```

```json
{ "type": "pick", "option_id": "stable-option-id" }
```

```json
{ "type": "answer", "text": "user response" }
```

System defer is separate and includes `defer_until` when applicable. Server converts the validated resolution into the executor-specific continuation. Panel and iOS never invent an executor input shape.

The initial Server normalizer fails closed on mismatched types, unknown or null pick options, blank or over-limit answers, expired defer times, legacy `action_id` payloads, and extra fields. Defer never produces executor resumption text.

## Authorization

Machine credentials are organization-bound and machine-bound. Route handlers enforce scopes, not just key validity. User-session endpoints for web and iOS use user authentication plus RLS. Machine API-key endpoints do not accept a user JWT as a substitute.

Minimum checks:

- Organization matches.
- Machine matches.
- Scope permits the operation.
- Command or decision belongs to the machine.
- Expiry has not passed.
- Idempotency or terminal state prevents replay.
- Local policy accepts execution.

## Privacy

Operational telemetry may include identifiers, timestamps, states, coarse error code, and versions. Summary text, output links, file paths, commands, tool names, progress text, reasoning, prompts, and answers require the approved field policy. Secrets are never allowed.

## Compatibility

- V1 status ingestion remains available during rollout.
- Existing keys remain valid for their current documented behavior until migration or revocation.
- V1 assistant rows remain readable and unassigned to a device.
- V1 remote triggers are rejected when target identity is ambiguous.
- Panel additive changes deploy before V2 Server traffic begins.
- No V2 field is inferred from `worker_id` or slug.

## Approved contract decisions

1. Local `skipped` reports as `completed` with a stable skip reason code during V2.
2. Operational telemetry syncs by default. Outcome text requires opt-in, sensitive fields remain local by default, and secrets never sync.
3. Panel reports a machine offline after three missed reported heartbeat intervals.
4. Resetting machine identity requires explicit unpair first.
5. V1 telemetry ingestion remains supported throughout V2 and cannot be removed before V3.
