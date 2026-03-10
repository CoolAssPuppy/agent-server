# Agent Server Security Evaluation (Offensive + Defensive)

## Scope

This review focused on `server-app` runtime surfaces that can be abused to execute unwanted actions on a host machine:

- HTTP API and WebSocket control plane
- Agent execution defaults (tool permissions and shell execution)
- Agent discovery/triggering model
- Integration channels (Telegram)

## Executive Summary

The highest-impact hijack path is **remote run triggering** when the server is reachable from anything other than loopback without a strong API key. A successful attacker can trigger agents that are explicitly designed to run tools like `Bash`, `Read`, and `Write` in privileged user directories.

In practical terms: if exposed on a LAN/VPN/public interface and left unauthenticated, this service is equivalent to a remote job runner with access to your local files and command execution primitives through the underlying agent SDK.

## Key Hijack Scenarios

### 1) Unauthenticated remote run triggering (critical)

**Attack chain**
1. Attacker reaches `/agents/:id/run`.
2. Attacker supplies prompt suffix via `{ "with": "..." }` to steer behavior.
3. Agent executes with potentially dangerous tools and broad filesystem reach.

**Impact**
- Arbitrary command execution through agent-directed shell use.
- File exfiltration or tampering through `Read` / `Write` tool usage.

**Mitigation implemented**
- Default bind host is now loopback (`127.0.0.1`).
- Server startup now fails if configured to bind a non-loopback host without an API key.
- API key minimum length enforced at config parse time (16 chars).

### 2) Weak secret operational risk (high)

**Attack chain**
- Operator sets short/guessable API key.
- Brute-force or key disclosure leads to full remote control.

**Impact**
- Equivalent to scenario #1.

**Mitigation implemented**
- Config validation now rejects short API keys (<16 chars).

### 3) Prompt-injection and untrusted input steering (high)

**Attack chain**
- Adversary sends crafted Telegram/API content.
- Model is socially engineered into using tools destructively.

**Impact**
- Local data compromise if tool permissions are permissive.

**Mitigations recommended (not yet implemented)**
- Require explicit allowlists in `permissions.allow` for every production agent.
- Prefer `permission_mode: default`/`dontAsk` only with strict allowlists, avoid broad `bypassPermissions` unless fully sandboxed.
- Add per-agent input sanitization and explicit instruction boundaries for `with`/chat content.

### 4) Data leakage via observability endpoints (medium)

**Attack chain**
- Attacker reads `/runs`, `/runs/:id`, `/ws` and harvests summaries/progress metadata.

**Impact**
- Sensitive project names, command fragments, file paths, or summaries leaked.

**Mitigations recommended**
- Keep API key enabled for all non-local use.
- Add redaction policy for paths/commands in progress payloads.
- Add audit log of API auth failures.

## Changes Applied in This Patch

1. Added secure network defaults and config validation:
   - `AGENT_SERVER_HOST` support with default `127.0.0.1`.
   - Non-loopback bind requires `AGENT_SERVER_API_KEY`.
   - API keys must be at least 16 characters.

2. Updated docs to make secure deployment expectations explicit.

3. Added tests for host defaults, host parsing, and short API key rejection.

## Hardening Roadmap

1. Add request rate-limiting + temporary bans for repeated auth failures.
2. Add optional mTLS or signed request mode for non-local deployments.
3. Add per-agent run authorization scopes (`canTrigger: [principal]`).
4. Add outbound egress controls for agent subprocess/network tools.
5. Add secret redaction middleware for run summaries and progress streams.

