# Daemon restart loop

- [x] Reproduce the failure with the installed 2.4.1 app.
- [x] Separate update-related graceful stops from the unexpected daemon exit.
- [x] Identify the unhandled Telegram polling rejection.
- [x] Add a failing behavior test for polling failure isolation.
- [x] Keep the HTTP server alive when Telegram polling stops.
- [x] Preserve the polling failure in daemon logs.
- [x] Run focused tests, full tests, lint, type checks, and builds.
- [x] Record verification evidence.

## Review

- Telegram polling rejections are now handled instead of becoming process-level unhandled rejections.
- Polling failure messages flow through `console.error`, which the daemon file logger records.
- Telegram behavior tests pass: 34 tests.
- ESLint, strict TypeScript checking, and the production build pass.
- Full suite result: 680 passed and 3 unrelated watcher tests failed because macOS returned `EMFILE: too many open files, watch`.
