# Security threat model

## Scope

This model covers guided agent creation, Agent Debugger, Security Analyzer, the local API routes they call, and the structured patch system. It also covers their use of existing agent files, connections, executors, run evidence, and review metadata.

## Assets

- Local files and folders
- Agent definitions and instructions
- Connection credentials and provider keys
- Run output, logs, and tool evidence
- Messaging destinations
- Local API authority
- Security review decisions
- User trust in previews and confirmations

## Trust boundaries

1. User input enters the macOS app.
2. The macOS app calls the authenticated loopback server.
3. Agent Server reads local agent files and run evidence.
4. Agent Server starts Codex, Claude Code, MCP servers, or custom providers.
5. Agents may read untrusted files, messages, and web content.
6. Approved patches replace local agent files.
7. Notifications and connected services can send data outside the Mac.

## Threat actors and failure sources

- A local process attempting to call the server API
- A malicious instruction in a watched file, message, web page, or connected service
- A compromised or overpowered MCP server
- A deceptive custom provider endpoint
- A user mistake in a broad permission or path
- Incorrect model output
- A stale preview applied after another edit
- A credential copied into an agent file or diagnostic log
- A bug that associates a draft, finding, or fix with the wrong agent

## Main threats and controls

| Threat | Potential impact | Main controls | Remaining risk |
|---|---|---|---|
| Unauthenticated local API access | Another local process runs agents or changes configuration | Generated local bearer key, protected routes, bounded authentication failures | A process running as the same user may read user-owned configuration unless macOS access controls prevent it |
| Prompt injection from untrusted input | Commands, file changes, or data transmission | Deterministic combination rules, semantic warning, narrow permissions, preflight review | Semantic intent is not always detectable |
| Broad file access | Personal or credential files are read or changed | Normalized sensitive-path rules, narrow defaults, critical warnings, patch policy | Users can approve legitimate broad access |
| Command plus network access | Local data is sent outside the Mac | High-risk finding, explicit confirmation, restricted generated proposals | Approved agents retain the requested capability |
| Literal credential in configuration | Credential theft or accidental disclosure | Secret detection, redacted evidence, environment references, blocked patch application | Pattern checks may miss uncommon credential formats |
| Malicious or insecure provider | Prompt and task data disclosure | HTTPS requirement, loopback exception, approved provider reference, review warning | A valid HTTPS endpoint can still be untrustworthy |
| Overpowered connected service | External records are changed or disclosed | Explicit service permissions, deny rules, connection state, security findings | Service-side scopes may be broader than individual tools |
| Stale or confused-deputy patch | Wrong or outdated change is applied | Agent ID validation, expected content hash, preview result hash, atomic replace | Manual edits outside Agent Server may still require recovery |
| Model invents evidence or an unsafe fix | Misleading diagnosis or permission escalation | Strict schemas, deterministic checks first, risk floors, forbidden patch policy, bounded retry | A plausible but wrong low-risk explanation may require user judgment |
| Secret appears in logs or model prompts | Credential exposure | Structured redaction, evidence minimization, truncation, private logging | Novel secret formats or secrets embedded in arbitrary prose may evade detection |
| Automatic destructive execution | Repeated data loss | Destructive instruction rules, automatic-trigger findings, confirmation, critical preflight | User-approved destructive workflows still carry risk |
| Agent chaining increases authority | A low-risk input reaches a powerful agent | Chaining analysis, visible affected agents, review after content change | Cross-agent intent is hard to prove statically |
| Notification goes to the wrong destination | Private content is disclosed | Destination shown in proposal and preflight, connection readiness, reviewable patches | External service account configuration may change separately |

## Risk criteria

- **Low risk**: narrow read-only scope, no command execution, no external messaging, and no sensitive paths.
- **Needs review**: network access, messaging, a custom endpoint, broad reads, or automatic execution.
- **High risk**: file changes, command execution, sensitive data, untrusted input with powerful actions, or external transmission.
- **Critical**: literal credentials, unrestricted file or shell access, destructive automation, credential access, or automatic exfiltration.

Risk is a warning level, not proof of malicious behavior. A legitimate task can be high risk. Deterministic findings set a minimum severity that model analysis cannot lower.

## Blocking policy

Agent Server blocks automated patches that grant unrestricted filesystem access, arbitrary shell access, broad home access, every available tool, literal credentials, or destructive instructions. Critical preflight findings require review before execution. Acknowledgement is stored against the exact content hash and becomes stale after a change.

## Privacy properties

- Deterministic analysis runs locally.
- Review metadata stays outside agent Markdown.
- Secret evidence is redacted before display, storage, or model use.
- Model prompts include only relevant, bounded evidence.
- Raw credentials are never included in demo fixtures or tests.
- External services receive data only through an approved agent capability.

## Security verification

Tests should cover each rule, secret redaction, path normalization, content-hash conflicts, forbidden patches, review staleness, malformed model output, and high-risk confirmation. Manual tests should also attempt direct unauthenticated API access, a stale patch, keyboard-only cancellation, and a critical preflight warning.
