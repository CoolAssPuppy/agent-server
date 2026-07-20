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
| Multiple accounts for one service | Add Personal Notion and Work Notion with different credential references | Both accounts remain distinct by user-chosen label. Creation selects the exact account and never displays either credential value. |
| Rename a saved connection | Rename Personal Notion after an agent uses it | The label changes without changing the opaque binding, runtime name, transport, or credential references. The agent still resolves the same account. |
| Remove an unused saved connection | Open its detail panel and confirm removal | The profile is removed and its credential values remain untouched in `.env`. |
| Remove a connection used by agents | Attempt removal from its detail panel | Removal stops and names the agents that must be reviewed. No agent or profile changes. |
| Duplicate a saved connection | Duplicate an existing profile | A new profile with new opaque identifiers keeps the same credential references. The person gives it a distinct label and can modify credentials before assigning it to an agent. |
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
| Request Calendar access | Permission is requested only after Allow access. The proposal shows the selected account, calendar, and whether events can change. |
| Request Reminders access | The proposal shows the selected account, list, and separate view, add, and complete actions. |
| Request Contacts access | The proposal shows the selected group or account and only the approved names, email, phone, or birthday fields. No write action is offered. |
| Request Apple Music access | The app clearly reports that Apple Music is unavailable in the current signed build and does not generate a false permission grant. |
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

## Kimi Code runtime

| Scenario | Expected result |
|---|---|
| Installed and signed in | Settings shows Use installed Kimi on. A `kimi-code` agent completes through the installed executable and records structured tool activity. |
| Missing installation | Selecting Kimi Code leaves the agent reviewable, but a run explains that Kimi Code is not installed or is turned off. It never uses another runtime. |
| Signed out | A run asks the user to sign in with `kimi login`. No prompt, credential, or agent file appears in the error. |
| Turn off installed Kimi | Disable Use installed Kimi and restart the server | Kimi Code becomes unavailable while Claude Code, Codex, and existing agent files remain unchanged. |
| Invalid explicit path | Set `AGENT_SERVER_KIMI_PATH` to a missing executable | Discovery fails closed and does not search `PATH` or use another runtime. |
| Kimi Code versus Kimi K3 | Switch the per-agent coding-agent picker between both choices | Kimi Code stores `executor: kimi-code` with no provider. Kimi K3 stores `executor: codex`, model `kimi-k3`, and a Moonshot provider reference. |
| Existing Kimi K2 agent | Open and save an older custom Kimi K2 agent without changing its model | Its executor, model ID, provider reference, and history labels remain unchanged. |
| Exact read-only path | Ask Kimi Code to read one approved file and one file outside the grant | The approved read succeeds. The outside content is not returned or logged. |
| Exact approved write | Allow one output file and deny Bash | The approved file can be created or changed. A neighboring file remains unavailable. |
| Symlink escape | Place a symlink inside an approved folder that points outside it | Canonical path checks reject the outside target. |
| Exact path plus Bash | Add Bash while exact file grants are present | The run refuses to start and explains that commands could bypass exact path checks. |
| Reviewed MCP connection | Run a Kimi Code agent with one saved MCP connection | Only that MCP configuration and its referenced values are forwarded through ACP. Unrelated environment secrets remain absent. |
| Cancellation | Stop an active Kimi Code run | Agent Server sends ACP cancellation, stops the child, releases the lock, and records a cancelled run. |
| Model choice | Set a Kimi ACP model value and run | The value is sent through ACP session configuration. A provider block is rejected with guidance to use Kimi K3 via Moonshot. |
| Log privacy | Search server and app logs after successful and failed Kimi runs | Prompts, file contents, provider keys, MCP secrets, and permission arguments are absent. Tool names and granted or blocked state may appear. |

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

Current automated evidence: 1,255 server tests across 93 files, 363 Swift tests,
nine installed Kimi Code conformance tests, and the non-interactive lint,
type-check, production build, and macOS build gates pass. Current server
coverage is 81.02% statements, 76.57% branches, 84.00% functions, and 82.62%
lines. The full
four-test signed UI suite passed once in 34.8 seconds.
A later redundant rerun was interrupted after another application stole focus.
UI automation was then stopped at the user's request. Repeat it only in an
isolated macOS session where it will not disrupt active work.

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
