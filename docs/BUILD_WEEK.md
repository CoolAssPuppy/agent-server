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
- Exact named service identities, so Personal Notion and Work Notion cannot be confused
- Multiple files and folders with independent view-only or change access
- Exact Calendar, Reminder list, and Contacts scopes with on-demand macOS permission prompts
- Read-only Contacts field selection for names, email addresses, phone numbers, and birthdays

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

### Installed Kimi Code runtime

- A third installed coding-agent choice beside Claude Code and Codex
- A separate Kimi K3 via Moonshot model choice, with no silent migration between them
- Structured ACP sessions for prompts, tool activity, permission decisions, file access, and cancellation
- Exact reviewed file and folder boundaries when command execution is off
- A restricted child-process environment and actionable installation or sign-in errors
- Settings discovery controls and per-agent runtime selection in the existing macOS editor
- Local API version 11 so the app replaces older daemons that cannot run `kimi-code`

The Kimi Code executable runs locally, but model processing may use Kimi's service under the user's signed-in account. Agent Server does not treat an installed executable as proof of local inference. The separate Kimi K3 choice uses Codex, Moonshot's provider endpoint, and a referenced API key. Provider blocks are rejected for `kimi-code` instead of being silently ignored.

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
- Present Kimi Code as an installed coding agent and Kimi K3 as an API model so users can tell which account and runtime will be used.

## Tests added

The feature work adds server behavior coverage for shared schemas, environment and permission policies, redaction, proposal validation and fallback, diagnostics, security rules and review state, patch preview and application, conflicts, rollback, runtime integration, and analysis APIs.

Kimi Code coverage includes executable discovery, explicit opt-out and path overrides, closed executor schemas, safe environment construction, ACP negotiation, structured event mapping, deny-first permission decisions, exact read and write boundaries, cancellation, missing-runtime recovery, and the macOS runtime draft. Four opt-in conformance tests also exercise the installed Kimi binary without reading repository or user content.

Swift behavior coverage includes proposal and debugger state changes, consumer risk and schedule presentation, security payloads, accessibility identifiers, drawer routing, transport recovery, and stale state protection. Four signed macOS UI tests cover the requested creation, missing-connection, safe-test, debugger, low-risk repair, embedded-secret, folder-narrowing, and high-risk review behaviors using deterministic launch scenarios.

The latest non-interactive run passed 1,208 server tests across 90 files and 315 Swift tests. Server coverage reached 81.00% statements, 76.75% branches, 83.73% functions, and 82.39% lines. TypeScript checking, lint, the server build, and an unsigned app build passed. The full four-flow signed UI suite passed once earlier in the feature cycle. Later UI automation stopped at the user's request because it took keyboard focus. See [FINAL_VERIFICATION.md](FINAL_VERIFICATION.md) for the full record.

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
- Apple Music remains unavailable until the signed app has a tested MusicKit capability. The creation flow does not claim Apple Music access in the meantime.
- Contacts access is read-only. Users can choose a narrow group or deliberately review an entire account scope. Individual-contact selection is not yet provided.
- Failed-run notifications do not yet open the Debugger directly. Failed run detail, agent detail, and context actions provide debugger entry points.
- Static connection secrets remain in the existing owner-only local environment file. A Keychain migration needs a matching server token bridge.
- Static analysis cannot guarantee that an approved agent will behave safely.
- Kimi Code cannot combine exact file or folder grants with shell command access because shell commands could bypass ACP file callbacks.
- Bounded undo is unavailable after a conflicting file edit.
- Manual VoiceOver, Accessibility Inspector, keyboard-only, and light and dark appearance checks remain release validation tasks.
- SwiftUI previews are included for the main consumer states. No standalone screenshot artifacts are included.

## Future improvements

- Expand service-specific access summaries and fixes.
- Add more resolved-failure patterns to the deterministic debugger.
- Add more UI automation once native macOS controls can be driven reliably in CI.
- Continue pruning duplicated and dead code under behavior coverage.
- Add a reviewed action for adopting safe inline MCP definitions into saved named profiles. The conservative adoption planner identifies candidates but never changes agents automatically.

## Selected milestone commits

See [FEATURE_COMMITS.md](FEATURE_COMMITS.md) for the complete chronological list.

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
22. `c6d2a70` Complete Build Week verification and documentation
23. `7214d0f` Anchor agent creation in the main window
24. `ed08e9b` Keep sidebar interactive beside creation drawer
25. `4222e80` Scope file and calendar access during creation
26. `ec36800` Add calendar access recovery guidance
27. `31d49d6` Add unified local service registry
28. `a00a9e5` Use exact service identities during creation
29. `17e4b3e` Resolve reviewed services into runtime bindings
30. `d7f6497` Add scoped multi-file access to creation
31. `a27a928` Harden scoped creation permissions
32. `6146f74` Canonicalize creation review data
33. `8752eb0` Add scoped Calendar and Reminder access
34. `3c0d89e` Simplify native access review flow
35. `f464e56` Add scoped read-only Contacts access
36. `4ad6581` Harden Contacts scope and review
37. `d1096b7` Harden Contacts privacy and document verification
38. `7140f72` Unify native grants with reviewed fixes
39. `2ef3217` Harden reviewed security fixes
40. `f810f4e` Block relocated home folder grants
41. `bf21e6b` Respect debugger rerun safety
42. `4b83a00` Bind agents to saved connections
43. `1086757` Make open drawers accessibility modal
44. `3dd148b` Improve run accessibility navigation
45. `ec809b9` Simplify responsive Settings layout
46. `3123a12` Manage saved connections safely
47. `7e54fa5` Add native saved connection management
48. `2410ff9` Simplify connection setup language
