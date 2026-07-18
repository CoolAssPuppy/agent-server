# Manual test matrix

## Setup

Build the server and app from the `creation-experience` branch. Use demo agents and accounts that contain no private data. Keep Console open for redacted logs. Record the app version, macOS version, runtime versions, and result for each row.

## Core flow matrix

| Scenario | Steps | Expected result |
|---|---|---|
| Fresh install | Remove only the dedicated test profile, launch the app, and open New agent | Local folders and API authority are created with owner-only permissions. The first screen asks what the agent should do. |
| Existing user upgrade | Launch with existing agents, runs, connections, and settings | Existing agents parse and run. No permissions, schedules, or connections change silently. Security reviews begin as not reviewed or stale. |
| Server offline | Stop the local server and open each new feature | Each screen explains that the local service is unavailable, keeps unsaved input, and offers Retry. Technical details remain optional. |
| Codex unavailable | Hide the Codex executable and request a proposal | Creation explains that the local model is unavailable. Deterministic security checks still work. Nothing is saved. |
| No connections | Create the GitHub to Slack demo request | The proposal marks GitHub and Slack as needing setup and allows the user to return without losing progress. |
| Multiple connections | Connect two supported services and reopen the proposal | Each service shows its own current state. Optional services can be skipped. |
| Malformed agent | Add a frontmatter file with an unclosed delimiter and open it | The app explains that the file cannot be read and offers technical details without replacing the file. |
| Large prompt | Analyze an agent near the prompt limit | The app stays responsive. Analysis completes or returns a bounded error. No huge text block appears by default. |
| Large log | Open a failed run with a large output stream | The debugger uses bounded relevant evidence, opens promptly, and copies only redacted technical details. |
| Network unavailable | Disable network and run an agent that needs an external service | The debugger explains the connection failure and does not suggest changing unrelated settings. |
| First run | Save a new read-only agent and choose safe test | Preflight appears when needed, the run is visible in history, and Stop remains available. |
| Existing reviewed agent changes | Mark an agent reviewed, edit one instruction, and reopen Security Check | The prior review is marked stale because the content hash changed. |

## Guided creation

| Scenario | Expected result |
|---|---|
| Enter “Every Friday afternoon, review my GitHub activity and send me a short summary in Slack.” | The app asks only for unresolved time or connection details. It does not show YAML or cron by default. |
| Pick Friday at 5:00 p.m. | The proposal says “Every Friday at 5:00 p.m.” and uses the selected time zone. |
| Select a folder | A native folder picker opens. The proposal shows a readable path and read-only or editable state. |
| Request file edits | The proposal shows the specific writable folder and a high-risk review. No write access is added without approval. |
| Request command execution | The proposal explains the need and risk. Cancel leaves the prior proposal unchanged. |
| Model returns malformed output | One bounded retry occurs, then a friendly fallback error appears. Nothing is saved. |
| Duplicate name | Saving explains that the name is already used and lets the user edit it. |
| Create something similar | The copied proposal retains high-level intent but excludes secrets and run history. Changes are shown before save. |

## Agent Debugger

| Scenario | Expected result |
|---|---|
| Read-only agent tries to write | The debugger explains the permission mismatch and identifies the attempted folder. |
| Missing working folder | The debugger offers to choose an existing folder. It does not invent a path. |
| Missing connection | The debugger opens the existing branded connection flow and rechecks readiness after setup. |
| Invalid schedule | The debugger proposes a valid schedule and shows the human-readable result. |
| Unavailable runtime or model | The debugger offers an installed local runtime or default model. |
| Low-risk fix | Review, apply, and retry creates a new linked run and keeps the failed run. |
| High-risk fix | Apply and retry requires confirmation and shows the security impact. |
| Forbidden fix | The app refuses unrestricted access or arbitrary command execution and recommends a narrower manual option. |
| Stale preview | Edit the agent outside the app after preview and choose Apply | Apply stops with a conflict and asks for a new review. |
| Undo | Apply a reversible fix, undo it, and reopen the agent | The earlier content returns if no later edit conflicts. |

## Security Analyzer

| Scenario | Expected result |
|---|---|
| Embedded test credential pattern | A critical finding appears with `[REDACTED]`; the full value never appears in UI or logs. Use a generated fake value only. |
| Home folder plus file writes | A critical broad-access finding recommends a narrow folder. |
| Sensitive folder | `~/.ssh`, a `.env` file, browser data, and Keychain paths each receive a clear sensitive-data warning. |
| Commands plus internet | A high-risk finding explains possible data transmission. |
| Read-only narrow folder | The summary remains low unless another rule requires review. |
| Automatic watcher on untrusted files | The finding explains prompt injection and suggests a narrow source or confirmation. |
| Global scan | Counts match the visible agents by severity and open the selected agent. |
| Mark reviewed | The current findings are acknowledged without editing the agent file. |
| Redacted report export | The report contains findings and hashes but no credentials or private run output. |

## Accessibility and appearance

| Scenario | Expected result |
|---|---|
| VoiceOver | Titles, risk levels, connection states, errors, and actions are announced in logical order. Icons have descriptive labels. |
| Keyboard only | Every field, disclosure, card action, confirmation, Cancel, Stop, and Retry is reachable with a visible focus ring. |
| Large text | Text can grow without hiding the primary action or truncating the risk reason. |
| Reduced motion | Loading and state changes do not pulse or rely on large animated transitions. |
| Light and dark themes | Cards, focus rings, badges, errors, and disabled controls have sufficient contrast. |
| Non-color severity | Every severity includes readable text and a distinct symbol or shape. |

## Recovery and privacy

| Scenario | Expected result |
|---|---|
| Cancel proposal | No agent file is written. |
| Cancel patch | No setting changes. |
| Failed save | The app says whether anything was written and keeps the proposal available. |
| App restart during proposal | No partial agent file exists. Any restored draft is tied to the correct agent or creation session. |
| Search logs for fake credential | No full value appears in application, server, or test logs. |
| Direct API request without key | Protected local routes reject the request. Health remains available for readiness. |

## Release checks

Run the automated suites and record exact totals:

```bash
pnpm test
pnpm test:coverage
pnpm lint
pnpm type-check
pnpm build

cd macos-app/AgentServerSwiftTests
swift test
```

Build the `AgentServer` macOS scheme with signing disabled for local verification. Regenerate the Xcode project with xcodegen if `project.yml` changes. Test a signed build before release because file access, notifications, Keychain, and local authentication can differ from unsigned development builds.
