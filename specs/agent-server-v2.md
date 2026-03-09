# Agent Server v2: interactive agents

Status: Draft, iterating.

## The problem

Agent Server runs background tasks. An agent checks restaurant availability, finds three slots, and writes the result to a Notion page or prints it to the console. Then nothing. The user has to manually trigger another agent to act on those results.

The missing piece: a way for agents to report back, ask a question, and continue based on the answer. Not a chat interface. A notification with a quick reply that triggers the next step.

## How OpenClaw handles this

OpenClaw solves interactivity by not having the problem in the first place. The agent lives inside your chat app. Every message is interactive by default because the user is already in a conversation. Telegram, WhatsApp, Slack, Discord, Signal, iMessage -- OpenClaw supports 50+ channels through adapter plugins. The agent is always-on, always listening.

Their model:

- **Gateway** receives messages from any channel, normalizes them, routes to the right agent session.
- **Agent loop** processes the message, calls tools, streams a reply back through the same channel.
- **Sessions** persist conversation history in JSONL files. Context window management with auto-compaction.
- **Memory** survives sessions via MEMORY.md files on disk.
- **Scheduling** uses heartbeat (periodic check-ins) and cron (timed jobs), but these run inside existing sessions, not as separate processes.

What OpenClaw does NOT have (yet): formal pause/resume. Issue #19072 requests first-class "interrupt, wait for approval, resume." Issue #22078 requests inline button support for exec approval prompts -- the exact pattern we want. The agent can ask a question in chat and the user replies, but there's no structured schema for "here are three buttons, pick one." That's conversational, not transactional.

### Where OpenClaw and Agent Server diverge

| Concern | OpenClaw | Agent Server |
|---|---|---|
| Primary model | Always-on assistant in chat | Background task runner |
| Execution | Long-lived session, many turns | Short-lived process, runs to completion |
| Interactivity | Inherent (lives in chat) | Not yet supported |
| Agent definition | JSON5 config + workspace markdown files (SOUL.md, AGENTS.md, etc.) | Single YAML/Markdown file with frontmatter |
| Scheduling | Heartbeat + cron, inside sessions | Cron + file watch + on-demand, spawns processes |
| State | Session history + MEMORY.md | Stateless (each run is independent) |
| Engine | Direct LLM API calls | Claude Code subprocess |

These are fundamentally different tools. OpenClaw is a personal AI assistant that happens to run scheduled tasks. Agent Server is a task scheduler that happens to use an AI for execution.

Trying to turn Agent Server into OpenClaw would mean rebuilding OpenClaw. That's not the goal. The goal is to add a thin interactivity layer that lets task-oriented agents pause at decision points and resume when the user responds.

## Prior art for interaction requests

Six frameworks were evaluated for structured "agent needs user input" schemas. Most provide only the pause/resume mechanism, not a format for what to ask. Two stand out:

### MCP elicitation (draft spec)

The most rigorous. Uses JSON Schema for the request, with a three-state response (accept/decline/cancel):

```json
{
  "method": "elicitation/create",
  "params": {
    "message": "Please provide your contact information",
    "requestedSchema": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "time_slot": {
          "type": "string",
          "enum": ["19:00", "20:30", "21:00"]
        }
      }
    }
  }
}
```

Response: `{ "action": "accept", "content": { "time_slot": "20:30" } }`

Constrained to flat objects with primitives. Supports enums with labels via `oneOf`. Still draft status but well-documented.

### Claude Code Agent SDK -- AskUserQuestion

Built into Claude Code. Questions with labeled options:

```json
{
  "questions": [{
    "question": "Which time slot?",
    "options": [
      { "label": "19:00", "description": "Earliest available" },
      { "label": "20:30", "description": "Prime time" }
    ]
  }]
}
```

Response: `{ "answers": { "Which time slot?": "20:30" } }`

Limited to 1-4 questions, 2-4 options each. Supports free-text answers beyond predefined options.

### A2A protocol -- task state

A2A doesn't define a structured ask format, but it defines the lifecycle: tasks transition to `input-required` state, the client sends a new message, the task resumes. We already report in A2A format.

### What we should adopt

Combine the three:

1. **A2A's `input-required` state** for the lifecycle (we already emit A2A status events).
2. **A schema inspired by MCP elicitation** for the structured ask -- it's the most general and doesn't impose arbitrary limits like "max 4 options."
3. **Claude Code's simplicity** for the common case -- most interactions are "pick one from a list."

## Design principles

1. **Agents stay stateless.** No long-lived sessions. Each run is a process that starts, does work, and exits. "Interactivity" means chaining two stateless runs with a human decision in between.

2. **Borrow the channel adapter pattern.** OpenClaw normalized 50+ messaging platforms behind a common interface. We do the same, starting with Telegram + console.

3. **Don't build a chat interface.** The user already has Telegram. Agent Server sends notifications there and receives replies. It never renders a conversation UI.

4. **Structured interactions with free-text fallback.** The primary UX is buttons/options. But agents can also accept typed replies for open-ended questions. Both become `--with` context for the next agent.

5. **Use `--with` as the continuation mechanism.** The `promptSuffix` infrastructure already exists. A user tapping a button in Telegram is equivalent to `agent-server run restaurant-booker --with "Book 20:30 slot at Bougainville via TheFork"`.

6. **Don't preclude multi-channel.** Build the channel interface cleanly so adding email (Resend), Slack, or others later is just a new adapter. But ship with Telegram only.

## The networking question (resolved)

Concern: agent-server runs on a local Mac with no public IP. How can Telegram communicate back?

Answer: it doesn't need to. Telegram bots support two modes:

- **Webhooks**: Telegram pushes updates to a public URL. Requires infrastructure.
- **Long-polling**: The bot calls Telegram's `getUpdates` API, and Telegram holds the connection open until updates arrive. No public URL needed. Works behind firewalls, NAT, VPNs.

grammY (the TypeScript Telegram framework) uses long-polling by default. A single `bot.start()` call begins the loop. Inline keyboard button taps arrive through the same polling mechanism as regular messages. No HTTP server, no port forwarding, no ngrok.

This is the same model as any other outbound API call. If your Mac can reach the internet, the bot works.

## Interaction flow

```
  trigger (cron/cli/api)
        |
        v
  +------------------+
  | agent runs        |
  | (Claude Code)     |
  |                   |
  | finds results,    |
  | outputs interaction|
  | request in its    |
  | response          |
  +--------+----------+
           |
   executor parses interaction
   request from output
           |
           v
  +------------------+
  | interaction       |
  | dispatcher        |
  |                   |
  | looks up channel  |
  | from agent config |
  +--------+----------+
           |
     +-----+------+
     |            |
     v            v
  Telegram     Console
  (inline      (numbered
  keyboard)    list + stdin)
     |            |
  user taps    user types
  button       number
     |            |
     +-----+------+
           |
           v
  +------------------+
  | reply handler     |
  |                   |
  | resolves pending  |
  | interaction       |
  | triggers on_reply |
  | agent with --with |
  +--------+----------+
           |
           v
  +------------------+
  | next agent runs   |
  | with user's       |
  | choice as context |
  +------------------+
```

## Interaction request schema

Adopted from MCP elicitation, simplified for our use case.

An agent signals it needs input by including a fenced block in its output:

    ```interaction
    {
      "message": "Found 3 slots at Bougainville tonight for 4 people",
      "options": [
        { "label": "19:00", "value": "Book Bougainville, 19:00, 4 guests, TheFork" },
        { "label": "20:30", "value": "Book Bougainville, 20:30, 4 guests, TheFork" },
        { "label": "21:00", "value": "Book Bougainville, 21:00, 4 guests, TheFork" }
      ],
      "freeText": false
    }
    ```

The executor scans the final assistant output for this fenced block and parses it.

**Schema:**

```typescript
type InteractionRequest = {
  message: string;           // displayed to the user
  options?: Array<{
    label: string;           // button text
    value: string;           // becomes --with context for on_reply agent
    description?: string;    // extra detail (shown as subtitle in Telegram)
  }>;
  freeText?: boolean;        // allow typed reply (default: true if no options)
};
```

When `options` is present, the channel renders buttons. When `freeText` is true (or options is absent), the user can type a reply. The reply text becomes the `--with` value verbatim.

**Why a fenced code block and not a custom MCP tool:**

A custom MCP tool (`request_user_input`) would be more reliable but requires:
- Building and hosting an MCP server
- Registering it in Claude Code's config
- Handling the tool approval flow

The fenced block approach works today with zero infrastructure. The agent's prompt tells it to output the block. The executor regex-matches it. If parsing fails, the interaction is skipped and the run completes normally (graceful degradation).

We can migrate to an MCP tool later if the fenced block proves too fragile. The channel adapter layer doesn't care where the interaction request came from.

## Agent config changes

New optional `interaction` field:

```yaml
id: restaurant-checker
name: Restaurant Availability Checker
interaction:
  channel: telegram
  on_reply: restaurant-booker
  timeout: 1h
tools:
  - mcp__plugin_playwright_playwright__browser_navigate
  - mcp__plugin_playwright_playwright__browser_snapshot
  - mcp__plugin_playwright_playwright__browser_click
  - mcp__plugin_playwright_playwright__browser_fill_form
max_turns: 40
```

Schema addition:

```typescript
const InteractionConfigSchema = z.object({
  channel: z.string().min(1),              // "telegram", "console"
  on_reply: z.string().min(1),             // agent ID to trigger
  timeout: z.string().default('30m'),      // duration string
});
```

If `interaction` is present and the agent's output contains an interaction request, agent-server sends it to the configured channel. If `interaction` is absent, interaction requests in the output are ignored.

## Telegram channel adapter

### Setup

1. Create a bot via @BotFather. Get a token.
2. Add to `~/.agent-server/.env`:
   ```
   AGENT_SERVER_TELEGRAM_BOT_TOKEN=7123456789:AAH...
   ```
3. Start agent-server. The Telegram adapter initializes if the token is present.
4. Message the bot on Telegram: `/start`. The bot records your chat ID.
5. Interaction requests from agents are now delivered as Telegram messages with inline keyboards.

### Implementation

Uses grammY in long-polling mode. No HTTP server needed.

```typescript
import { Bot, InlineKeyboard } from 'grammy';

// Lifecycle: start with agent-server, stop on shutdown
// Long-polling runs in background, receives button taps via same channel
// Chat ID stored in memory (single-user), persisted to ~/.agent-server/telegram.json
```

When an interaction request arrives:
1. Build an `InlineKeyboard` with one button per option.
2. Each button's callback data encodes the interaction ID + option index.
3. Send the message with the keyboard to the stored chat ID.
4. When the user taps a button, the callback handler resolves the interaction and triggers the `on_reply` agent.

For free-text: after sending the interaction message, listen for the next text message from the same chat. Use that as the reply value.

### Authentication

Single-user: the chat ID from the first `/start` message is the authorized user. All other chat IDs are ignored. Stored in `~/.agent-server/telegram.json`.

Multi-user (future): would need a pairing flow where agent-server generates a code, the user sends it to the bot, and the server associates the Telegram chat with an agent-server user. Not needed now.

## Interaction store

Tracks pending interactions so replies can be resolved:

```typescript
type PendingInteraction = {
  id: string;
  runId: string;
  agentId: string;
  replyAgentId: string;
  request: InteractionRequest;
  channel: string;
  channelMessageId: string;
  createdAt: Date;
  expiresAt: Date;
  status: 'pending' | 'acted' | 'expired';
};
```

In-memory to start. A periodic sweep expires stale interactions. Expired interactions are not retried -- the run already completed, the moment has passed. The agent-panel can show expired interactions for observability.

## Telemetry changes

When a run produces an interaction request, the status event transitions to A2A's `input-required` state:

```json
{
  "agent": "Restaurant Availability Checker",
  "state": "input-required",
  "timestamp": "2026-03-10T19:30:00Z",
  "interaction": {
    "id": "int_abc123",
    "message": "Found 3 slots at Bougainville tonight for 4",
    "options": [
      { "label": "19:00" },
      { "label": "20:30" },
      { "label": "21:00" }
    ],
    "channel": "telegram"
  }
}
```

When the user replies, a new `working` event fires for the triggered agent, with a reference to the interaction it's continuing.

## Channel interface

Designed for Telegram now, with room for email (Resend) or others later:

```typescript
interface Channel {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(chatId: string, request: InteractionRequest): Promise<string>;
  onReply(callback: (reply: ChannelReply) => void): void;
}

type ChannelReply = {
  interactionId: string;
  selectedValue?: string;    // from option.value
  freeText?: string;         // typed reply
};
```

The dispatcher maps `interaction.channel` from agent config to a registered `Channel` instance. If the channel isn't configured (no bot token), the interaction is logged as a warning and skipped.

Console channel (`agent-server run` in a terminal) uses readline for input. Telegram channel uses grammY.

## Implementation plan

### Phase 1: interaction request parsing

- Add `InteractionConfigSchema` to agent config.
- Add `parseInteractionRequest()` to executor -- regex scan for fenced `interaction` blocks in assistant output.
- Add `InteractionRequest` type with Zod schema.
- Wire into runner: after execution completes, check for interaction request + agent config. Return it in the `RunResult`.
- Tests: parsing valid blocks, malformed blocks, missing blocks, blocks when no interaction config.

No channel delivery yet. Just parsing and returning the structured data.

### Phase 2: console channel

- When `agent-server run` produces an interaction request, print the message and options as a numbered list.
- Read selection from stdin (readline).
- Trigger the `on_reply` agent with the selected option's `value` as `--with`.
- Works end-to-end in the terminal. No Telegram, no external dependencies.

### Phase 3: Telegram channel

- Add `grammy` dependency.
- Implement `TelegramChannel` with long-polling.
- `/start` command stores chat ID.
- Interaction requests rendered as inline keyboard messages.
- Button taps resolved via callback queries.
- Free-text replies captured from next text message.
- Interaction store for pending requests with expiry.
- Agent-server `start` command initializes the Telegram bot alongside the HTTP API and scheduler.

### Phase 4: notifications (non-interactive)

- Agents without `on_reply` can still send Telegram notifications on completion.
- "Your weekly report is ready" with a link to the Notion page.
- Uses the same channel infrastructure, just without buttons or reply handling.

### Phase 5: multi-step flows

- Agent chains: agent -> user -> agent -> user -> agent.
- Each step is a separate run, connected by a flow ID passed through interaction metadata.
- Agent-panel shows the full flow as a timeline.

## File structure (proposed)

```
src/
  channels/
    channel.ts              # Channel interface + ChannelReply type
    console.ts              # Console channel (readline)
    telegram.ts             # Telegram channel (grammY, long-polling)
    dispatcher.ts           # Maps channel names to Channel instances

  interaction/
    parser.ts               # Parse interaction requests from agent output
    store.ts                # PendingInteraction in-memory store
    schema.ts               # InteractionRequest + InteractionConfig Zod schemas
```

## Decisions made

| Decision | Rationale |
|---|---|
| Telegram only (for now) | Lowest friction, long-polling works locally, user preference |
| Long-polling, not webhooks | No public IP needed, works on Mac behind firewall |
| Fenced code block for interaction requests | Zero infrastructure, works today, gracefully degrades |
| MCP elicitation-inspired schema | Most rigorous prior art, not inventing something new |
| A2A `input-required` state | Already emit A2A events, natural extension |
| grammY for Telegram | Most popular TypeScript Telegram framework, clean API |
| Single-user auth via chat ID | Matches current single-user model, simple |
| In-memory interaction store | Same pattern as run store, persistent storage later |
| Console channel for dev/testing | Proves the model without external dependencies |

## Open questions

1. **Timeout behavior.** When an interaction expires with no reply, should we log it, send a Telegram message ("This request expired"), or trigger a fallback agent? Leaning toward: update the Telegram message to say "Expired" and log it. No fallback agent unless explicitly configured.

2. **Multiple interaction requests per run.** Can an agent output more than one interaction block? Probably not for v1 -- one interaction per run keeps things simple. The agent can always ask follow-up questions in the next run.

3. **Interaction request validation.** Should the executor validate that `on_reply` references an agent that actually exists? Yes -- fail fast at parse time, not when the user taps a button 20 minutes later.

4. **Bot identity.** Should the Telegram bot name match the agent name, or be a single "Agent Server" bot that delivers all agent interactions? Single bot is simpler. Multiple bots would need multiple tokens.
