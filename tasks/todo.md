# Agent definition toggle and visibility fixes

- [x] Capture the current failures with focused behavior tests before production changes.
- [x] Add a lossless, atomic frontmatter enabled-value editor that rejects malformed or ambiguous input.
- [x] Cover LF, CRLF, no final newline, multiline YAML, comments, repeated toggles, and file isolation.
- [x] Make every local agent visible regardless of schedule and label watch-only and on-demand agents correctly.
- [x] Keep watch-only agents in `/agents` and panel catalog sync without synthetic cron or `next_run_at` values.
- [x] Refresh agent state after definition changes, toggles, daemon restart, and catalog sync, including recovery from an empty snapshot.
- [x] Add an integration test for toggle, definition reload, catalog sync, app restart, and retained visibility.
- [x] Run focused tests, full tests, lint, type checks, and builds for the server and macOS app.
- [x] Review the diff for narrow scope and document root causes and verification evidence.
- [x] Commit the fixes, merge to `main`, push, then release the next patch version with `- Bug fixes` and push release changes.

## Review

- Red tests failed before implementation because the lossless file editor and schedule-independent presentation did not exist.
- All 115 Swift behavior tests pass, including the new toggle, boundary, and trigger presentation coverage.
- The new server catalog integration test and focused `/agents` and panel sync tests pass.
- ESLint, strict TypeScript checking, the server build, and the native Xcode Debug build pass.
- The full server suite ran 686 tests: 683 passed and 3 existing filesystem watcher tests failed because macOS returned `EMFILE: too many open files, watch`, including with one worker and a 1,048,575 descriptor limit.
- No MCP permissions, executors, schedules, prompts, or agent IDs changed.
