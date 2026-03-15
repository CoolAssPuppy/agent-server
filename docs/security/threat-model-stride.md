# Agent Server Security Threat Model (STRIDE) and OWASP Sweep

## Scope
- Node/TypeScript daemon and HTTP/WebSocket API in `server-app/src/**`.
- Integrations: Telegram bot channel, external panel telemetry, filesystem watches, Claude executor.

## 1) Assets
- **Agent definitions** (`agentsDir`) including prompts, schedules, triggers.
- **Execution runtime**: process, local filesystem access, spawned tool commands.
- **Run artifacts**: summaries, errors, command/file metadata, progress logs.
- **Control plane endpoints**: HTTP API (`/agents`, `/runs`, `/cleanup`, `/health`) and WS (`/ws`).
- **Credentials/secrets**: API key (`AGENT_SERVER_API_KEY`), panel API key, telegram token.
- **Conversation and interaction state**: in-memory stores for Telegram interactions and conversation history.

## 2) Trust Boundaries
1. **External clients -> HTTP API** (`createApi` middleware/auth/rate-limit).
2. **External clients -> WebSocket** (`/ws` upgrade handler).
3. **Server -> local filesystem** (agent discovery, lockfiles, watched paths).
4. **Server -> external services** (panel telemetry, Telegram Bot API, LLM/provider APIs).
5. **Message routing boundary** (Telegram user content -> agent trigger context).

## 3) Attack Surfaces
- API mutation endpoints: `POST /agents/:id/run`, `POST /runs/:id/cancel`, `POST /cleanup`.
- WebSocket upgrade stream `/ws` and event fanout.
- Agent-triggered execution path from prompt suffix / interaction replies.
- Log and telemetry emission paths that may carry sensitive material.
- Configurable network binding (`host`) and API key enforcement.

## 4) STRIDE Analysis
### S — Spoofing
- Unauthorized API access if key absent and host exposed non-loopback.
- Client identity ambiguity due lack of reliable remote IP in local deployment (`unknown` fallback).
- WebSocket consumer impersonation without auth semantics.

### T — Tampering
- Mutation API calls can trigger/cancel runs; browser-based cross-site requests could tamper with local daemon state.
- Prompt suffix injection can influence execution behavior (partially mitigated by schema+sanitization).

### R — Repudiation
- Limited identity/audit fidelity when IP is unknown and no request IDs/principal IDs.

### I — Information Disclosure
- Runs API and WebSocket can leak operational metadata if exposed.
- Logs may include tokens/secrets (partially mitigated with redaction/sanitization utilities).

### D — Denial of Service
- High request volume and trigger spam (mitigated via in-memory rate limits and max concurrent runs).
- Excess WebSocket clients (mitigated via `maxWebSocketClients`).

### E — Elevation of Privilege
- Triggered agent execution can indirectly run commands/tools with daemon privileges.
- Telegram messages may route to high-privilege agents depending on routing config.

## 5) OWASP-style Sweep Findings (descending severity)

## High
1. **Cross-origin mutation risk on loopback services (CSRF-like)**
   - Browsers can issue cross-site requests to local services; if auth is absent (loopback mode), mutation endpoints were callable from arbitrary origins.
   - **Mitigation implemented**: Origin enforcement for mutation methods (`POST/PUT/PATCH/DELETE` class represented by non-GET/HEAD/OPTIONS) with loopback-safe same-origin logic and explicit 403 rejection.

2. **WebSocket origin trust gap**
   - `/ws` accepted upgrades without origin validation, allowing untrusted pages to open local websocket streams.
   - **Mitigation implemented**: WebSocket origin validation against configured host with loopback-equivalence support; unauthorized origins closed with policy violation.

## Medium
3. **Weak identity telemetry for abuse investigation**
   - IP extraction defaults to `unknown`; hampers abuse correlation in non-proxied mode.
   - **Mitigation suggestion**: optional trusted reverse proxy mode with strict allowlist + structured request IDs.

4. **In-memory-only abuse controls**
   - Rate limit/auth failure counters reset on restart.
   - **Mitigation suggestion**: optional persistent/distributed limiter for network-exposed deployments.

## Low
5. **Security headers baseline could be extended**
   - Current headers are solid for API, but no explicit CORS/COOP/CORP policy decisions documented.
   - **Mitigation suggestion**: explicitly document and enforce CORS policy (default deny).

6. **Operational hardening opportunities**
   - No dedicated auth on websocket channel beyond origin check.
   - **Mitigation suggestion**: require API key during websocket handshake for non-loopback exposures.

## 6) Mitigation Execution Log
1. Added API mutation origin guard with host-aware same-origin/loopback checks and rejection logging.
2. Threaded configured server host into API dependency for deterministic origin validation.
3. Added websocket origin validation and blocked unauthorized upgrade attempts.
4. Added/updated unit tests covering API-origin blocking/allow cases and origin validation helpers.
5. Re-ran targeted and full test suite to verify no regressions.

## 7) Residual Risk
- Agent behavior and tool execution remain high-impact by design; least-privilege runtime and tighter executor policies are still critical.
- For internet-exposed deployment, API key + TLS termination + proxy hardening remain mandatory.
