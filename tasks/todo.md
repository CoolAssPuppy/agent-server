# Agent Server v2 plan

Local-first personal agent runner, powered by the user's own Claude and Codex
subscriptions, simple enough for a non-technical person, safe enough to trust.

## What v2 is

A menu bar app and local server that runs scheduled AI agents on your Mac. No
cloud service, no account. Agents are plain markdown files. You choose, per
agent and in plain language, what it can touch and when it runs. It uses the
Claude and Codex subscriptions you already pay for, and can drive custom models
like Kimi K2. The format supports arbitrarily complex agents; the default path
is dead simple.

## Design principles

- Local-first. Everything runs on localhost. No external dependency to function.
- The markdown file is the source of truth. The UI shapes it; it never becomes
  a second source of truth. Full round-trip fidelity, including complex files.
- Default-deny safety. An agent can do nothing until you grant it, in plain
  language, one capability at a time. Every grant is reversible.
- Your subscription, your models. Claude and Codex run on your existing logins.
  Custom providers plug in without touching agent files (keys live in `.env`).
- Simple by default, powerful when needed. Grandma can create an agent; a power
  user can hand-write a 200-line one and it still works.

## Where we are today (verified)

- Consumer UI (detail drawer, gear editor, capability toggles, New Agent flow)
  exists on branch `claude/mack-consumer-ux-hpapsp` (PR #15). New Agent dialog
  just redesigned; not yet landed.
- Capability model is solid: toggles map to tools/disallowed_tools/mcp_servers,
  disabling never deletes, every toggle reversible, secrets only in `.env` as
  `${VAR}`. 747 server tests, 123 Swift tests pass.
- Subscriptions already work: `cli.ts` strips `ANTHROPIC_API_KEY` so Claude uses
  the subscription login; Codex uses the existing ChatGPT login.
- Panel is already optional: noop reporter when no panel URL. A standalone server
  does zero syncing.

## Gaps that block the vision

- Runtimes are bundled, not the user's install (`pathToClaudeCodeExecutable` /
  `codexPathOverride` unused).
- `agent.model` is not wired into the Claude path (Codex wires it). Blocks custom
  models on Claude.
- Run history is in-memory and seeded from the panel. Losing the panel loses
  history unless we persist locally.
- Panel code is threaded through ~20 server files and ~12 macOS files.

---

## Phase 0 — Land the base (days)

- [ ] Finish and verify the New Agent dialog redesign in the running app.
- [ ] Fix the Claude model gap: wire `agent.model` into `Options.model` in
      `plugins/claude-code.ts` (+ colocated test). Unblocks Phase 2.
- [ ] Land PR #15.

## Phase 1 — Local-first: retire the panel (1-2 weeks)

- [x] Add local run persistence. DONE via SQLite using Node's built-in
      `node:sqlite` (not better-sqlite3) — zero native dependency, so nothing to
      compile or code-sign inside the macOS app bundle. `SqliteRunStore`
      (`reporting/sqlite-store.ts`) is a drop-in for the in-memory `RunStore`
      behind a shared `RunStoreLike` interface; both share
      `run-normalization.ts`. Default db: `~/.agent-server/runs.db`
      (`AGENT_SERVER_RUN_DB`, `:memory:` for ephemeral). Opens with a graceful
      fallback to in-memory if the file is unusable. Verified: a fresh server
      process serves runs persisted before boot, with no panel dependency.
- [x] Local run history no longer depends on the panel. The server already
      writes run state directly into the store (the `Reporter` remains the
      optional panel-telemetry seam); making that store durable is the cleaner
      equivalent of a "local reporter" and keeps every downstream caller
      unchanged via `RunStoreLike`. Seeding from the panel still works but is now
      redundant — removed in the next step.
- [ ] Remove panel paths: `reporter.ts` HTTP telemetry, `sync-schedule.ts`,
      `panel-client.ts`, `realtime-client.ts`, `seed-run-store.ts`. Keep the
      registry seams; delete the wiring.
- [ ] Move decisions/interactions fully local (they partly ride Supabase realtime
      today). Route through the local server + channels.
- [ ] Ghost-run cleanup becomes purely local (server owns its runs; no panel).
- [ ] macOS: point run history at local `/runs`; delete `PanelClient`,
      `PanelRun`, panel cleanup UI. Keep the local `/cleanup`.
- [ ] Drop panel env vars from config/docs. Result: zero cloud dependency.

## Phase 2 — Multi-runtime, subscriptions, custom models (1-2 weeks)

- [ ] Discover the user's installed binaries (`which claude`,
      `~/.claude/local/claude`; `which codex`) with fallback to bundled.
- [ ] Wire `pathToClaudeCodeExecutable` and `codexPathOverride`; add a "Use my
      installed Claude / Codex" setting, auto-detected and on by default when found.
- [ ] Provider/model abstraction. A per-agent model choice resolves to one of:
      Claude (subscription), Codex (ChatGPT), or a custom Anthropic-/OpenAI-
      compatible endpoint. Keys stay `${VAR}` in `.env`.
- [ ] Custom models: Codex via `baseUrl`+`apiKey` (Kimi's OpenAI-compatible
      endpoint, model `kimi-k2`); Claude via per-agent `ANTHROPIC_BASE_URL`+key
      (Kimi's Anthropic-compatible endpoint). Handle the API-key-strip conflict
      per agent.
- [ ] UI: a simple per-agent Model dropdown ("Claude (your plan)", "Codex (your
      ChatGPT)", "Kimi K2", "Custom..."). Plumbing hidden.
- [ ] Verify: tool permissions (allow/deny/canUseTool) are enforced regardless of
      provider. This is a safety gate, not a nice-to-have.

## Phase 2.5 — Connections and auth: API key, MCP, OAuth all first-class (1-2 weeks)

A service an agent needs may authenticate any of three ways. All are supported,
and the Connect flow adapts to whichever the service uses. Secrets and tokens
never land in agent files; agent files only hold `${VAR}` references and URLs.

- [ ] Make the auth model explicit on each connection: `auth: none | api_key |
      oauth`. Drives which Connect UI shows.
- [ ] Service catalog stays single-source on the server. Extend each
      `CAPABILITY_CATALOG` entry (served via `GET /capabilities`) with the `auth`
      model and OPTIONAL OAuth hints (scopes, discovery-URL override) for the rare
      service that needs them. The app consumes this list; it does NOT keep a
      second catalog.
- [ ] Generic, discovery-driven OAuth engine in the app (not per-service config):
      given a service's MCP URL, follow the MCP OAuth discovery chain
      (`WWW-Authenticate` -> `.well-known/oauth-protected-resource` -> auth-server
      metadata -> dynamic client registration -> auth-code + PKCE). Same engine
      handles every `oauth` service.
- [ ] Connections screen in the app: list catalog services with Connect /
      Disconnect / reconnect and live status, backed by the catalog + Keychain.
- [ ] API key: the existing flow. One or more keyed fields, saved to `.env`.
      Already works; formalize and keep.
- [ ] Generic MCP: a UI to ADD a bring-your-own MCP server (stdio command, or
      http/sse URL, with optional API-key header), not just hand-edit. Custom
      connections already surface for display; add the create path.
- [ ] OAuth, interactive: a "Connect with browser" action in the macOS app
      (ASWebAuthenticationSession) that runs dynamic client registration + auth
      code + PKCE against the service's advertised endpoints, and captures the
      access + refresh tokens.
- [ ] OAuth is authenticated inside the macOS app and the tokens are stored in
      the app's Keychain. DECIDED: the app owns the whole flow (runtime-independent),
      not a reuse of Claude Code's cache. One-time in-app sign-in; access + refresh
      tokens saved to Keychain; the app refreshes them.
- [ ] Token delivery to the server (open implementation detail): the Node server
      is spawned by the app and needs the CURRENT bearer at run time, but tokens
      refresh mid-life so a static spawn-time env var is not enough. Options to
      settle in this phase: (a) the app injects/re-injects tokens on refresh via a
      local control channel, or (b) a tiny app-hosted local token broker the MCP
      request path reads a fresh bearer from. Agent files keep only URLs, never tokens.
- [ ] Keychain is the store for OAuth tokens; `.env` stays for static API keys.
- [ ] Re-auth UX: when a token expires and can't refresh, surface a "reconnect"
      prompt (the `needs-auth` signal already exists end-to-end).

## Phase 3 — Grandma-grade simplicity and safety (1-2 weeks)

- [ ] Template library: `init --template` plus in-UI "Start from a template"
      (daily summary, inbox triage, PR reviewer, calendar brief). Real future-work
      item.
- [ ] First-launch onboarding: connect Claude/Codex, create the first agent from
      a template, in under two minutes.
- [ ] Plain-language capability summary on the agent page ("This agent can read
      your files and check your calendar. It cannot run commands or send email.").
- [ ] First-run confirmation and/or dry-run preview: show what an agent will do
      before it acts. This is what makes it safe to hand to a non-technical person.
- [ ] Approval mode for sensitive actions using the existing human-in-the-loop
      interaction system.
- [ ] Audit every consumer screen against "simple + confident"; tokenize the
      remaining hardcoded styles in SettingsDrawer/MenuBarPopover.

## Phase 4 — Trust, polish, ship (ongoing)

- [ ] Local metrics: per-agent success/failure, duration, token/cost, last run.
- [ ] Reliability hardening: crash recovery, lock hygiene, sleep/wake catch-up
      (exists), timeout coverage (exists).
- [ ] Signed + notarized release, Sparkle auto-update (integrated), docs and a
      short "make your first agent" guide.
- [ ] Consider: cross-platform later (server is Node; app is macOS-only).

---

## Decisions to confirm before building

1. Run persistence: SQLite (recommended) or flat files?
2. Agent Panel: retire the repo entirely, or keep it alive as an optional,
   separately-installed dashboard that a power user can point the server at?
3. Telegram/console channels: keep as-is, or fold notifications/approvals into
   the macOS app so there is one surface?
4. Custom-model priority: is Kimi K2 the first target, and via Codex (fastest to
   ship) or Claude (needs the model-wiring + base-url work)?

## Risks and unknowns to check early

- Subscription terms for automated/scheduled use, and whether background runs hit
  different rate limits than interactive use. Verify before we lean on it hard.
- Headless OAuth for hosted MCP servers (e.g. Linear): a background agent can't do
  an interactive browser sign-in. Solved in Phase 2.5 via a one-time in-app sign-in
  plus cached/refreshed tokens (reuse Claude Code's cache or our Keychain store).
- Custom-provider parity: Kimi and other models may not support every Claude Code
  tool-use feature identically. Test tool-calling and permissions per provider.
- Bundling vs user install: version skew between the user's CLI and our expected
  stream format. Pin a minimum and detect.
```
