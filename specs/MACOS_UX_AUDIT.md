# macOS experience audit

## Audience and standard

Agent Server should work for a technical knowledge worker or tinkerer who understands apps, accounts, files, and automation. The default path should not require YAML, MCP, cron, sandbox, provider, or environment-variable knowledge. Experts should still be able to inspect and edit the exact mechanics.

Every consequential screen should use three levels:

1. The decision the person must make now.
2. The context needed to make that decision safely.
3. Technical details and exact configuration on demand.

The audit inspected SwiftUI source, state models, copy, navigation, loading and failure states, accessibility behavior, and current automated coverage. It did not run UI automation.

## What already works

- Creation starts with a plain-language request instead of infrastructure fields.
- File access is explicit and defaults to view-only.
- Proposal, debugger, and security use shared cards, risk labels, and technical-detail disclosures.
- Debugger fixes require a reviewed patch before application.
- Security scanning runs in the background and preserves the agent list while scanning.
- Settings keeps raw agent-file editing in Advanced.
- The app uses shared theme tokens and a common top-drawer surface.

## Correctness findings

These issues can misrepresent state or apply an action to the wrong object.

- A safe test is reported as complete when the run has only started. Creation must observe the exact run, provide Stop and Open run actions, and route failures to Debugger.
- Debugger retry never observes the replacement run, so its resolved state is unreachable.
- Run now suppresses trigger, preflight, connection, and offline errors.
- Debugger always offers Retry without changes even when rerunning is unsafe.
- Agent Settings stages text and schedule changes, but applies capability switches immediately. Save and Cancel therefore have inconsistent meaning.
- Required missing connections do not prevent a proposal from being called ready.
- Security detail state can survive an agent selection change and display one agent's findings under another agent.
- Run and log requests can complete out of order and show data from a previously selected run.
- Failed run deletion is presented like a successful deletion.
- Completed Security results omit agents whose checks failed.
- Two Settings toggles currently change only temporary view state.

## Hierarchy and density findings

- The proposal should lead with the agent name, outcome, schedule, missing setup, and risk. Access lists and generated configuration should follow under disclosures.
- Edit details should preserve prior answers and selected resources instead of restarting the conversation.
- Model endpoint and credential-reference fields belong in Advanced by default.
- Agent detail needs a visible Safety and readiness row instead of an icon-only security entry point.
- Connections should lead with configured accounts. Claude imports, messaging, templates, and custom transports should become categorized choices inside one Add connection flow.
- A saved connection needs a detail panel with rename, edit, test, duplicate, and remove actions.
- Settings needs a responsive scrolling layout. Promotional links should move into About.
- Runtime selection should present one default runtime and readiness, with fallback rules in Advanced.
- Raw environment editing should remain available as Advanced Configuration variables, with Connections as the normal account-management path.

## Language findings

- Replace absolute claims such as every Claude connection being available with live, source-specific readiness language.
- Keep account identity visible. Personal, Work, workspace, and source are user decisions rather than service metadata.
- Show friendly failure summaries in agent detail and keep raw errors in run technical details.
- Hide empty Evidence sections and make manual debugger steps explicit.
- Use the existing brand component instead of maintaining a second service-icon map.

## Accessibility findings

- A visible drawer must hide and disable background controls, move focus inside, and restore focus when closed.
- Escape should behave consistently across every drawer and step back through progressive Security panels.
- Reduce Motion must cover all drawer transitions, springs, pulsing indicators, and animated log following.
- Run rows and Security progress rows need one composed VoiceOver label with status text.
- Tabs need selected traits and arrow-key movement.
- Loading states need specific labels. Empty, failed, and unavailable states must remain distinct.
- Phase changes should move focus to the new heading and announce completion or failure.
- Icon-only actions need descriptive accessibility labels and stable identifiers.

## Reuse and pruning

- Use one connection identity row across saved profiles, Claude imports, messaging, and API-backed accounts.
- Use one progressive connection detail panel for readiness, account identity, testing, editing, and removal.
- Consolidate all credential sheets into the generic named-connection flow.
- Use one access summary row across creation proposal, agent settings, and agent detail.
- Use one run-status presentation model across run history and agent detail.
- Reuse the consumer failure component for trigger, settings, export, deletion, and log-loading errors.
- Reuse the current capability brand component and remove local icon maps.

## Implementation order

1. Correct cross-agent Security state, safe-test state, retry state, trigger errors, settings transactions, and out-of-order run data.
2. Correct proposal readiness and hierarchy, preserve edits, and surface safety and readiness in agent detail.
3. Consolidate Connections and credential setup into progressive panels.
4. Make drawer focus, keyboard behavior, accessibility semantics, and motion policy consistent.
5. Simplify Settings and prune duplicate views, copy, icons, and status models.

Each correction requires a failing behavior test first. Verification uses Swift package tests and an unsigned macOS build without focus-stealing UI automation.

## Implemented audit corrections

- Creation keeps reviewed answers when details are edited and cannot save while required connections are unresolved.
- Safe tests and debugger retries follow the exact replacement run through completion or failure.
- Run actions show useful recovery for offline, connection, preflight, and security failures.
- Agent permission edits remain staged until Save. Cancel discards them.
- Security keeps failed and pending agents visible and prevents stale cross-agent detail.
- Agent detail shows Safety and readiness as a labeled row.
- Saved connections use progressive detail panels with rename, duplicate, readiness, credential editing, and reference-safe removal.
- Connection labels are user-owned. Technical templates and credential fields are secondary.
- Settings scrolls, adapts from two columns to one, and keeps infrastructure controls under Advanced.
- Open drawers make background content inert. Drawer transitions stop under Reduce Motion.
- Run and activity rows provide composed VoiceOver labels. Run tabs expose selected state and support arrow keys.
- Debugger retry behavior follows explicit safe, confirm, or unsafe guidance and omits an empty Evidence section.

## Deliberate remaining work

- Manual VoiceOver, Accessibility Inspector, keyboard-only, large-text, light and dark appearance, and Reduce Motion review remain release checks. They were not automated because macOS UI automation was taking focus from the user's active work.
- Keychain storage remains deferred until the Node server has a matching secure token bridge. Static secrets remain in the owner-only local `.env` file and never enter agent Markdown.
- Apple Music remains unavailable until a signed MusicKit entitlement and read-only runtime are tested.
- Generic browser OAuth remains future platform work. Existing Claude-authenticated connectors and local credential-backed profiles continue to work.
- Creation and Connections still contain service-specific adapters where the runtime itself is service-specific. Their default presentation stays account-oriented, with transport details available on demand.
