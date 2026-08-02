# Agent platform V2 planning

Status: Approved and in implementation.

This directory is the canonical planning source for Agent Server and Agent Panel V2.

- [Current state audit](CURRENT_STATE_AUDIT.md)
- [Product plan](V2_PRODUCT_PLAN.md)
- [Information architecture](V2_INFORMATION_ARCHITECTURE.md)
- [Shared presentation models](V2_SHARED_PRESENTATION_MODELS.md)
- [Migration plan](V2_MIGRATION_PLAN.md)
- [Test plan](V2_TEST_PLAN.md)
- [Parallel work plan](V2_PARALLEL_WORK_PLAN.md)
- [Interface contracts](V2_INTERFACE_CONTRACTS.md)

The `fixtures/` directory contains operational V2 payloads shared by both coding agents. Agent Server tests generate these exact shapes. Agent Panel should validate the same fixtures before enabling V2 traffic.

Consumer UI implementation is governed by [V2 screen specifications](V2_SCREEN_SPECIFICATIONS.md) and the [V2 visual acceptance matrix](V2_VISUAL_ACCEPTANCE_MATRIX.md).

## Agent Server implementation status

The local read-only V2 slice is implemented: stable machine identity, consumer presentation models, Today, Activity, outcome-led run review, Assistant home and readiness, Connections, Settings, local device summary, explicit Panel disable behavior, and operational-only asynchronous Panel reporting. Agent Server remains functional without Panel, and the production-composition tests prove local execution and durable history with zero external requests when Panel is absent.

Pairing and remote command transport are stopped at the interface boundary. Agent Panel must first freeze machine-scoped endpoints, RLS, credential scopes, atomic claim behavior, rotation, revocation, and recovery. Manual API-key setup remains under Advanced. The final signed screenshot matrix must run in an unlocked macOS session before release.
