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
