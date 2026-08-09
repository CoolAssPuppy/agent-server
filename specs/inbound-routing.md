# Inbound agent routing

A proposal for triggering agents from Linear, Notion, and Slack events.

## The short version

Most of this is already built. The transport from Panel to a home server behind
NAT exists, it is push rather than poll, and it already delivers a JSON payload
into the agent prompt. What does not exist is the front half: nothing receives a
provider webhook and decides which agent should run.

So the work is one new concept in Panel, three small corrections in Agent
Server, and one optional field in an agent definition.

## What already works

**Transport.** `server-app/src/reporting/realtime-client.ts` mints a
short-lived ES256 JWT from Panel at `/api/agent-server/realtime-token`, then
opens an outbound WebSocket to Supabase Realtime and subscribes to
`postgres_changes` INSERT on `run_triggers`. The home server opens no port and
accepts no connection. Latency is push time, not poll interval.

Polling is not needed and would be worse. Keep the WebSocket.

**Missed events.** On every `SUBSCRIBED` status, including reconnects, the
client runs a REST catch-up query against `run_triggers` gated by a cursor
persisted to disk. An event that arrives while the home server is asleep is
picked up when it wakes.

**Queue.** `run_triggers` already carries everything an inbound event needs:
`task_id`, `input jsonb`, `target_machine_id`, `claimed_by`,
`idempotency_key` with a unique index on `(org_id, idempotency_key)`,
`expires_at`, and a status machine of queued, acknowledged, running, completed,
failed, cancelled. The atomic claim functions `claim_run_trigger` and
`claim_next_run_trigger` exist.

**Execution.** `TriggerHandler` receives the event, acknowledges it, resolves an
agent by `task_slug` against the agents directory, and calls `invokeRun` with
the trigger `input` as a prompt suffix.

**Untrusted input handling.** `execution/runner.ts` sanitizes the suffix, scores
it against injection patterns, wraps it in
`UNTRUSTED_USER_CONTEXT_START` / `END` with a data-not-instructions policy, and
appends it to the agent prompt.

The path from "a row lands in `run_triggers`" to "an agent runs with that
payload" is finished and tested.

## The missing piece

Today a row lands in `run_triggers` only when a person presses Run Now in the
web app or on iOS. `TriggerKind` in `execution/trigger-handler.ts` has exactly
one member: `'manual'`.

Inbound routing is the machine that turns a provider event into that row.

## Where it lives

Panel. Three reasons, in order of weight:

1. Panel is the only component with a public URL. Putting ingress on the home
   server means opening a port, which is the thing being avoided.
2. Panel already has the queue table, API key auth, per-bucket rate limiting,
   idempotency handling, and a webhook route precedent in
   `/api/stripe/webhook`.
3. Routing decisions are configuration a person edits. Panel already has a
   settings UI and a database to hold it.

## Design

Five stages. Each one is separately testable and only the third is new thinking.

### 1. Ingress

One route per provider under `/api/inbound/`:

| Route | Verification |
| --- | --- |
| `/api/inbound/linear` | HMAC-SHA256 over the raw body, `linear-signature` header |
| `/api/inbound/slack` | `v0=` HMAC over version, timestamp, and raw body, with a 5 minute timestamp window |
| `/api/inbound/notion` | HMAC-SHA256 over the raw body, `X-Notion-Signature` header |
| `/api/inbound/generic` | Panel API key, for anything else |

Each route verifies, normalizes, enqueues, and returns. Nothing else. Slack
requires a response within 3 seconds and Linear retries on non-2xx, so the
handler must not wait on anything slow. Slack's `url_verification` challenge is
answered inline before any other handling.

Signing secrets are per source, stored as Vercel environment variables, sourced
from Doppler like the rest.

### 2. Normalize

Every source collapses into one shape before anything downstream sees it. This
is what keeps agent definitions independent of where the event came from.

```ts
type InboundEvent = {
  source: 'linear' | 'slack' | 'notion' | 'generic';
  event_type: string;          // 'issue.assigned', 'app_mention', 'page.comment'
  actor: { id: string; display_name: string | null };
  subject: {
    kind: 'issue' | 'message' | 'page' | 'comment';
    id: string;                // provider ID, used for dedupe
    url: string | null;        // deep link the agent can open
    title: string | null;
  };
  excerpt: string | null;      // first 500 chars, for routing predicates only
  thread: { id: string; url: string | null } | null;
  occurred_at: string;         // ISO 8601
};
```

Note what is not in there: the full body. See "The input contract" below.

### 3. Route

A new table, evaluated in priority order, first match wins.

```sql
CREATE TABLE public.inbound_routes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  enabled              boolean NOT NULL DEFAULT false,
  priority             integer NOT NULL DEFAULT 100,

  source               text NOT NULL,
  event_type           text NOT NULL,
  match                jsonb NOT NULL DEFAULT '[]'::jsonb,

  target_task_id       uuid NOT NULL REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  target_machine_id    uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,

  dedupe_template      text NOT NULL,
  coalesce_window_s    integer NOT NULL DEFAULT 60,
  max_per_hour         integer NOT NULL DEFAULT 20,

  created_at           timestamptz NOT NULL DEFAULT now()
);
```

`match` is a small declarative predicate list, not an expression language:

```json
[
  { "field": "actor.id", "op": "not_equals", "value": "<my own user id>" },
  { "field": "subject.title", "op": "contains", "value": "draft" }
]
```

Operators are `equals`, `not_equals`, `contains`, `in`. That is the whole
vocabulary. This predicate runs on attacker-influenceable content inside a
serverless function, so it gets no loops, no regular expressions, and no user
code.

The default route for the core scenario:

| Field | Value |
| --- | --- |
| source | `linear` |
| event_type | `issue.assigned` |
| match | `actor.id not_equals <me>` |
| target_task_id | the draft-reply assistant |
| dedupe_template | `linear:{{subject.id}}:assigned` |

### 4. Enqueue

Insert into `run_triggers` with `idempotency_key` set to the rendered
`dedupe_template`. The existing unique index makes Linear's retries and Slack's
duplicate deliveries free. Set `target_machine_id` from the route.

Coalescing sits in front of the insert: if a trigger for the same dedupe key was
created inside `coalesce_window_s`, skip. A busy Slack thread that fires six
events in ten seconds produces one run. Without this, the lock in `runner.ts`
would skip the extra runs anyway, but each skip records a failed trigger and the
run history fills with noise.

`max_per_hour` is a circuit stop per route. When a route exceeds it, disable the
route and record the reason rather than dropping events silently.

### 5. Deliver

No new code. Realtime picks up the insert, `TriggerHandler` runs the agent.

## The input contract

The trigger carries a pointer, not a payload.

`sanitizePromptSuffix` in `server/security-utils.ts` caps the suffix at 4,000
characters. A JSON-stringified Slack thread or a Linear issue with a long
description gets truncated mid-structure, which is both a waste and a source of
confusing agent behavior.

The agents already hold Slack, Linear, and Notion MCP connections with read
permissions. They can fetch the full object themselves, in whatever depth the
task needs, and they will do it better than a fixed serializer. So `input`
should be small and stable:

```json
{
  "trigger": "inbound",
  "source": "linear",
  "event_type": "issue.assigned",
  "subject_kind": "issue",
  "subject_id": "ENG-1234",
  "subject_url": "https://linear.app/...",
  "subject_title": "Rework the onboarding email",
  "actor": "Nate",
  "excerpt": "first 500 characters",
  "occurred_at": "2026-08-09T14:02:11Z"
}
```

That is roughly 400 characters. It leaves the whole budget for the agent's own
prompt and tells the agent exactly what to go read.

## What changes in Agent Server

Three items, all small.

**1. Add the trigger kind.** `TriggerKind` in `execution/trigger-handler.ts` is
`'manual'` only. Add `'inbound'` so run history can explain why a run happened.
The realtime event needs a matching field, sourced from a new
`run_triggers.trigger_kind` column defaulting to `'manual'`.

**2. Filter by machine and claim properly.** The realtime subscription filters on
`org_id=eq.${orgId}` and `TriggerHandler` acknowledges without claiming. With
one paired machine this is invisible. With two, both receive the same event and
both start a run, because `claim_run_trigger` exists but nothing calls it. Add
`target_machine_id` to the subscription filter, and replace the naked ack with a
claim through `/api/commands/claim`. That route already exists and already does
the right thing.

This is worth fixing now rather than later. Webhook traffic multiplies whatever
the current volume is.

**3. Render the input as text, not JSON.** `coercePromptSuffix` calls
`JSON.stringify` on the input. For an inbound event, format it as labeled lines
instead. Braces and quotes cost tokens and read worse inside the untrusted
context wrapper.

## What changes in agent definitions

Nothing. Not one field.

An agent definition describes a task. It should not know or care whether a
schedule, a person pressing Run Now, or a Linear assignment started it. An agent
that drafts a reply and files it in a private Notion page is the same agent in
all three cases.

This already works. `schedule` is optional in `AgentConfigSchema`, so an agent
with no schedule and `enabled: true` is a valid, discoverable, triggerable
definition today.

An earlier draft of this document proposed an `inbound:` opt-in field on the
agent, as a gate against a routing row pointing a public webhook at an agent
with write permissions. That was the same mistake in smaller clothes: trigger
knowledge inside a task definition. The gate is still needed. It goes somewhere
else. See below.

Applied consistently, this principle says `schedule` does not belong in the
definition either. That is a separate question and not urgent, but the routing
layer proposed here is the natural place for schedules to live if they ever
move.

## Where the safety gate goes

Not in the agent file, and not in Panel either.

Panel cannot make this decision. `buildV2AssistantSyncPayload` sends
`privacy_level: 'operational'` through a `.strict()` schema carrying name,
enabled, hash, cron, and timezone. No instructions, no tools, no permissions.
That is deliberate, and the comment on the function says so. Sending the
permission lists to Panel just to render a warning would trade a real privacy
property for a cosmetic one.

So the check runs on the machine, where the permissions actually are.

When `TriggerHandler` resolves an agent for a trigger whose kind is `inbound`,
it checks the agent's permissions before invoking the run. An agent that can
write back to the source that triggered it is refused, and the refusal goes back
through the existing `/complete` endpoint with a reason. The reason lands in the
inbound inbox, where the person who created the route reads it.

This is one policy, not a per-agent flag:

> An inbound-triggered run may not use an agent that can write to the source
> that triggered it.

Under that rule, a Linear assignment can start an agent that reads Linear and
writes Notion. It cannot start an agent that comments on Linear issues. That is
exactly the boundary worth defending, because the payload is written by whoever
filed the issue.

The alternative is narrowing the agent's permissions for the duration of an
inbound run rather than refusing it, using the existing
`execution/permission-policy.ts`. Refusal is the better default: an agent that
half works because its tools were quietly removed underneath it produces a
confusing failure, and a loud refusal produces an obvious one.

## Observability

Add an `inbound_events` table holding the normalized event, the matched route
ID or null, the resulting trigger ID or null, and a skip reason. Retain 30 days.

The question that will be asked most often is "why didn't my agent fire," and
without this table the answer requires reading Vercel logs. With it, the answer
is one query and eventually one screen in Panel.

## Security

The payload is attacker-influenceable in every real scenario. Anyone in the
Slack workspace can mention Prashant with text written to steer an agent. Anyone
with Linear access can title an issue whatever they like.

Three controls, in order of how much they matter:

1. **Agent permissions.** The `permissions.deny` list is the real boundary.
   Inbound-triggered agents should be draft-only: they read the source, they
   write to a private Notion page, and they never post back to the source. The
   scenario as described already works this way. Keep it that way, and treat any
   future inbound agent that can send as a separate decision with its own
   review.
2. **The write-back refusal.** Covered above. It runs on the machine, reads the
   agent's real permissions, and refuses an inbound run for any agent that can
   write to the source that triggered it.
3. **The untrusted wrapper.** Already built in `runner.ts`. It frames the
   payload as data and scores it for injection patterns. It is a mitigation, not
   a boundary, which is why it is listed third.

Signature verification is table stakes and belongs in stage 1. An unverified
`/api/inbound/*` route is an unauthenticated way to start arbitrary agents on a
home machine.

## Plan and paywall

Inbound is Pro. The whole capability, not a quota on it.

That pairs well with what Pro already means. The free plan sees 3 days of
telemetry through `org_telemetry_cutoff`, and Pro sees everything. Unlimited
history and inbound triggers are the same pitch from two directions: free is for
watching a handful of scheduled agents, Pro is for running an actual system.

### Enforcement

The existing pattern puts the limit in the database, not only in the app, and
mirrors it into TypeScript for the query layer. Follow it.

**1. RLS on `inbound_routes`.** Add `public.org_is_pro(uuid)` alongside
`org_telemetry_cutoff`, in the same SECURITY DEFINER shape, and gate INSERT and
UPDATE on it. A free org cannot create or enable a route at all.

**2. A check at ingress.** The `/api/inbound/*` handlers use the service client,
which bypasses RLS, so the plan check there has to be explicit.

One detail matters more than it looks: **answer 200, not 402.** Linear retries
non-2xx deliveries and disables a webhook that keeps failing. Slack does the
same. A free org's webhook should be accepted, recorded in `inbound_events` as
blocked by plan, and answered normally. Rejecting at the HTTP layer teaches the
provider to stop calling, which turns a subscription lapse into a broken
integration that needs manual repair in three different admin panels.

**3. Downgrade.** Routes are never deleted when Pro lapses. The ingress check
reads the live plan, so routes stop firing and start recording blocked events.
Resubscribing resumes them with nothing to reconfigure and no migration.

The inbound inbox on a free org is the paywall pitch, because it shows real
events arriving from a webhook the person already set up, each one labeled with
the agent that would have run.

### Retention

`inbound_events` gets the same treatment as `logs` and `task_runs`: an RLS
SELECT policy keyed to `org_telemetry_cutoff`, so free sees 3 days and Pro sees
everything.

One thing to fix while this is being built. The current cutoff is query-only:
free orgs' telemetry is ingested and retained forever, and merely hidden from
reads. If unlimited history is going to be the Pro pitch, the free tier needs
actual deletion behind it, both so the storage bill tracks the revenue and so
the claim on the pricing page is true.

## Build order

Each step ends somewhere shippable.

1. `run_triggers.trigger_kind` column, plus the three Agent Server corrections.
   Nothing external changes, existing Run Now keeps working, and the machine
   filter bug is closed.
2. The write-back refusal in `TriggerHandler`, with `trigger_kind: 'inbound'`
   reachable only from tests. Lands the safety rule before anything can reach
   it.
3. `inbound_events` and `inbound_routes` tables, `org_is_pro`, and the RLS
   gates. Routing evaluation as a pure function with no HTTP surface.
4. `/api/inbound/linear` end to end with one route row, including the plan check
   and the 200-on-blocked behavior. This proves the whole path with the real
   scenario.
5. Panel screens: the inbound inbox first, then create-route-from-event. The
   inbox is worth more than the route form and is the thing a free org sees.
6. Slack and Notion ingress, the same shape as Linear with different signature
   math and different normalizers.
7. Free-tier deletion job for telemetry and inbound events.
