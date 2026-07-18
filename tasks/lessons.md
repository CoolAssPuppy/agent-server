# Lessons

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
- A macOS document importer configured for general items may treat folders only as navigation. When consumers may grant either files or folders, provide separate native file and folder actions, and configure the folder action explicitly for directory selection.
- Treat every model-provided connection label and risk summary as untrusted presentation data. Replace connection metadata from the current registry and recompute risk after server-owned resource grants are applied, before showing the proposal.
- A server-side patch preview is not user review. Show the exact consumer summary and sanitized advanced changes, then bind approval to the preview hash before applying a high-risk fix.
- Apple framework authorization cases differ by platform even inside shared SDKs. Compile the actual macOS target before accepting an iOS-family authorization state as available.
