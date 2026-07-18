# Consumer agent tools

Agent Server now guides people through creating, repairing, and reviewing local agents without requiring them to understand agent configuration syntax. The three experiences share the existing local server, agent files, run history, connections, and macOS design system.

## Create an agent

Choose **New agent** and describe the result you want. The app asks only for information it still needs, such as a folder, delivery service, permission, or run time. Native controls handle schedules, files, folders, services, and permissions.

The proposal shows:

- What the agent will do
- When it will run
- Which apps and services it needs
- Which files it can read or change
- Which actions it may take
- A security summary
- Readable instructions

Generated proposals use narrow access by default. File changes, command execution, internet access, and external messages must be visible in the proposal. Missing required connections remain setup steps instead of becoming raw runtime errors.

Files and folders are reviewed one at a time, each with its own view-only or change access. Calendar and Reminders access names the exact account and resource, then separates viewing from adding, updating, or completing items. Contacts access is read-only and limits the helper to a selected group or reviewed account plus chosen detail types. macOS permission prompts appear only after the user chooses **Allow access**.

Every proposal is validated as structured data. The app converts an approved proposal into the existing Markdown plus YAML frontmatter format. Users can inspect the generated Markdown under **Advanced details**.

**Save and run a safe test** saves the agent and starts a restricted first run. The run appears in the existing run history and can be stopped. A failure can open directly in Agent Debugger.

## Agent Debugger

Agent Debugger starts with the failed run and explains four things:

1. What stopped the run
2. Which local evidence supports that conclusion
3. What change is recommended
4. What the change would allow

Local checks run before any model-assisted diagnosis. They cover common problems such as invalid schedules, missing folders, missing connections, disabled network access, permission mismatches, unavailable runtimes, active runs, and missing output files.

When local checks cannot explain the failure, Agent Server can ask the selected local structured model to interpret a small, redacted evidence package. The result must pass the diagnostic schema. Invalid or uncertain output falls back to a safe, general explanation.

Fixes use the shared configuration patch system. Users review a plain-language summary and an optional configuration diff before applying a change. High-risk changes need confirmation. Forbidden changes, including unrestricted access and arbitrary command execution, cannot be applied by an automated repair.

The original failed run remains in history. A retry creates a separate run so users can compare the result and undo the configuration change when a rollback is still available.

## Security Analyzer

Security Analyzer reviews generated and existing agents. It starts with deterministic local rules for:

- Broad or sensitive file access
- File changes and command execution
- Network access and external services
- Automatic schedules and file watchers
- Agent chaining
- Literal credentials
- Dangerous sandbox settings
- Destructive or ambiguous instructions
- Untrusted input combined with powerful actions

Findings use four levels: **Low risk**, **Needs review**, **High risk**, and **Critical**. A finding explains what could happen, what triggered it, and how a suggested restriction may affect the agent.

The global Security Check screen scans all agents and groups findings by level. Review records stay in the local security review database. Agent files are not changed when a finding is acknowledged. A content hash marks the review stale after an agent changes.

Critical findings such as literal credentials or unrestricted destructive access require review before execution. High-risk agents show a specific preflight warning before their first run or after a configuration change.

## Shared review and patch behavior

Creation, debugging, and security analysis share the same models for findings, evidence, risk, recommended actions, and configuration patches. This keeps risk labels and confirmation behavior consistent.

A patch includes the expected agent content hash. If the file changes after preview, application stops and asks the user to review the change again. The writer preserves the document format, unknown fields, and comments where the underlying YAML document supports them.

Automated patches cannot:

- Grant unrestricted filesystem access
- Grant arbitrary command execution
- Remove all action restrictions
- Store a literal credential
- Add destructive instructions
- Change a different agent

## Privacy

Core checks run on the Mac. Agent definitions and review metadata remain local. Structured model requests use the installed local runtime through the current Agent Server runtime support. No cloud account is required for deterministic analysis.

Before a model request, Agent Server limits the evidence to the relevant agent and run, removes likely credentials, and truncates large output. Raw prompts and logs are not retained for analysis. Logs use redacted values and must never contain credentials.

Agent Server only sends task data to an external app or model service when the agent configuration already allows that service and the user approves the related access.

## Advanced details

Advanced sections may show configuration fields, redacted logs, exact patches, runtime information, and generated Markdown. These details support troubleshooting without making technical concepts part of the default flow.

## Known limitations

- Semantic model analysis depends on an available local structured-output runtime.
- Deterministic checks can warn about likely risk but cannot prove an agent is safe.
- Existing agents with unusual custom fields may need manual review before an automated patch.
- Some service connection flows still depend on each service's current authentication method.
- Apple Music is not offered until the signed app has a tested MusicKit capability and read-only runtime.
- Contacts supports group or account scope but not individual-contact selection.
- Undo is bounded and may be unavailable after the file changes again.

## Future improvements

- More service-specific permission descriptions
- More repair rules based on resolved local failures
- Signed, redacted report export from the macOS app
- Better handling for large custom agent formats
- More native UI automation coverage as macOS test APIs improve
