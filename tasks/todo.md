# Codex executor implementation

- [x] Inspect the executor architecture and verify the supported OpenAI integration paths.
- [x] Add behavior tests for provider selection and Codex SDK event mapping.
- [x] Implement the Codex SDK executor using the existing ChatGPT login.
- [x] Register and validate `codex` alongside `claude-code`.
- [x] Update exports, examples, and authentication documentation.
- [x] Run focused tests, the full test suite, type checking, lint, and build.
- [x] Attempt a local subscription-backed smoke test.

## Design decision

- Use `@openai/codex-sdk` for scheduled and on-demand agent runs.
- Keep `claude-code` as the default executor for backward compatibility.
- Select Codex per agent with `executor: codex`.
- Reuse credentials created by `codex login`; never require or inject `OPENAI_API_KEY`.
- Reject unsupported provider-specific settings instead of silently weakening them.

## Review

- Added the official `@openai/codex-sdk` and used its pinned Codex runtime.
- Added `executor: codex` validation while preserving `claude-code` as the default.
- Added streamed progress, tool, file, usage, interaction, cancellation, and failure mapping.
- Removed `OPENAI_API_KEY` from the Codex runtime environment so runs use the existing `codex login` session.
- Passed credential-free agent-level MCP declarations as per-run Codex SDK configuration.
- Restricted the Codex child environment to runtime-safe variables and disabled network and web search by default.
- Rejected secret-bearing agent MCP declarations until token-backed adapters are available.
- Focused Codex, config, and registry tests pass: 67 tests.
- ESLint, strict TypeScript, and the production build pass.
- Full suite result: 678 passed and 3 unrelated file-watcher tests failed because the environment returned `EMFILE: too many open files, watch`.
- The read-only subscription-backed smoke test returned `CODEX_SUBSCRIPTION_OK`.
