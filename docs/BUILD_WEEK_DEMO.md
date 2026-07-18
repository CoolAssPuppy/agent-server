# Build Week demo

## Prepare

1. Build and start the local server and macOS app from `creation-experience`.
2. Use a clean demo profile or back up existing test agents.
3. Confirm Codex is available locally.
4. Use demo GitHub and Slack connections, or leave Slack disconnected to show setup.
5. Confirm no real credentials or personal file paths appear in the fixtures, app, or logs.

The fixture `server-app/sample-agents/build-week-github-slack.md` represents the approved configuration. The redacted JSON files provide deterministic failed and successful run evidence for demo or UI-test mode.

## Run the demo

1. Open Agent Server.
2. Choose **New agent**.
3. Enter: “Every Friday afternoon, review my GitHub activity and send me a short summary in Slack.”
4. Answer the time question with Friday at 5:00 p.m.
5. Review the proposal. Point out the plain-language schedule, GitHub read access, Slack destination, and lack of file or command access.
6. Show that Slack needs setup. Connect a demo workspace or continue in demo mode.
7. Open the permission and security summary. It should explain that selected GitHub data will be sent to Slack and classify the external access as **Needs review**.
8. Save and run a safe test.
9. Load `build-week-failed-run.fixture.json` in demo mode to simulate a missing Slack connection. The failed run remains visible in history.
10. Open Agent Debugger. It should explain that the message could not be sent because Slack is not connected.
11. Review the suggested connection fix. Show Advanced details and confirm that all sensitive values are redacted.
12. Apply the approved setup change and retry.
13. Load `build-week-successful-run.fixture.json` in demo mode. The new run succeeds and links back to the failure.
14. Open Security Analyzer for the agent. Mark the current content hash reviewed.
15. Open the global Security Check screen. The agent should appear as reviewed at **Needs review** because it sends a message to an external service.

## Alternative security demo

Copy the fixture to a temporary test file, change its working folder to `~`, and grant `Write`. Security Analyzer should warn about broad writable home access and recommend a narrow folder. Do not modify the committed fixture.

To demonstrate secret detection, generate a disposable fake credential pattern during the demo, scan it, confirm the UI shows `[REDACTED]`, and delete the test file. Never use a real credential or commit the disposable value.

## Expected consumer story

The audience should understand the flow without an explanation of YAML, cron expressions, sandbox modes, MCP, provider endpoints, or environment variables. Every configuration change remains visible before application, and the original failed run remains available after recovery.

## Troubleshooting

- If proposal generation is unavailable, confirm the local Codex executable and reopen the flow. Deterministic security analysis should still work.
- If the app reports that the server is offline, use Retry after the local health check succeeds.
- If the fixture does not load, run the parser verification command from the final verification report.
- If a review is stale, rerun Security Check. The agent file changed after the previous review.
