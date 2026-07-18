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

The work includes the relevant items from the codebase cleanup audit. It improved local API authentication, child-process environment isolation, executor defaults, run identity, redaction, WebSocket recovery, polling, settings draft safety, and shared permission policies. It also resolves Node through the configured child path, moves process waiting off the main actor, bounds tracking collections, removes tracked local Xcode and Wrangler state, and extracts the tested server run lifecycle from the main server composition file.

Large macOS services were split by responsibility. Guidance, security, agent actions, endpoint handling, environment-file storage, and process reliability now have focused seams with behavior coverage. Each consequential batch was tested, committed, reviewed for simpler structure, and cleaned before the next batch.

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

Swift behavior coverage includes proposal and debugger state changes, consumer risk and schedule presentation, security payloads, accessibility identifiers, drawer routing, transport recovery, and stale state protection. Four signed macOS UI tests cover the requested creation, missing-connection, safe-test, debugger, low-risk repair, embedded-secret, folder-narrowing, and high-risk review behaviors using deterministic launch scenarios.

The final non-interactive run passed 1,045 server tests across 80 files and 180 Swift tests. Server coverage was 78.82% statements, 74.59% branches, 80.28% functions, and 80.23% lines. The full four-flow signed UI suite passed once in 34.8 seconds. A later redundant UI rerun was interrupted after another app stole focus, and UI testing then stopped at the user's request. See [FINAL_VERIFICATION.md](FINAL_VERIFICATION.md) for the full record.

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
- Failed-run notifications do not yet open the Debugger directly. Failed run detail, agent detail, and context actions provide debugger entry points.
- Static connection secrets remain in the existing owner-only local environment file. A Keychain migration needs a matching server token bridge.
- Static analysis cannot guarantee that an approved agent will behave safely.
- Bounded undo is unavailable after a conflicting file edit.
- Manual VoiceOver, Accessibility Inspector, keyboard-only, and light and dark appearance checks remain release validation tasks.
- SwiftUI previews are included for the main consumer states. No standalone screenshot artifacts are included.

## Future improvements

- Expand service-specific access summaries and fixes.
- Add more resolved-failure patterns to the deterministic debugger.
- Add more UI automation once native macOS controls can be driven reliably in CI.
- Continue pruning duplicated and dead code under behavior coverage.

## Commit list

1. `65d033a` Harden local execution and add analysis foundation
2. `919c6fe` Simplify local security and reliability policies
3. `2a3b249` Add structured security proposal and diagnostic services
4. `f73f3b1` Fix confirmed network patch materialization
5. `47e5d5e` Add native creation debugger and security flows
6. `3e4e61c` Document consumer agent tools and demo
7. `40e8e1b` Wire guided creation and validated debugging
8. `866fe30` Integrate guided creation security and debugging APIs
9. `aacac2b` Split macOS guidance and security services
10. `53a6cfe` Harden macOS process management and local hygiene
11. `7b43031` Enforce reviewed execution and linked recovery
12. `5d60414` Simplify run trigger contract
13. `67f41a6` Add similar-agent and connection guidance flows
14. `d3877ef` Polish guided creation source layout
15. `f56645e` Remove tracked Xcode user state
16. `5b920a1` Extract tested server run lifecycle
17. `bcf7502` Clarify lifecycle integration boundary
18. `c40aa0d` Add deterministic macOS consumer UI flows
19. `09d8ddc` Inherit shared UI test signing settings
20. `36e6efa` Add Create Agent to main navigation
21. `2f523fe` Consolidate macOS environment and run history state
