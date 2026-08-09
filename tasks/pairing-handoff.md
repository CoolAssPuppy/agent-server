# Handoff: finish device pairing

Four jobs. The first is the real one; the rest are small and independent.

## Repos

- `~/Developer/saas-apps/agents/agent-server` (daemon + macOS app), on `main`, released at **3.7.1**
- `~/Developer/saas-apps/agents/agent-panel` (Next.js + Supabase), on `main`
- Production Supabase project ref: `hlwjnusdotqtmtwrjidu`
- Panel production URL: `https://www.agentpanel.dev`

## Already true, do not redo

- Pairing works from the CLI. `node "/Applications/Agent Server.app/Contents/Resources/dist/cli.js" pair <CODE>` succeeded on the home server and produced a `machines` row: `Prashants-MacBook-Home-Server.local`, active, server_version 3.7.1, protocol 2.
- The credential is written to `~/.agent-server/panel-credential.json` (0600) and `loadConfig` prefers it over `AGENT_SERVER_PANEL_API_KEY`.
- Panel's `/api/machines/register` never returns 404. Bad code is 401, bad payload 400, redeem failure 500.
- Inbound routing already works without a paired device: `inbound_routes.target_machine_id` is nullable and the route form lists every active agent.

---

## 1. Agents never attach to a machine, and a device is never "seen"

This is why Panel says **"Paired, but it has not checked in yet. 0 agents · last heard from never"**.

**Evidence.**

- `server-app/src/reporting/sync-schedule.ts` posts to `/api/agents/sync` with `buildAgentSyncPayload` (v1). `buildV2AssistantSyncPayload` in `server-app/src/reporting/v2-assistant-sync.ts` exists, is exported from `index.ts`, is fully tested, and **is called by nothing**.
- Panel's `web/app/api/agents/sync/route.ts` authenticates with `validateApiKey` (org level) and reconciles under `legacyScope()`, which is the explicit "no machine" bucket. No route accepts `AgentSyncV2PayloadSchema`, although `reconcileCatalog` in `web/lib/status/machine-sync.ts` already supports a machine scope.
- `machines.last_seen_at` is written in exactly one place, inside `authorizeMachineRequest` (`web/lib/auth/api-keys.ts`). Only `commands/claim` and `commands/[id]/report` use it, and the daemon calls neither.

**What to build.**

- Daemon: when a pairing record exists, send the v2 payload including `machine_id`. The builder is already there.
- Panel: accept a v2 payload on the sync route, authenticated with `authorizeMachineRequest`, reconciled under the machine's scope. That auth path also stamps `last_seen_at`, so the sync becomes the check-in and no separate heartbeat is needed.
- Keep the v1 path working unchanged. Unpaired daemons must keep syncing exactly as they do now.
- Existing agents have `machine_id = NULL` and should attach on the first v2 sync rather than being duplicated. Watch the `(org_id, slug)` partial unique index on legacy rows; `reconcileCatalog` matches by hand for that reason.

**Done when:** Panel's Devices screen shows the machine with a non-null last seen and a non-zero agent count, verified against production.

---

## 2. Pairing field text is invisible

`macos-app/AgentServer/Views/SettingsPairingSection.swift` uses `.textFieldStyle(.roundedBorder)` and never sets a foreground colour, so a pasted code renders blank.

Every other field in the app sets it explicitly. See `environmentFieldStyle` in `Views/EnvironmentSettingsCard.swift:216`, which sets `.foregroundStyle(theme.tokens.foreground)` over a themed background. Match that treatment.

---

## 3. Pairing dialog reports raw HTTP codes

The whole 404 hunt happened because the dialog said "HTTP error 404" and nothing else.

`macos-app/AgentServer/Services/AgentServerClient.swift`, `validateWriteResponse`, falls back to `ClientError.httpError(statusCode:)` when the body will not decode as `AgentWriteErrorBody`. Hono's own not-found returns plain text, so a missing route surfaces as a bare status.

Make the pairing path say something a person can act on: an unreachable or stale local daemon should read as "Agent Server is not responding on this machine. Restart it", not as a status code. The daemon side already writes good sentences; the app throws them away.

---

## 4. Panel: the pairing code should copy on click

`web/app/components/settings/devices-view.tsx` renders the 8-character code as plain text. There is already a component for this: `web/app/components/inbound/copyable.tsx` exports `Copyable`, which makes the whole block a button with a tick that clears itself. Reuse it, or lift it somewhere shared.

---

## Verification

Run all of these before releasing.

```bash
# agent-server
cd ~/Developer/saas-apps/agents/agent-server/server-app
pnpm run lint && pnpm run type-check && pnpm exec vitest run   # 1746 passing
cd ../macos-app && xcodegen generate
xcodebuild -project AgentServer.xcodeproj -scheme AgentServer \
  -configuration Debug -destination 'platform=macOS' build CODE_SIGNING_ALLOWED=NO
cd AgentServerSwiftTests && swift test

# agent-panel
cd ~/Developer/saas-apps/agents/agent-panel
doppler run -- supabase db reset      # applies migrations from scratch
cd web
INBOUND_CREDENTIAL_KEY=$(doppler secrets get INBOUND_CREDENTIAL_KEY --project agent-panel --config dev --plain) \
  pnpm exec vitest run                # 735 passing
pnpm exec tsc --noEmit && pnpm exec eslint app lib components && pnpm exec next build
```

Integration tests need a dev server. Start one on **3100**, not 3000, and never run `next build` against a live dev server: it clobbers `.next` and produces failures that look like real ones.

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local anon key from supabase start> \
SB_SECRET_KEY=<local service key> \
doppler run --preserve-env -- pnpm exec next dev -p 3100
# then, with NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100
pnpm exec vitest run __tests__/integration/
```

After a Panel migration, regenerate types and keep the nine-line header:

```bash
doppler run -- supabase gen types typescript --local > /tmp/t.ts
head -9 web/lib/supabase/database.types.ts > /tmp/h && cat /tmp/h /tmp/t.ts > web/lib/supabase/database.types.ts
```

## Releasing Agent Server

```bash
./scripts/release.sh 3.7.2 "<li>...</li>"
```

Takes about 10 minutes, so run it in the background. Notarization uses a dedicated keychain at `~/Library/Keychains/agent-server-notary.keychain-db`, unlocked from Doppler `NOTARY_KEYCHAIN_PASSWORD`; this is already set up. Commit `project.yml` and `dist/appcast.xml` afterwards.

Panel deploys on push to `main`. `production.yml` runs migrations and Vercel deploys separately. `ios-ci.yml` has failed at 0s since 2 August and is unrelated.

## Conventions

- Plain English everywhere, including code comments and commit messages. No emdashes, no emoji, sentence case headings.
- Comments explain why, never what. Files under 300 lines where practical.
- Tests describe behaviour, not implementation, and say why the behaviour matters.
- Do not rename anything in the wire contract shared with the daemon (`AgentSyncPayloadSchema`, `assistants:sync` scope, `assistant_id`). User-facing copy says "agents"; the protocol keeps its own names until both sides are versioned together.

## Outstanding, unrelated

- `AGENT_SERVER_PANEL_API_KEY` in `~/.agent-server/.env` on the home server was printed in full during debugging and should be rotated. It also becomes redundant once pairing is in use.
- Free-plan retention deletes 100 runs belonging to two free users on its first nightly sweep at 03:10. Intended, already shipped.
