# Codebase Quality Review (April 12, 2026)

## Overall grade

**A- (8.6/10)**

This codebase is generally strong: clear modular boundaries, strict TypeScript settings, strong test coverage in the server runtime, and meaningful security hardening around API input/output and prompt suffix handling.

The biggest gaps are around operational hardening for production scale (in-memory rate-limit/auth-failure state), consistency in observability, and native app process-management resilience.

## What is working very well

### 1) Strong server-side type discipline and validation

- TypeScript compiler settings are strict (`strict`, `noImplicitAny`, `strictNullChecks`, `noUnusedLocals`, etc.), which materially reduces defect density.
- Agent configuration is validated with Zod and uses explicit bounded constraints (e.g., max lengths, regex constraints, enum constraints).
- File parsing has clear frontmatter/YAML pathways and explicit failure behavior.

### 2) Security posture is above average for an internal orchestration daemon

- API auth uses constant-time comparison (`timingSafeEqual`) with length checks to avoid obvious timing leaks.
- API middleware applies size limits, security headers, request throttling, failed-auth tracking, and same-origin mutation checks.
- Output sanitization/redaction is centralized (`sanitizeText`, `sanitizeStoredRun`, `sanitizeProgressEvent`) and includes common secret/token patterns plus bounded payload sizes.
- Prompt-suffix handling includes sanitization + optional prompt-injection risk detection/strict rejection path.

### 3) Test quality and breadth are excellent on the TypeScript side

- `vitest` suite is comprehensive across platform, server, execution, channels, security, config parsing, and integrations.
- Current run status in this environment: **37 test files, 488 tests, all passing**.

### 4) Architecture is reasonably clean and composable

- Subsystems are separated by concern (`agents`, `execution`, `server`, `reporting`, `interaction`, `channels`, `platform`).
- API assembly is dependency-injected (`createApi(deps)`), making testing/mocking straightforward.
- Runner abstractions (`execute`, `createReporter`) are simple and extensible.

## Main issues and risk areas

### 1) Operational limits are process-local and non-evicting

- Rate limiting and auth-failure tracking are in-memory maps. This is acceptable for local/single-process usage, but weak for distributed deployment and can grow without explicit eviction.
- Recommendation: add bounded/LRU cleanup logic and optional Redis-backed policy when deployed multi-instance.

### 2) Native macOS process management is pragmatic but brittle

- Hard-coded health endpoint/port assumptions and broad fallback search heuristics may cause ambiguous startup behavior.
- Server stdout/stderr are discarded, reducing diagnosability during startup/runtime faults.
- `.env` parser is intentionally simple and does not support richer dotenv edge cases.
- Recommendation: introduce structured app logs for subprocess output, explicit startup timeout diagnostics, and optional strict server-path validation in Settings UX.

### 3) Security controls are good, but could be hardened further

- Current same-origin logic is host-based and intentionally loopback-friendly; still, CSRF-style risk can be reduced further with explicit CSRF token or Origin+Host policy hardening for mutation routes.
- Prompt-injection guard exists for suffix context, but there is no trust-level segmentation for all external sources entering prompts.
- Recommendation: classify input trust tiers and attach policy-level transformations consistently across all ingestion paths.

### 4) Documentation and enforcement mismatch in a few places

- The README is strong, but production-operation guidance (e.g., failure modes, observability, scaling constraints) can be more explicit.
- Recommendation: add a short “Production Readiness” section documenting limits, expected deployment model, and hardening toggles.

## Prescriptive, prioritized change list

## P0 (next 1–2 sprints)

1. **Introduce durable/shared rate limiting option**
   - Add an interface for limiter/failure-tracker backends with in-memory default and Redis implementation option.
   - Add periodic eviction/TTL sweeps for in-memory mode.

2. **Improve subprocess observability in macOS app**
   - Capture server stdout/stderr into rotating files under `~/.agent-server/logs`.
   - Surface last-N startup errors in Settings UI.

3. **Formalize API mutation protection**
   - Keep current origin checks, add optional CSRF token requirement for browser-based clients.
   - Add explicit host allowlist configuration if running behind reverse proxies.

## P1 (following sprint)

4. **Add property/fuzz tests for parser and sanitization boundaries**
   - Focus on frontmatter split edge cases, env-var interpolation, malformed headers, and redaction false-negatives.

5. **Add performance guardrails**
   - Define SLO-ish checks for run-store growth and serialization overhead.
   - Add lightweight benchmark tests around hot paths (`sanitizeText`, run list serialization, websocket progress fanout).

6. **Strengthen native process lifecycle robustness**
   - Add backoff/jitter restart behavior and bounded retry policy.
   - Improve stale-process cleanup strategy with safer ownership checks.

## P2 (continuous improvement)

7. **Increase consistency in inline rationale comments**
   - Keep code concise, but annotate security-critical branches (origin/auth/size-limit decisions) with brief policy rationale.

8. **Operational docs + runbooks**
   - Add docs for incident triage, common startup failures, and recommended deployment topology.

## Suggested target state

If the P0/P1 items are implemented cleanly, this codebase plausibly moves from **A- to A/A+** for its category (local-first orchestration + native companion app), especially due to already strong testing and type-safety foundations.
