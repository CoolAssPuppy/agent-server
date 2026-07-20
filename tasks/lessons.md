# Lessons

- Visual restraint does not mean flattening a useful information architecture. When a user likes an established grouping pattern, preserve it and improve the typography, spacing, and density inside it instead of replacing the composition.
- A model-family preset must bind to an exact versioned model ID, while historical runs and existing agent files retain their configured version. Never relabel or silently migrate older provider configurations when a new preset replaces them.
- Interface copy must earn its space. Remove sentences that restate a heading, describe a visible control, or tell people to press the obvious primary action. Keep copy that explains consequences, safety, privacy, unfamiliar concepts, or recovery.
- An application-wide visual standard needs shared composition rules and behavior tests, not a sequence of unrelated cosmetic fixes. Define the hierarchy for chrome, sections, rows, status, actions, and disclosures first, then make each screen conform while preserving its task-specific controls.
- Reusing design tokens does not guarantee a coherent Apple-style screen. A drawer should have one surface hierarchy and a small, deliberate set of type roles; nested cards, tinted blocks, capsules, and competing font sizes create visual noise even when each component is individually valid.

- A transport or decoding failure after a write does not prove the write failed. Save flows must use an idempotency identity and reconcile authoritative state before telling the user nothing was saved or encouraging a duplicate retry.
- Error recovery is one compact task, so its icon, title, explanation, primary action, and details action must stay in one narrow visual group. A disclosure pushed to the far edge of a wide card looks detached from the error it explains.

- Navigation actions should represent navigation or primary work. Storage location belongs in Settings, and choosing a custom agents folder must move every companion lookup, including `.env`, authentication, editing, and server startup, as one coherent setting.
- Shared runtime behavior needs shared presentation. Do not place a restart note beneath one of several controls when the requirement applies to all of them; show the consequence only after a relevant change and provide the action beside it.
- Follow-up questions should be grouped by the consumer task, not emitted as a sequence of infrastructure fields. Connection setup should show every service named in the original request together, and file access should use one native selection surface without a redundant “Your answer” container.

- A status response during an active implementation must not end the work loop.
  Resume the next concrete task immediately, keep progress updates flowing, and
  do not imply continued execution when no tool or agent is active.
- When a task asks for local Apple or macOS development guidance, inspect the
  project owner's dotfiles skill links as well as the session skill catalog
  before finalizing the implementation plan.
- For long implementation work, commit each consequential verified batch, then
  perform a simplification pass and rerun affected tests before starting the
  next milestone. Keep every production change tied to a failing behavior test.
- When adding a model-controlled CLI provider, audit the entire child environment. Removing one billing credential is insufficient because shell commands can inherit unrelated secrets.
- Provider support is not complete until filesystem, network, command, credential, and approval boundaries are stated and tested separately.
- Before deleting a generated-output directory, separate tracked assets from disposable artifacts with `git ls-files`. Preserve tracked metadata and images unless the user explicitly names them.
- macOS UI tests take control of keyboard focus and can interrupt the user's work. Run them only in a clearly agreed window, stop after one useful result, and use non-interactive builds and state tests for later verification.
- A routed view can still feel modal when its geometry enters from the window edge. For a sidebar action that opens a drawer, verify the panel is clipped to the main-pane slot and enters from the sidebar boundary. Match requested navigation labels and order exactly.
- A new app can still talk to an old daemon after relaunch. Version the local API, test live upgrade behavior, and verify absolute system-tool paths on the target macOS environment instead of assuming `/usr/bin`.
- A consumer creation flow must resolve required services before resource scope. Offer an existing connection or setup first, then ask for the exact files, folders, calendars, and write access that service will use.
- Never let a new credential allowlist silently hide existing agents. Test compatibility with every supported connection-variable alias and surface invalid definitions with an actionable reason.
- A SwiftUI app lifecycle can replace an AppKit menu installed during launch. Verify the live menu and repair native responder-chain commands after activation instead of adding field-specific keyboard handlers.
- Treat an account qualifier such as Personal or Work as a user decision. Never auto-select a different account merely because it is the only connected service.
- When repairing a native menu, keep references to menu objects across insertions and normalize both selectors and keyboard equivalents. Array indices and English menu titles are not stable macOS contracts.
- A server-owned service registry must still minimize model input. Send only services named by the request or explicitly selected, and bind only identities that were offered in that reviewed request.
- When a model fallback repeats a question that already has a structured answer, stop in a retryable error state. Do not recursively call the proposal service or discard the user's selected resources.
- Exact file scopes need default-deny tool permissions, canonical path precedence, and a runtime that can enforce individual paths. Never widen a selected file to its parent folder or combine scoped paths with unrestricted commands.
- A macOS document importer configured for general items may treat folders only as navigation. Do not expose that framework limitation as two competing consumer actions. Use one native open panel configured to select both files and directories, with a folder-only mode only when the question truly requires a folder.
- A service question needs provenance, identity, and scope. Say that the service was mentioned in the request, show its recognizable brand, name the exact account choices, and state that unselected accounts will not be added.
- Sidebar footer actions should share the same quiet row geometry as the list. Avoid a permanent outlined promotional card for navigation state, duplicate status glyphs, and tap gestures where a keyboard-accessible Button is available.
- Treat every model-provided connection label and risk summary as untrusted presentation data. Replace connection metadata from the current registry and recompute risk after server-owned resource grants are applied, before showing the proposal.
- A server-side patch preview is not user review. Show the exact consumer summary and sanitized advanced changes, then bind approval to the preview hash before applying a high-risk fix.
- Local model requests cannot share the short timeout used for health polling. Set route-specific client timeouts from the server's bounded model budget, including its retry allowance, or the app will abandon a request that is still working correctly.
- A model fallback must consume the same structured answers as the main proposal path. Never return a question whose identifier is already answered. Once required service and resource scopes are confirmed, build a validated least-privilege local proposal instead of trapping the consumer in retry.
- Apple framework authorization cases differ by platform even inside shared SDKs. Compile the actual macOS target before accepting an iOS-family authorization state as available.
- Treat the documented `~/.agent-server/.env` path as a product contract. Do not introduce a second environment file for one UI flow without explicit approval, migration behavior, and end-to-end reader and writer tests.
- A model repeating answered questions is a normalization case, not a reason to discard an otherwise valid proposal. Remove only questions proven answered and preserve validated proposal content.
- Every model-backed server route must have a bounded server timeout shorter than its macOS client timeout. Keep deterministic results when semantic analysis times out.
- A completion icon must not imply a safety verdict. Security progress rows must show the resulting risk level as soon as each analysis finishes.
- Security drill-downs should preserve context. Keep the list as a left panel and add details to the right instead of replacing the drawer's content.
- Consumer permission controls must write to the policy the runtime actually enforces. When an agent has a detailed permissions block, changing only legacy tool fields creates a switch that cannot persist its state.
- Lossless configuration editing means byte preservation outside the exact changed nodes. Parsing and serializing a full YAML document can preserve meaning while still creating an unacceptable diff.
- Long-running status should replace the result inside its existing card while surrounding navigation and lists stay put. Whole-view swaps make a background operation feel like a different screen.
- Connection readiness must come from the named connection instance, not a generic service catalog entry. Preserve Personal, Work, and other account identities, and expose only the environment variable names required to edit them locally.
- A connection label is presentation metadata, not a provider identifier, environment-variable convention, or tool namespace. Bind behavior to an opaque ID, reviewed transport, credential references, and discovered operations so users can name and group connections however they choose.
- Design connection setup for a technical knowledge worker or tinkerer. Lead with a guided name and connection method, but keep environment variable names, endpoints, commands, credential targets, discovered operations, and exact grants visible and editable through progressive disclosure.
- A visible toggle must own persistent product state. Bind framework settings to their real manager and local-server settings to the selected workspace environment, then explain when a restart is required.
- Async detail requests must carry the identity of the selected object and request generation. Reject late logs or hydration data after the selection changes.
- Safety is a primary agent state, not an icon-only utility. Show connection readiness, stale review state, scan failure, and risk in one visible row with a direct recovery action.
- A fixed-height drawer still needs one outer scroll surface. Keep common settings in a stable reading order, adapt only the column count, and place infrastructure controls behind one clearly described disclosure.

## Do not equate an operation timeout with server reachability

- A local server can remain healthy after a client stops waiting for a long preflight or trigger request.
- Use an operation-appropriate timeout for routes that may perform model-backed safety work.
- Classify request timeouts as an uncertain operation result, then reconcile authoritative run state before offering Retry.
- Every skipped run must retain and present a reason, especially lock contention caused by a duplicate action.
- Never pass secret-bearing MCP configuration in child-process arguments. Use the runtime SDK's supported control stream, and hold the user prompt until connection setup succeeds.

## Keep drawers spatially predictable

- Escape should dismiss the deepest visible detail first.
- A sidebar selection must never leave an unrelated detail panel stranded on screen. Selecting the current agent closes its detail; selecting another agent replaces the detail in one action.
- Advanced telemetry controls belong beside the Agent Panel connection they configure, not in a visually unrelated column or card.

## Completion must mean the promised result exists

- A clean model or SDK exit proves only that execution stopped without a transport error.
- When an agent declares a required output, validate the observed tool call, destination, and successful result before recording completion or sending a success notification.
- Unknown passthrough configuration must never look enforceable. Model supported contracts explicitly in the schema and fail closed when they are unmet.

## Keep the home feed about agent work

- Decorative agent-count claims such as “on watch” add noise without helping the user decide or act.
- Repeated conversational turns can overwhelm operational activity. Group them by stable conversation ID in the concise home feed, label the source channel and start time, and keep each turn in full history.
- Do not explain exclusions the selection UI already makes obvious, such as stating that unselected service accounts will not be added.

## Repeated model questions are normal input noise

- A model may return a follow-up question whose answer already exists in structured state. Normalize it away instead of failing the entire creation flow.
- Progression must be based on validated proposal readiness after answer normalization, not on whether the raw model response repeated a question.
- Preserve every user-entered description, selected connection, and resource grant across retries and fallback paths.

## Recovery states need one visual hierarchy

- Do not render title, error label, save status, recovery paragraph, action, and technical details as equal-weight rows.
- Lead with a specific title, combine the outcome and save state into one short sentence, and let the primary button communicate the next action.
- Keep raw errors behind one quiet disclosure and preserve text selection for people who need to copy them.

## Distinguish model endpoints from installed agent runtimes

- Do not assume a provider name refers only to an API-backed model. Probe the user's machine before deciding whether a local executable exists.
- Kimi Code can be installed as a native `kimi` executable with non-interactive prompt output and an ACP server. Treat support for that executable as a runtime integration, separate from the Moonshot-backed Kimi K3 model preset.
