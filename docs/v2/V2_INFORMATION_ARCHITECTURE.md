# V2 information architecture

## Consumer model

The default product vocabulary is:

- Today
- Assistants
- Activity
- Connections
- Devices
- Settings

Panel web and iOS use Today, Assistants, Activity, and Settings as top-level destinations. Connections and Devices live inside Settings. Agent Server macOS may keep Connections as a top-level desktop destination because it owns local setup.

## Navigation

| Destination | Panel web | Panel iOS | Server macOS |
|---|---|---|---|
| Today | Top level, default | Tab, default | Main pane, default |
| Assistants | Top level | Tab | Persistent sidebar |
| Activity | Top level | Tab | Top-level view or stable main-pane mode |
| Connections | Settings | Settings | Top-level desktop destination |
| Devices | Settings | Settings | Current device summary in Settings |
| Settings | Top level | Tab | Top-level destination |
| Technical details | Contextual disclosure | Contextual disclosure | Contextual disclosure |

Runs, Decisions, Logs, API keys, Costs, Models, Executors, Sessions, and Organizations are not top-level consumer destinations.

## Today

Reading order:

1. Needs you
2. Working
3. Finished
4. Problems
5. Upcoming

Only sections with content appear, except a calm all-clear state when nothing needs attention. Today is a task and outcome surface, not a chart dashboard.

Each card contains:

- Assistant name and device when remote
- One human sentence describing the current fact
- Relevant time or expiry
- One primary action
- Optional secondary disclosure

Examples:

- “Weekly Report needs permission to update the team page.” Primary action: Review.
- “Release Summary is reading GitHub on Office Mac.” Primary action: View activity.
- “Reading List added 6 articles to Notion.” Primary action: Open result.
- “Continuity Review could not find the manuscript folder.” Primary action: Choose folder.

## Assistants

The list prioritizes name, purpose, health, device, next run, and attention. It does not lead with runtime, model, tokens, or cron syntax.

Assistant home reading order:

1. Name, purpose, health, and device
2. Primary action: resolve attention, view work, run, or safe test depending on state
3. Readiness and any reason it cannot run
4. Schedule in plain language
5. What it reads and can change
6. Connections and result destination
7. Recent outcomes
8. Pause and Edit
9. Advanced details

Advanced contains definition source, AI engine, model, exact permissions, raw schedule, identifiers, and technical connection data.

## Activity

Activity is one ordered feed with filters for All, Needs you, Working, Finished, and Problems. Conversation turns may be grouped by conversation ID. Scheduled runs without conversation remain independent items.

The detail view opens with:

- Outcome headline
- Summary
- Accomplishments and changes
- Outputs and links
- Problems and next action
- Human timeline
- Suggestions, only when supported by evidence
- Operational completeness
- Technical details

Technical details contains raw logs, tool calls, tokens, model, executor, payloads, IDs, commands, exact paths, and transport state.

## Connections

Connection list rows show:

- Human label
- Provider and method category
- Health
- Last checked
- Assistants using it
- One action based on state: Test, Reconnect, or Review

Connection detail shows Remove and Advanced. Credential source, environment variable names, MCP transport, commands, headers, and endpoints live under Advanced. Secret values remain local and are never displayed by Panel.

## Devices

Each device represents one stable Agent Server installation. It shows:

- User-selected name
- Online, last heard from, or unpaired
- Assistants on this device
- App and protocol version
- Pairing or revoke action

Process ID, hostname, runtime paths, Realtime state, and API-key ID are Advanced details. A legacy row with no stable machine identity is shown as historical activity, not as a controllable device.

## Settings

Settings groups:

- Connections
- Devices
- Notifications
- Subscription
- Appearance where relevant
- Advanced

Advanced includes manual API keys, telemetry controls, raw identifiers, retention details, and developer documentation.

## Consumer-grade UI contract

Every production screen must meet these requirements before release:

### Purpose and hierarchy

- A new user can state the screen's purpose within two seconds.
- The first emphasized item answers the user's question, not the system's implementation state.
- Each card has no more than one primary action.
- Information follows a stable reading order across web, macOS, and iOS.
- Empty states explain what will appear and provide an action only when one is useful.

### Language

- Use Assistant, Instructions, AI engine, Approval behavior, Last heard from, and Technical details.
- Every problem states what happened and the next action.
- Every waiting state states what is needed, why, and when it expires.
- Every completed item states an outcome or says no result was produced.
- Avoid raw status codes and transport terms outside Advanced.

### Visual composition

- Reuse each product's existing components and tokens.
- Use type, spacing, and alignment to create hierarchy before adding borders or color.
- Reserve warning and destructive color for states that need attention.
- Avoid dense tables as the primary mobile or consumer layout.
- Hide charts, costs, and tokens unless the user opens Technical details.
- Keep layouts useful at empty, single-item, and high-volume states.

### Interaction

- Navigation and primary actions use controls with keyboard and assistive-technology behavior.
- Loading does not replace the full screen when stable content can remain.
- Optimistic remote requests distinguish Requested, Accepted, Started, and Rejected.
- Offline Panel state never implies that the local assistant stopped.
- Destructive actions state scope and require confirmation.

### Accessibility

- Meet WCAG AA contrast for text and essential controls.
- Support keyboard navigation and visible focus on web and macOS.
- Support Dynamic Type and at least 44-point touch targets on iOS.
- Do not encode health only by color.
- Respect reduced motion and preserve meaning without animation.
- Announce live changes without repeatedly interrupting screen-reader users.

## Screen specification gate

Before coding a key screen, its specification must include:

- User question answered
- Data sources and authority
- Reading order
- Primary action by state
- Empty, loading, error, offline, waiting, and permission-denied states
- Technical details boundary
- Desktop, mobile, keyboard, and accessibility behavior
- Screenshot fixtures
- Explicit items removed or demoted from the current screen

The first specifications to approve are Today, Assistant home, Activity detail, and Needs-you item.
