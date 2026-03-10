# Security Hardening Log (Secure-Enough-Soon + Additional Fixes)

This document lists 20 concrete security issues identified and fixed in this patch.

1. Added global in-memory API rate limiting to reduce brute-force and abuse.
2. Added dedicated trigger endpoint rate limiting to reduce run-spam abuse.
3. Added auth-failure tracker with temporary lockouts for repeated failed auth.
4. Added auth-failure audit logging with sanitized source/path metadata.
5. Added security response headers (`nosniff`, `DENY`, `no-referrer`, `no-store`).
6. Added request body size guard using `Content-Length` upper bound.
7. Enforced JSON content-type for non-empty `/agents/:id/run` bodies.
8. Sanitized prompt suffix input before forwarding to executor.
9. Added centralized secret redaction utility for API/WebSocket payloads.
10. Redacted run payloads returned by `/runs` and `/runs/:id`.
11. Redacted websocket progress/completion/failure event text fields.
12. Added max concurrent run guard to prevent run-flood resource exhaustion.
13. Added max websocket client guard to prevent websocket fanout DoS.
14. Added structured websocket error logging with sanitized error content.
15. Hardened file watcher setup to skip unreadable paths safely.
16. Added file watcher error listeners to avoid silent watcher failures.
17. Enforced unique agent IDs at discovery time (skip duplicates).
18. Tightened agent and interaction schema validation (lengths/patterns/counts).
19. Hardened Telegram channel ownership (ignore non-linked chat activity).
20. Added memory growth controls in stores (bounded progress history, bounded interaction retention, truncation of oversized run metadata).
21. Added prompt-injection risk scoring for user-provided context in the execution runner.
22. Added untrusted-context prompt envelope with explicit policy boundaries before execution.
23. Added optional strict prompt-injection mode to reject suspicious context before tool execution.

