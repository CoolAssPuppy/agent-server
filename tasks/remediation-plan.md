# Remediation plan

Written 2026-08-10 after a week of bugs found by the user instead of by tests.

## What the analysis found

The bugs are not random. Sixty five thousand lines of server code, 45 HTTP
routes, and one pattern behind almost every defect the user has hit.

### Root cause 1: the server decides things silently

The server has 101 `console.warn` / `console.error` sites and one broadcast
to the app. When something goes wrong, it tells the terminal. Nobody is
looking at the terminal.

Confirmed cases of this class:

- Security gate refused the manuscript agent for two days. One log line.
  Fixed 2026-08-10 (`a797f6f`): verdict now in the API and the sidebar.
- Pairing wrote a credential and had no way to say so. Fixed 2026-08-10
  (`60d0bf2`): `GET /pair` plus a status line in Settings.
- Panel telemetry got 401 on every event for hours (superseded credential).
  Runs were invisible in Panel the whole time. Still invisible in the app.
  Open.
- A skipped run is announced to the app as `run_failed`, so the notification
  says "failed" for an agent that was withheld. Open.
- "Skipped, already running" (lock contention) prints to the CLI only. Open.

### Root cause 2: two codebases, one wire format, zero contract tests

The server writes snake_case JSON. Every Swift model hand-writes its
`CodingKeys`. Nothing checks they match, so a mismatch ships and fails at
runtime on the user's machine.

Confirmed cases:

- `PairingResponse` expected `displayName`, server sent `display_name`.
  Pairing worked and then reported "The data couldn't be read." Fixed in
  3.7.3.
- Two routes (`/agents/:id/run`, its safe-test twin) send camelCase while
  everything else sends snake_case. They decode today by accident of
  matching, and they are the trap the next model falls into.

### Root cause 3: assumptions about the machine

Code that works on the machine it was written on and breaks on the next one.

Confirmed cases:

- `config.test.ts` read the real `~/.agent-server`, so pairing this Mac broke
  two tests and printed the live credential into test output. Fixed
  (`31af3dd`), but only for that one file; nothing stops the next test from
  doing it.
- The release script assumed a full Xcode selection and stored notary
  credentials. Both failed on this Mac. Fixed in 3.7.4 (self-selects Xcode,
  checks credentials in preflight).
- `AGENT_SERVER_LOCATION` pointed the app at a stale checkout for two days.
  The only symptom was a wrong error message. Message fixed in 3.7.4; the
  class is not: the app never compares its own version against the server it
  is talking to.

## The plan

Ordered by how much user pain each step removes. Each step is small and
shippable on its own.

### Phase 1: nothing fails silently

- [ ] 1. Fix the mislabeled notification: a security skip arrives as
      `run_failed` and banners as "failed". Send `run_skipped` with the
      reason and give it its own wording and the info chime.
- [ ] 2. Panel connection health. The reporter records last success and last
      auth failure. Expose it on `/health`, show it in Settings, and notify
      once when reporting starts failing. This would have caught the 401
      storm and the stale-credential window.
- [ ] 3. Version skew banner. `/health` already returns the server version.
      The app compares it to its bundled version and shows one line in
      Settings when they differ. Kills the whole stale-server class,
      not just the pairing symptom.
- [ ] 4. Sweep the remaining warn-only decisions (lock contention, catch-up
      skips, watcher debounce drops, trigger depth cap) and route each one
      to the run history as a skipped run with a reason, the way security
      skips already are.

### Phase 2: the wire format cannot drift again

- [ ] 5. Golden fixtures. A server test renders every route's real JSON into
      checked-in fixture files. A Swift test decodes every fixture with the
      real app models. A field rename on either side fails CI instead of
      failing on the user's Mac. Agent Panel already does this for the sync
      payload; copy that pattern.
- [ ] 6. Normalize the two camelCase routes to snake_case behind an
      api_version bump, then delete the hand-written `CodingKeys` in favor
      of one decoder with snake_case conversion. Less code, one convention.

### Phase 3: no assumptions about the machine

- [ ] 7. Lint rule: `homedir()` and hard-coded `~/.agent-server` are banned
      in `*.test.ts`. The config test regression becomes impossible to
      reintroduce.
- [ ] 8. CI runs the server test suite on a runner with no `~/.agent-server`,
      no Doppler, and no keychain, so machine-state leaks fail fast.

### Phase 4: shrink the surface

- [ ] 9. Route inventory: list all 45 API routes against what the app and CLI
      actually call. Delete the unreachable ones. Every dead route is
      untested wire format waiting to drift.
- [ ] 10. Same inventory for the security dashboard: it computes risk tiers,
      staleness, semantic analysis, and patches, and until today did not
      say whether the agent would run. Cut what the UI never shows.

## The rule that prevents the next one

A feature is not done when the write path works. It is done when the state it
creates is visible in the app without the terminal. Concretely: every PR that
adds a decision (refuse, skip, defer, drop) must also add where the user sees
it, or say in the PR body why they never need to.
