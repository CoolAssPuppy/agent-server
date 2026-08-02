# V2 visual acceptance matrix

This matrix is the review gate for the consumer macOS surfaces. Deterministic fixtures live in `macos-app/AgentServerSwiftTests/Sources/AgentServerCore/ConsumerFlowDemoFixtures.swift` and `docs/v2/fixtures/`.

| State | Today | Assistant home | Activity and review | Required evidence |
|---|---|---|---|---|
| Empty | Clear first-assistant action | Creation entry point | Calm empty history | Light and dark, narrow and standard width |
| Healthy | Recent outcome and upcoming work | Healthy, ready, access summary | Successful outcome and evidence-backed outputs | Light and dark |
| Working | Working item with open action | Working state and cancel when supported | Human progress timeline | Light and dark |
| Needs you | One intervention action | Readiness reason and repair action | Waiting reason, action, and expiry | Light and dark, keyboard and VoiceOver |
| Failed | Human problem and retry or review | Needs attention | Problems before Technical details | Light and dark |
| Offline | Local server unavailable without false execution claims | Last good local snapshot where safe | Retained durable history | Light and dark |
| Mixed | Correct section priority without duplicate items | Current assistant state | Search and status filters | Standard and narrow width |

## Current evidence

- Deterministic behavior tests cover Today, Activity, Assistant home, run review, creation, Connections, Settings, keyboard identifiers, and state mappings.
- Unsigned Debug app builds verify compiled layout code.
- Earlier compiled visual inspection covered Today, dated Activity, the interaction response sheet, Assistant home, and run review in light and dark appearances.
- The latest Connections and Settings capture attempt occurred while the overnight display session was locked and produced a black image. It is not accepted as screenshot evidence.

## Remaining signed review

Before release, run the UI target in a signed, unlocked macOS session and attach captures for every row above. Review action dominance, reading order, contrast, truncation, focus order, keyboard operation, VoiceOver labels, and Technical details disclosure. A build result alone does not satisfy this visual gate.
