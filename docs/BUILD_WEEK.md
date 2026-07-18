# Build Week: Consumer agent tools

## Summary

This Build Week adds three connected macOS experiences: guided agent creation, Agent Debugger, and Security Analyzer. The work makes local agents easier to configure and safer to change while retaining the existing Agent Server file format, runtime system, connections, schedules, and run history.

## Baseline

- Baseline commit: `5b779736985e918874b80b390372be71645dc19a`
- Working branch: `creation-experience`
- First security and analysis foundation commit: `65d033a`
- Security and reliability simplification commit: `919c6fe`
- Primary Codex session ID: `019f7458-705a-7fe2-8819-b2bf9f383298`

The verified baseline had 862 server tests across 60 files and 126 Swift tests. Server lint, TypeScript checking, server build, and unsigned macOS build passed before feature work began.

## Features added

### Guided creation

- A plain-language starting prompt
- Concrete follow-up questions with native controls
- A structured, validated proposal
- Readable schedule, connection, file, permission, and risk sections
- Compatible Markdown generation with least-privilege defaults
- Security analysis before save
- Safe first test linked to existing runs
- A path for creating a related agent without copying secrets or history

### Agent Debugger

- Deterministic local failure checks before model use
- Consumer explanations and bounded evidence
- Optional structured diagnosis for unexplained failures
- Reviewable repair proposals
- Security review before applying a fix
- Apply, retry, run linkage, and bounded undo
- Redacted technical details

### Security Analyzer

- Deterministic rules for permissions, paths, credentials, triggers, services, instructions, and external access
- Optional semantic prompt-risk findings
- Consumer risk levels and recommended restrictions
- Local review state keyed by agent content hash
- A global security dashboard
- Preflight handling for high-risk and critical agents
- Structured patch preview and application

## Cleanup audit integration

The work includes prerequisites from the codebase cleanup audit. The first two commits improved local API authentication, child-process environment isolation, executor defaults, run identity, redaction, WebSocket recovery, polling, settings draft safety, and shared permission policies. These changes support safe previews and reliable run-to-debugger routing.

The cleanup remains part of feature delivery. Each consequential batch is tested, committed, reviewed for simpler structure, and cleaned before the next batch. Dead code is removed only after behavior coverage shows that it is unused.

## Codex role

Codex assisted with repository discovery, implementation planning, test-first changes, strict schemas, deterministic analysis, patch policy, Swift state models, documentation, verification, and code review. At runtime, local Codex can provide structured proposals, semantic security analysis, and diagnosis when deterministic checks do not have enough evidence.

Codex runtime output is treated as untrusted input. It must pass strict schemas and policy checks. It cannot directly apply a configuration change.

## GPT-5.6 role

GPT-5.6 is an optional structured model when the user has selected a compatible configured runtime. It can perform the same bounded proposal, semantic analysis, and diagnostic tasks. Core parsing, permissions, security rules, patch policy, and review state remain local and deterministic.

## Human design decisions

- Start with a guided task description instead of a technical form.
- Show consumer terms by default and place configuration syntax under Advanced details.
- Keep agent Markdown as the source of truth.
- Require review before every generated or suggested change.
- Forbid automated unrestricted access and arbitrary shell grants.
- Store security review metadata outside user-authored agent files.
- Retain failed runs when a fix is retried.
- Treat critical risks as preflight blockers until reviewed.
- Keep local deterministic behavior available without a cloud account.

## Tests added

The feature work adds server behavior coverage for shared schemas, environment and permission policies, redaction, proposal validation and fallback, diagnostics, security rules and review state, patch preview and application, conflicts, rollback, runtime integration, and analysis APIs.

Swift behavior coverage includes proposal and debugger state changes, consumer risk and schedule presentation, security payloads, accessibility identifiers, drawer routing, transport recovery, and stale state protection. A small deterministic UI test set covers the main demo and safety paths.

Final test totals and build results belong in the final verification report after all feature commits are complete.

## Demo

Use [BUILD_WEEK_DEMO.md](BUILD_WEEK_DEMO.md) and the redacted fixtures under `server-app/sample-agents/build-week-*`. The fixture paths are relative or generic and contain no credentials.

## Documentation

- [Consumer agent tools](CONSUMER_AGENT_TOOLS.md)
- [Architecture](CONSUMER_AGENT_ARCHITECTURE.md)
- [Security threat model](SECURITY_THREAT_MODEL.md)
- [Manual test matrix](MANUAL_TEST_MATRIX.md)
- [Model schemas and prompts](MODEL_SCHEMAS_AND_PROMPTS.md)
- [Demo guide](BUILD_WEEK_DEMO.md)
- [Final verification report](FINAL_VERIFICATION.md)

## Known limitations

- Model-assisted steps require an available structured-output runtime.
- Some connection authorization remains service-specific.
- Static analysis cannot guarantee that an approved agent will behave safely.
- Bounded undo is unavailable after a conflicting file edit.
- Final screenshot capture depends on a complete signed or unsigned app build with deterministic demo data.

## Future improvements

- Expand service-specific access summaries and fixes.
- Add more resolved-failure patterns to the deterministic debugger.
- Add a signed redacted security report export.
- Add more UI automation once native macOS controls can be driven reliably in CI.
- Continue pruning duplicated and dead code under behavior coverage.

## Commit list

The final verification report must list every branch commit associated with this work, starting with:

1. `65d033a` Harden local execution and add analysis foundation
2. `919c6fe` Simplify local security and reliability policies

Add later implementation, UI, documentation, and verification commits before release.
