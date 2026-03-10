# App Store metadata

## App name
Agent Server

## Subtitle (30 chars max)
AI agents from your menu bar

## Promotional text (170 chars max, can be updated without new build)
Run AI agents on a schedule, on demand, or triggered by file changes. Built on Claude Code with Telegram integration and full agent management.

## Description (4000 chars max)

Agent Server puts AI agents in your macOS menu bar. Define agents as simple YAML or Markdown files. Schedule them with cron, trigger them on demand, or watch files for changes. The menu bar icon shows you what's running at a glance.

What it does:

- Runs AI agents in the background using Claude Code as the execution engine
- Supports scheduled agents (cron), file watchers, interactive agents, and on-demand triggers
- Shows active runs and agent status from the menu bar
- Built-in editor for viewing and editing agent definitions with Markdown syntax highlighting
- Manages environment variables and server configuration
- Sends notifications and interactive prompts via Telegram
- Routes natural language messages to the right agent automatically

How agents work:

Define an agent in a YAML or Markdown file. Give it a prompt, a schedule, and the tools it can use. Agent Server handles the rest: evaluating schedules, acquiring locks, running the agent, and reporting results.

Agents can read from Slack, Linear, Notion, Gmail, and Google Calendar. They can create documents, send notifications, and chain into other agents. Interactive agents pause for human input before continuing.

The menu bar app monitors the server, displays active runs, and lets you trigger agents or edit their definitions without touching the terminal.

Built for developers and power users who want AI automation without a hosted platform.

Requirements:

- macOS 14.0 or later
- Node.js (for the agent server process)
- An Anthropic API key for Claude
- Optional: Telegram bot token for notifications and interactive agents

Agent Server is open source. The server, CLI, and sample agents are available on GitHub.

## Keywords (100 chars max, comma separated)
AI,agents,automation,Claude,cron,scheduler,menu bar,developer,productivity,YAML

## Category
Primary: Developer Tools
Secondary: Productivity

## Copyright
2026 Strategic Nerds, Inc.

## Support URL
https://github.com/strategicnerds/agent-server

## Privacy policy URL
(required for App Store - needs to be created)

## Age rating
4+ (no objectionable content)

## What's new in this version (for updates)
Initial release. Manage and monitor AI agents from your menu bar.

## Screenshots needed
1. Menu bar dropdown showing active runs and scheduled agents
2. Agents tab with agent list showing kind icons and descriptions
3. Agent editor with syntax-highlighted Markdown
4. Settings tab with environment variable editor
5. New agent creation sheet

## App icon
512x512 icon already in Assets.xcassets (robot face on dark background)

## App review notes
This app manages a local Node.js server process that runs AI agents. It requires an Anthropic API key (configured in the app's Settings tab) and Node.js installed via Homebrew. The server runs on localhost:47821 and does not require internet access except for API calls to Anthropic's Claude API and optional integrations (Slack, Linear, Notion, Gmail, Google Calendar, Telegram).

The app reads and writes configuration files in ~/.agent-server/. On first launch, it will prompt the user to grant access to this directory.

For testing, you can create a simple agent file and trigger it from the Agents tab. A test agent is included in the sample agents.
