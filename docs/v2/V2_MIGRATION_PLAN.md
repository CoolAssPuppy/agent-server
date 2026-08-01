# V2 migration plan

## Migration rules

- Add before removing.
- Preserve old ingestion while new clients register.
- Never infer stable machine identity from `worker_id`, hostname, API key, or slug.
- Never rewrite local agent files as part of a Panel migration.
- Never attach historical activity to a machine without evidence.
- Every database change has a tested rollback or a documented forward-only reason.
- Panel schema deploys before Server sends new required fields.

## Stage 0: Baseline and contract freeze

- Repair the failing Server baseline as separate work.
- Run configured Panel database integration tests and iOS tests.
- Freeze V2 status, sync, machine registration, command, and decision fixtures.
- Approve telemetry privacy defaults.
- Correct documentation that conflicts with code.

Exit: both repositories are green and the interface contract document is approved.

## Stage 1: Stable local machine identity

Agent Server creates a random UUID once and stores it in the selected Agent Server workspace with owner-only permissions. It is independent of hostname and PID. Existing `worker_id` becomes an explicit ephemeral process identifier.

Requirements:

- Survives restart and app update.
- Changes only through an explicit reset or new workspace.
- Is never copied automatically between workspaces or machines.
- Is available to local API presentation and optional Panel registration.

## Stage 2: Additive Panel machine records

Add a machine record with organization, stable machine ID, display name, registration state, last seen time, protocol version, revoked time, and coarse health metadata.

Add nullable machine identity fields to current assistant and run projections. Keep current primary keys and foreign keys. Add a partial unique rule for registered installations using organization, machine ID, and local agent ID. Retain legacy organization-plus-slug lookup only for rows without machine identity during transition.

Historical rows remain “Legacy device unknown.” They are visible but cannot receive remote commands.

## Stage 3: Machine-bound pairing

Panel creates a short-lived, single-use pairing code. Agent Server exchanges it for a revocable machine-bound credential. The credential is stored locally. Panel stores only its hash and machine association.

Existing API keys continue to work for legacy telemetry until revoked. Manual API-key setup remains under Advanced. A user must explicitly pair each machine.

Scope enforcement is added before new credentials are issued:

- telemetry write
- assistant sync
- command read and acknowledgement for the bound machine
- decision read and resolution for the bound machine
- cleanup for the bound machine

## Stage 4: Machine-scoped assistant projection

Agent sync includes protocol version, machine ID, exact local agent ID, display metadata, definition hash, enabled state, and schedule projection. It does not include full instructions or credentials.

Sync deactivates only assistants from the same machine. It cannot modify another machine's projection.

Panel routes use the projection row UUID for navigation. Human URLs may include labels but do not use them as identity.

## Stage 5: Targeted commands

Evolve the existing `run_triggers` queue:

- Add target machine and local agent identity.
- Add expiry and idempotency key.
- Add an atomic claim operation limited to the target machine credential.
- Record requested, accepted, rejected, started, and terminal states.
- Preserve the local Server run ID as the execution record.

Legacy untargeted triggers remain readable but are not delivered when an assistant is ambiguous across machines. The UI asks the user to choose a device.

## Stage 6: Status and decisions V2

Status events add contract version, machine identity, local agent identity, process identity, and privacy level. The current endpoint continues to accept V1 for a bounded transition.

Decision request and resolution use one discriminated schema. Panel validates the complete decision before changing run state. Agent Server normalizes a resolution before resuming execution. iOS reads the same row and uses user-session authenticated routes.

## Stage 7: Presentation migration

Presentation models launch behind client flags. Existing routes and technical views stay available under Advanced. No raw data is deleted.

Suggested order:

1. Panel web Today and Activity
2. Agent Server macOS Today and Activity
3. Assistant home and readiness on both desktop products
4. Pairing and Devices
5. iOS Today, Assistants, Activity, and Settings

## Stage 8: Legacy retirement

Retirement requires measured evidence that supported Servers use V2:

- Stop creating new slug-only assistant rows.
- Disable new untargeted remote commands.
- Keep historical V1 runs readable.
- Keep existing API keys valid until the user migrates or revokes them, subject to current security policy.
- Remove compatibility routes only in a documented major release.

## Rollback

- Presentation flags can return users to existing screens without changing data.
- New nullable fields and tables remain unused if Server registration is disabled.
- V1 telemetry ingestion remains available during rollout.
- Remote command V2 can be disabled without affecting local runs.
- A paired machine credential can be revoked without deleting local data.
- Database rollback must never collapse two machine-scoped assistants back into one slug row.

## Migration risks

| Risk | Control |
|---|---|
| Two machines share a slug | Composite identity and machine-scoped sync |
| Historical rows attached to wrong device | Leave identity unknown unless registered evidence exists |
| Duplicate remote execution | Target plus atomic claim and idempotency key |
| Panel outage blocks execution | Local queue, schedule, and history remain independent |
| Key migration breaks users | Additive credentials and manual fallback |
| Richer activity leaks local content | Privacy classes and local-only defaults |
| UI hides a required capability | Retain technical routes under Advanced during measured transition |

## Stop conditions

Stop migration if any step requires rewriting definitions, treating `worker_id` as stable identity, weakening RLS, granting an organization key cross-machine command access, sending secrets to Panel, or deleting ambiguous history.
