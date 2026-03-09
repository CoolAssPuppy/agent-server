# Agent Server for Mac

## Spec v1.0

---

## What this is

A lightweight, local-first agent orchestration runtime that runs persistently on your Mac. It uses your existing Claude Code installation, your existing API tokens, and your existing permission model. It reports all activity as A2A-compatible telemetry to any Google A2A-compatible observability tool, including Agent Panel.

It is not a VPS product. It is not a Docker product. It is not another OpenClaw. It is the missing layer between Claude Code's short-lived session model and the long-running, ongoing, observable agent work that no tool currently supports well.

---

## The gap this fills

| Tool | Problem |
|---|---|
| Claude Code `/loop` | Session-scoped, dies when terminal closes, no observability |
| OpenClaw | Requires setup, has security risks, not A2A compatible, not Claude-native |
| n8n / Zapier | Workflow automation, not agent orchestration |
| VPS agent server | Requires infrastructure, Docker, SSH, separate billing |

Agent Server for Mac sits in none of these categories. It runs as a macOS background process. It orchestrates Claude Code as its execution engine. It reports everything to Agent Panel (or any A2A dashboard) so you always know what is happening, even when you are not watching.

---

## Core design principles

**Local-first.** Runs on your Mac. Uses your filesystem, your tokens, your Claude Code binary. No VPS required. No Docker required.

**Claude Code as the engine.** Agent Server does not call the Anthropic API directly. It invokes Claude Code programmatically via the Agent SDK or CLI, which means it inherits Claude Code's permission model, tool access, safety behaviors, and your existing subscription or API key.

**Always supervised.** Every agent run is visible in Agent Panel in real time. You see what is running, what it is doing, what it produced, and what failed. Nothing runs in the dark.

**A2A-native.** Every event emitted by Agent Server uses the Google A2A status envelope. Any A2A-compatible dashboard, not just Agent Panel, can consume it.

**Long-running, not session-scoped.** Agent Server persists as a macOS LaunchAgent or menu bar process. It survives terminal closes, laptop sleeps (with appropriate resume logic), and reboots.

**Additive, not replacement.** If you already run OpenClaw, or use Claude Code interactively, Agent Server does not compete with those. It adds the orchestration and observability layer on top of what you already have.

---

## Architecture

```
+-----------------------------------------------------+
|                    Your Mac                          |
|                                                      |
|  +--------------+      +------------------------+    |
|  |  Agent Server|      |      Claude Code       |    |
|  |  (LaunchAgent|----->|  (your existing install)|    |
|  |   or menu bar|      |  your tokens, your perms|   |
|  |   process)   |<-----|                          |   |
|  +------+-------+      +------------------------+    |
|         |                                            |
|         |  A2A telemetry (HTTP POST)                 |
|         v                                            |
|  +--------------+                                    |
|  |  Agent Panel |  (or any A2A dashboard)            |
|  |  (local or   |                                    |
|  |   remote)    |                                    |
|  +--------------+                                    |
+-----------------------------------------------------+
```

Agent Server has three responsibilities and three responsibilities only:

1. Schedule and trigger agent runs (cron, event-driven, or manual)
2. Invoke Claude Code to execute the work
3. Report telemetry to Agent Panel throughout

It does not execute tasks itself. It does not call APIs itself. It does not manage credentials beyond what Claude Code already manages. It is a thin orchestration shell.

---

## How Claude Code execution works

Agent Server invokes Claude Code via the Agent SDK (TypeScript or Python) or the Claude Code CLI with `--print` flag for non-interactive runs.

```typescript
// Agent SDK invocation (preferred)
import { query } from "@anthropic-ai/claude-code";

const result = await query({
  prompt: agentTask.prompt,
  options: {
    maxTurns: agentTask.maxTurns ?? 20,
    allowedTools: agentTask.tools,
    cwd: agentTask.workingDirectory ?? process.env.HOME,
  }
});
```

```bash
# CLI invocation (fallback, simpler)
claude --print "your prompt here" --max-turns 20
```

The key insight: Claude Code already has your tokens, your file permissions, your MCP connections, your approved tools. Agent Server does not need to replicate any of that. It just calls Claude Code and streams the output.

---

## Agent definition format

Agents are defined as YAML files in `~/.agent-server/agents/`. Simple, readable, no database required.

```yaml
# ~/.agent-server/agents/book-awareness.yaml

id: book-awareness
name: Fiction book awareness agent
description: Monitors literary communities and drafts content for The Midnight Coder's Children

schedule: "0 8 * * *"          # daily at 8am
timezone: Europe/Lisbon

prompt: |
  You are a research and content agent for a literary fiction novel called
  "The Midnight Coder's Children." Your job today is to:

  1. Search for conversations about South Asian diaspora fiction, tech-noir,
     and nonlinear narrative on Reddit (r/books, r/scifi, r/literature) and X
  2. Identify 3-5 threads where the author's perspective would add genuine value
  3. Draft a reply for each that adds insight without self-promotion
  4. Search for literary magazines and blogs currently accepting submissions
     relevant to the book's themes
  5. Write a summary of what you found and what drafts you produced

  Save all drafts to ~/writing/book-awareness/drafts/YYYY-MM-DD/
  Report your progress as you go.

tools:
  - web_search
  - filesystem
  - telegram_notify       # sends you a message when done

max_turns: 30
working_directory: ~/writing

notifications:
  on_complete: telegram
  on_fail: telegram

telemetry:
  endpoint: https://your-agent-panel.vercel.app/api/telemetry
  api_key: ap_live_...
  external_id: book-awareness-agent
```

---

## Scheduling model

Agent Server supports four trigger types:

**Cron.** Standard cron expression. Evaluated by the Agent Server process, not by the OS (so it works even without a separate cron daemon).

**Event-driven.** File system watch, webhook receipt, or another agent completing. Defined in the YAML as `trigger: { type: file_watch, path: ~/inbox/*.txt }`.

**Manual.** Via the menu bar UI, the CLI (`agent-server run book-awareness`), or via Agent Panel (which sends a webhook back to Agent Server's local HTTP listener).

**Chained.** An agent can trigger another agent on completion. `on_complete: trigger: [social-post-agent]`. This is how multi-agent workflows compose without a separate workflow engine.

---

## Telemetry and A2A reporting

Every agent run emits a stream of A2A-compatible status events to Agent Panel (or any configured endpoint). Agent Server handles this automatically. The agent author does not need to instrument anything.

Events emitted automatically:

| Event | When |
|---|---|
| `submitted` | Run is scheduled and queued |
| `working` | Claude Code invocation starts |
| `working` (progress) | Every N turns of Claude Code's internal loop |
| `input_required` | Claude Code asks a clarifying question (surfaces in Agent Panel) |
| `completed` | Claude Code finishes successfully |
| `failed` | Error, timeout, or max turns exceeded |

Progress events extract Claude Code's tool calls and text output and summarize them into the `message` field so Agent Panel shows meaningful status, not just "working."

```typescript
// What Agent Panel receives every ~30 seconds during a run
{
  "externalId": "book-awareness-agent",
  "state": "working",
  "message": "Found 3 relevant threads on r/books, drafting replies",
  "metadata": {
    "turns_completed": 8,
    "tools_used": ["web_search", "filesystem"],
    "files_written": 2
  },
  "timestamp": "2026-03-09T14:32:00Z"
}
```
