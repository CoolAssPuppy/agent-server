# Technical debt audit

Initial audit: 2026-07-20

Previous repeat audit: 2026-07-21

This repeat audit: 2026-08-13

Scope: TypeScript server, native macOS app, EventKit helper, build and release scripts, CI, dependencies, tests, and user-facing documentation.

## Executive summary

- **Both CI gates on the `build-and-test` job were red before this pass.** `pnpm run audit:prod` exited 1 on sixteen production advisories, and `pnpm run test:coverage` exited 1 because `src/server/server.ts` had fallen to 53.51% branch coverage against its own 55% floor. Neither failure was visible from the July audit, which recorded both as clean.
- The July remediation became the August defect. `pnpm-workspace.yaml` pinned `hono: 4.12.30` as an exact version; four later advisories were fixed in 4.12.34, so the pin held the graph two patches below its own fix. Every override is now a bounded range, and a test rejects exact pins outright.
- Documentation drift is concentrated in `CLAUDE.md`, the file every coding agent in this repo reads as ground truth. It documented two environment variables that the test suite explicitly asserts do nothing, a runtime fallback that no longer exists, a heartbeat default that is wrong by a factor of two, ten HTTP routes where the API has forty-three, and two shipped features listed as future work.
- Three secondary `Map`s leaked entries whose primary record was gone: retry counters in the Panel log driver, and claim tokens in the interaction store. All three share one shape — a keyed side table that no deletion path knew about.
- Type discipline is genuinely clean. Zero `any`, zero `@ts-ignore`, zero `TODO`/`FIXME`, parameterized SQL throughout, sha256 only, no hardcoded secrets. The debt in this codebase is not in its types.
- 16 findings. 15 are fixed and verified in this pass; 1 (god files) is documented and deliberately left open.
- Verified after the fixes: zero production advisories, 1,906 server tests passing, coverage gate green with `server.ts` back to 55.94%, 640 Swift Core tests, 53 release-tooling tests, no circular dependencies, clean type-check, lint, and build.

## Architectural mental model

The repository ships one product through two cooperating runtimes, and my reading of it matches the README and `CLAUDE.md` on structure.

`server-app` is a local Node.js orchestration daemon. Agent YAML and Markdown files are the source of truth. `startServer` is a composition root: it wires discovery, cron schedules, file watches, chat channels, an authenticated Hono API, WebSockets, run lifecycle, executor plugins, SQLite run history, telemetry, and the security services into one process and one shutdown sequence. `macos-app` is the native control plane, talking to that daemon over loopback. `AgentServerEventKit` is a separate JSON-RPC stdio helper exposing Calendar, Reminders, and Contacts. Python release scripts compile and embed the server, notarize the app and DMG, update the Sparkle feed, and publish to R2.

Dependency direction is sound: configuration and discovery feed the composition root, the run lifecycle delegates to executor plugins, reporters normalize external state, and the app consumes the API. Two structural pressures show up in the findings. First, `startServer` and `createApi` have absorbed every new feature for six months — 87 and 60 commits respectively — and are now 1,567 and 1,630 lines, which is where the coverage floor slipped. Second, `CLAUDE.md` is 712 lines of hand-maintained prose describing a system that changed under it; the parts of the environment contract that are generated from code (`platform/environment-reference.ts` into the README) stayed accurate, and the parts maintained by hand did not. That contrast is the most useful thing this audit found.

## Audit evidence

| Check | Before | After |
|---|---|---|
| `pnpm run audit:prod` (CI gate) | **exit 1** — 16 advisories: 5 high, 10 moderate, 1 low | exit 0 — no known vulnerabilities |
| `pnpm run test:coverage` (CI gate) | **exit 1** — `server.ts` branches 53.51% vs 55% floor | exit 0 |
| Server tests | 1,883 passed, 4 skipped | 1,906 passed, 4 skipped |
| Overall coverage (lines) | 87.26% | 87.34% |
| `src/server/server.ts` branches | 198/370 (53.51%) | 207/370 (55.94%) |
| TypeScript strict check | Passed | Passed |
| ESLint | Passed | Passed |
| `tsc` build | Passed | Passed |
| Circular dependencies (madge) | 3 | 0 |
| Swift Core tests | not re-run | 640 passed |
| Release tooling tests | not re-run | 53 passed |
| Dead files (knip) | 1 | 0 |
| `any` / `@ts-ignore` / `TODO` in `src` | 0 | 0 |

The four skipped tests are opt-in installed-runtime conformance checks in `server-app/src/plugins/kimi-code.test.ts`. Their skip status is intentional and is not counted as missing coverage.

## Findings

All sixteen are new since the 2026-07-21 repeat audit. The 46 initial findings and 15 repeat findings from that pass were re-checked by spot inspection and remain resolved; they are not repeated here.

| ID | Category | File:Line | Severity | Effort | Description | Recommendation | Status |
|---|---|---|---|---|---|---|---|
| TD-47 | Dependency debt | `pnpm-workspace.yaml:14` | Critical | S | `hono` was pinned to the exact version `4.12.30`. Four advisories (CORS ReDoS, `memo()` cross-user disclosure, Language-middleware DoS, proxy `Connection` headers) are fixed in `4.12.34`, so the pin was actively holding the graph below its own fix. | Replace exact pins with bounded ranges (`>=4.12.34 <5`) so patches arrive without a human and majors never do. | FIXED |
| TD-48 | Dependency debt | `pnpm-workspace.yaml:10-21` | High | S | `undici` (via `@slack/socket-mode`), `fast-uri` (via `ajv` in the MCP SDK), `ip-address` (via `express-rate-limit` in the MCP SDK), and `@hono/node-server` had no floors at all, carrying 12 further advisories including 4 high. | Add bounded-range floors for each, matching the pattern already used for `body-parser` and `qs`. | FIXED |
| TD-49 | Test debt | `server-app/vitest.config.ts:24`, `src/server/server.ts` | Critical | M | `server.ts` branch coverage was 53.51% against the 55% per-file floor the July audit ratcheted in, so `pnpm run test:coverage` — a CI step — exited 1. Six months of features landed in the composition root without matching tests. | Cover the untested branches with real behavior tests rather than lowering the floor. | FIXED |
| TD-50 | Documentation drift | `CLAUDE.md:543-544` | High | S | Documented `AGENT_SERVER_USE_INSTALLED_CLAUDE` and `AGENT_SERVER_USE_INSTALLED_CODEX` as working opt-outs. `execution/runtime-discovery.ts:75-107` never reads either, and `runtime-discovery.test.ts:79,135` assert by name that they are "the obsolete bundled-runtime opt-out" and are ignored. A user setting them gets silence. | Delete both rows and say plainly that Kimi's toggle is the only one, and why. | FIXED |
| TD-51 | Documentation drift | `CLAUDE.md:188` | High | S | Claimed "Claude checks its opt-out flag", "Codex checks its opt-out flag", and "Claude Code and Codex can fall back to their SDK runtimes". No opt-out flags exist, and both executors throw when the executable is missing (`plugins/claude-code.ts:63-67`, `plugins/codex.ts:59`). | Rewrite the paragraph against the actual resolution order, including the Codex runnability probe, and state that nothing falls back. | FIXED |
| TD-52 | Documentation drift | `CLAUDE.md:554` | Medium | S | Gave `AGENT_SERVER_HEARTBEAT_MS` a default of `60000` with a "1.5x safety buffer" rationale. The real default is `30_000` (`platform/config.ts:48`), which the generated README table states correctly. | Correct the value and the reasoning that was built on it. | FIXED |
| TD-53 | Documentation drift | `CLAUDE.md:703-704` | Medium | S | Listed "Run history and log persistence — runs are stored in-memory and lost on restart" under Future work, contradicting `CLAUDE.md:138`, which documents the shipped SQLite store in detail. "Agent metrics dashboard" was also shipped, at `server/api.ts:1525`. | Delete both delivered items. | FIXED |
| TD-54 | Documentation drift | `CLAUDE.md:380` | Medium | S | Documented 10 HTTP routes. `server/api.ts` registers 43, including everything to do with pairing, connections, services, decisions, metrics, and presentation. | Replace the list with route groups and a pointer to the file, plus the one public route. | FIXED |
| TD-55 | Config debt | `server-app/src/platform/environment-reference.ts:8-48` | Medium | S | The canonical env contract that generates the README omitted `AGENT_SERVER_NATIVE_SERVICE_GRANTS` (`plugins/claude-code.ts:861`, `plugins/codex.ts:122`) and `AGENT_SERVER_EVENTKIT_BIN`. `CLAUDE.md`'s separate hand-kept table omitted 14 variables, including `AGENT_SERVER_API_KEY` and both prompt-injection guards. | Add the missing entries to the reference module, regenerate the README, and rebuild the `CLAUDE.md` table from it. | FIXED |
| TD-56 | Resource hygiene | `logging/panel-log-destination.ts:141-145` | Medium | S | `shutdown()` set `isStopped` *after* awaiting the final flush. A `write()` landing during that await passed the guard and called `startTimer()`, re-arming the 5-second interval that `stopTimer()` had just cleared. Nothing cleared it again, so the driver kept posting to Panel after shutdown. | Close admission before flushing, not after. | FIXED |
| TD-57 | Resource hygiene | `logging/panel-log-destination.ts:195-205,264-271` | Medium | S | A retried batch goes back at the head of the queue, which is the end `trimQueue` drops first, so a run under capacity pressure can lose every entry it was waiting to resend. Its `retries` counter then sat in the map forever, because only a run still in the queue is ever revisited. The 401 path cleared the queue but not the counters. | Prune retry state for runs with nothing queued after each delivery pass, and clear it outright when the credential is refused. | FIXED |
| TD-58 | Resource hygiene | `interaction/store.ts:149-151,137-143` | Medium | S | Capacity eviction and the stale sweep delete straight out of the interactions map. A claimed interaction also holds an entry in `claimTokens`, which neither path knew about, so every claimed interaction that was evicted or swept left a token behind permanently. Memory only — a token cannot be redeemed without its interaction. | Drop orphaned tokens after both deletion paths; make the cap injectable so the eviction case is testable. | FIXED |
| TD-59 | Architectural decay | `reporting/store.ts:1`, `server/security-utils.ts:1`, `logging/log-read-tool.ts:5` | Low | S | Three circular dependencies. Each is a shared type living in the module that consumes it: `StoredRun`, `ProgressEvent`, `LogToolContext`. All type-only in one direction, so erased at runtime, but they make the modules impossible to reason about separately. | Extract each type into its own module and re-export for compatibility, the pattern `documents/tool-name.ts` already uses. | FIXED |
| TD-60 | Dead code | `server-app/scripts/migrate-runtime-neutral-agents.ts:1-254` | Low | S | A one-off migration script with zero references anywhere in the repo, carrying a hardcoded personal absolute path (`/Users/prashant/Developer/brain/agents/agents`) as its default. `tasks/runtime-neutral-agent-migration-report.md` records the migration as applied and verified. | Delete it; git holds it if it is ever needed again. | FIXED |
| TD-61 | Architectural decay | `server/api.ts:1`, `server/server.ts:1`, `agents/capabilities.ts:1`, `plugins/claude-code.ts:1` | Medium | L | Four files exceed the project's own 500-line rule in `CLAUDE.md`: 1,630, 1,567, 1,028, and 872 lines. The two largest are also the two highest-churn files in the repo, and are where TD-49 came from. | Extract route groups from `api.ts` into registrar modules and the channel and trigger wiring out of `server.ts`. See "Open questions" — deliberately not done in this pass. | OPEN |
| TD-62 | Test debt | `dependency-and-ci-policy.test.ts:62` | Medium | S | The regression test guarding advisory floors asserted `hono >= 4.12.25`, below the 4.12.34 the advisories require, and covered only `ws` and `hono`. It passed throughout the window in which the audit was failing. | Table-drive the test from every package with a floor, assert each against its real floor, and fail the build on any exact override. | FIXED |

## Top 5: if you fix nothing else, fix these

All five are fixed in this pass. They are ranked by what they cost if left.

### 1. TD-47 / TD-48 — CI's dependency gate was failing, and a pin was the cause

`pnpm run audit:prod` runs `pnpm audit --prod --audit-level high` and exited 1 on five high advisories. The root cause is worth more than the individual bumps: an exact override is a floor that stops rising the moment it is written.

```diff
 overrides:
-  hono: 4.12.30
-  ws: 8.21.0
-  body-parser: 2.3.0
-  qs: 6.15.2
+  hono: '>=4.12.34 <5'
+  '@hono/node-server': '>=1.19.15 <2'
+  ws: '>=8.21.0 <9'
+  body-parser: '>=2.3.0 <3'
+  qs: '>=6.15.2 <7'
+  fast-uri: '>=3.1.5 <4'
+  ip-address: '>=10.3.1 <11'
+  undici: '>=7.29.0 <8'
```

Every resolved version still satisfies the repository's seven-day `minimumReleaseAge` quarantine. `dependency-and-ci-policy.test.ts` now fails the build on any exact override, so this specific rot cannot recur silently.

### 2. TD-49 — the coverage gate was failing on the composition root

`src/server/server.ts` reached 53.51% branch coverage against a 55% floor. The fix is six behavior tests against real uncovered paths, not a lowered floor:

- a chat reply naming an interaction this process is not holding (a button tap surviving a daemon restart)
- a reply that spends its interaction but carries no text, which must not start the follow-up agent on an empty prompt
- chat messages arriving before anyone has messaged the bot, so there is no chat id to answer
- an agent's own `timeout` overriding the server default
- `AGENT_SERVER_RUN_TIMEOUT_MS=0` meaning no ceiling at all
- shutdown reporting one failed resource as itself, and more than one as an `AggregateError`

That is 198 → 207 covered branches, 55.94%, with real margin over the floor.

### 3. TD-50 / TD-51 — `CLAUDE.md` documented behavior the tests deny

This is the highest-value documentation finding because of who reads the file. `runtime-discovery.test.ts` contains two tests literally named `ignores the obsolete bundled-runtime opt-out`, while `CLAUDE.md` told the reader those variables control runtime selection. The same paragraph promised an SDK fallback that was replaced by a hard failure:

```typescript
// plugins/claude-code.ts:63
if (extra && Object.hasOwn(extra, 'claudeExecutablePath') && !extra.claudeExecutablePath) {
  throw new Error('Claude Code is not installed. Install Claude Code or choose another coding agent.');
}
```

### 4. TD-56 / TD-57 / TD-58 — three side tables nobody cleaned

One shape, three places: a `Map` keyed by another `Map`'s key, where only some deletion paths knew about both. The shutdown ordering bug is the sharpest of them, because the window is a real one:

```diff
 async shutdown(): Promise<void> {
-  this.stopTimer();
-  await this.flush();
-  this.isStopped = true;
+  this.isStopped = true;
+  this.stopTimer();
+  await this.flush();
 }
```

`write()` and `startTimer()` both read `isStopped`. Setting it last meant a log line written during the awaited flush re-armed the interval that had just been cleared, and the driver went on posting to Panel after the server had stopped. Each of the three fixes is covered by a test verified to fail before it.

### 5. TD-62 — the test that should have caught TD-47 was set below the requirement

`expect(honoVersions.every((v) => isAtLeast(v, [4, 12, 25])))` passed happily while the audit failed on 4.12.30. A floor written once and never revisited is the same failure mode as the pin it was guarding. It is now table-driven from every package that has a floor, and asserts the shape of the override as well as the resolved version.

## Quick wins

All complete.

- [x] TD-47 — convert `hono` from an exact pin to a bounded range at the patched floor
- [x] TD-48 — add floors for `undici`, `fast-uri`, `ip-address`, `@hono/node-server`
- [x] TD-52 — correct the `AGENT_SERVER_HEARTBEAT_MS` default from 60000 to 30000
- [x] TD-53 — delete two shipped features from the Future work list
- [x] TD-55 — add the two missing variables to the canonical env reference and regenerate the README
- [x] TD-59 — extract `StoredRun`, `ProgressEvent`, and `LogToolContext` into their own modules
- [x] TD-60 — delete the spent migration script and the personal absolute path with it

## Things that look bad but are actually fine

- **`console.log` on 20 lines of `server.ts` and the channels.** This looks like debug output left in production, and the project rules ban committing `console.log`. It is the daemon's operator log: the process runs under launchd, which captures stdout into the log file the macOS app reads. Agent-authored logs go through `AgentLogger` and its drivers; these lines are server lifecycle, addressed to whoever is reading the daemon's output. Replacing them with a logging framework would add a dependency to reproduce what launchd already does.
- **`documents/zip.ts:35` trusting `uncompressedSize` from the central directory.** A malicious archive can lie in that field, and the size check reads like the only defense against a zip bomb. It is not: `readEntryData` passes `maxOutputLength: maxBytes` to `inflateRawSync`, which is enforced by zlib against actual output. The header check is an early exit, not the bound.
- **`agents/capabilities.ts` at 1,028 lines.** Over the 500-line rule, but roughly 700 of those lines are `CAPABILITY_CATALOG`, a declarative table of services and the tools they map to. Splitting a data table across files to satisfy a line count makes it harder to read, not easier. Only the derivation logic below it would benefit, and it is already under 300 lines.
- **`execFileSync` in `runtime-discovery.ts:49,58`.** Synchronous subprocess calls, including a `--version` probe of every Codex candidate, which looks like blocking I/O on a hot path. `discoverRuntimePaths` runs once at startup before the HTTP listener is bound. Making it async would spread `await` through the composition root to save milliseconds nobody is waiting on.
- **129 "unused exported types" from knip.** Almost all are re-exported through `src/index.ts`, which is a deliberate library barrel — the package declares `"main": "dist/index.js"` and `"types": "dist/index.d.ts"`. Knip has no configuration here, so it cannot tell a public API from dead code. The one genuine finding in its report was the unused *file* (TD-60).
- **The new leak tests reach into private maps via bracket access.** This violates the repository's own rule about testing behavior rather than implementation. A leaked claim token is unreachable through the public API by construction — that is exactly why it is only a memory problem — so the alternative was leaving three real leaks uncovered. The tests carry a comment saying so.
- **`AGENT_SERVER_VERSION` is absent from the environment reference.** It reads like the last gap after TD-55, but it is not an environment variable: it is an exported constant in `version.ts` read from `package.json`. Nothing reads it from `process.env`.

## Open questions for the maintainer

1. **TD-61, the god files — how do you want this sequenced?** `api.ts` (1,630 lines, 43 routes) and `server.ts` (1,567 lines) both break the project's 500-line rule, and `server.ts` is where the coverage floor slipped. I did not decompose them in this pass: they are the two highest-churn files in the repository, a split touches every route or every wiring path at once, and the risk of a quiet regression is real even with 1,906 tests behind it. The scoped version I would suggest is extracting `api.ts` route groups into registrar modules one group at a time — connections and connection profiles first, since they are 9 routes with almost no coupling to the rest — each as its own commit. Say the word and I will start there.
2. **Should `CLAUDE.md`'s environment table be generated?** The generated README table stayed accurate for six months; the hand-maintained `CLAUDE.md` table drifted by 14 variables and one wrong default. `scripts/generate-environment-reference.ts` already knows how to rewrite a table between markers in a file. Pointing it at `CLAUDE.md` as well would make this class of drift structurally impossible, at the cost of one more generated region in a file people hand-edit.
3. **Is a documentation-drift check worth a CI step?** The three checks that found TD-50 through TD-54 are all mechanical: every `AGENT_SERVER_*` string in `src` appears in the reference module, every route registered in `api.ts` appears in the docs, and every documented environment variable is read somewhere outside a test. Each is maybe 30 lines of test. The judgment call is whether that ossifies prose you want to keep editing freely.
4. **Was the per-file coverage floor for `server.ts` meant to ratchet automatically?** It was set from a verified baseline in July and the file drifted under it. A floor that only moves when someone remembers to move it has the same failure mode as TD-47's pin and TD-62's stale assertion — that is three instances of one pattern in this audit.
5. **`AGENT_SERVER_TEST_KIMI` is read only by `plugins/kimi-code.test.ts:53,73,99,123`,** and is correctly absent from the user-facing reference. If the drift checks in question 3 happen, it needs to be skipped. The `AGENT_SERVER_TEST_*` prefix already there would let them skip it by rule rather than by a named exception — worth making that convention explicit?
