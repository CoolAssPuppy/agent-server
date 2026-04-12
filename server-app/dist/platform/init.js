import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
const SEED_MARKER = '.seeded';
const SAMPLE_AGENT_HELLO = `id: hello-world
name: Hello World
description: A test agent that confirms Agent Server is working
schedule: "*/5 * * * *"
prompt: |
  You are a test agent. Respond with a short JSON object containing:
  - greeting: a friendly hello
  - timestamp: the current time
  - status: "operational"

  Keep your response under 100 tokens.
max_turns: 5
`;
const SAMPLE_AGENT_PULSE = `---
id: pulse
name: Pulse Check
description: Every 2 hours, appends a one-line system snapshot to ~/.agent-server/notes/pulse.md so you can look back at how your Mac has been doing.
schedule: "0 */2 * * *"
tools:
  - Bash
max_turns: 5
enabled: true
---

# Pulse Check

Capture a quick snapshot of the Mac's current state and append it as one row to a running markdown log at \`~/.agent-server/notes/pulse.md\`.

## Steps

1. Ensure the notes directory exists:

    \`\`\`bash
    mkdir -p ~/.agent-server/notes
    \`\`\`

2. If \`~/.agent-server/notes/pulse.md\` does not yet exist, create it with this header (once, not on every run):

    \`\`\`markdown
    # Pulse log

    | Timestamp | Uptime | Disk free | Battery | Load avg |
    |-----------|--------|-----------|---------|----------|
    \`\`\`

3. Gather the data:

    - Timestamp: \`date -u +%Y-%m-%dT%H:%M:%SZ\`
    - Uptime: \`uptime | awk -F'up ' '{print $2}' | awk -F',' '{print $1$2}' | sed 's/^ *//'\`
    - Disk free on root: \`df -h / | tail -1 | awk '{print $4}'\`
    - Battery percent (use \`n/a\` if not a laptop): \`pmset -g batt | grep -Eo '[0-9]+%' | head -1\`
    - Load average: \`uptime | sed 's/.*load averages*: //'\`

4. Append a single markdown table row to \`pulse.md\`. Example:

    \`\`\`
    | 2026-04-12T21:00:00Z | 12 days 3 hours | 412Gi | 87% | 1.23 0.98 0.76 |
    \`\`\`

5. Respond with "Pulse logged." and nothing else. Do not repeat the captured values in your reply.

## Notes

- This agent is intentionally quiet. It does not send notifications.
- See your log any time with: \`cat ~/.agent-server/notes/pulse.md\`
- If you want the log somewhere else, change the path in this prompt.
`;
const ENV_SCAFFOLD = `# Agent Server environment configuration.
# Every line below is commented out by default. Uncomment and fill in
# only the sections you actually need.

# --- Agent Panel (optional) ---
# Sign up at https://www.agentpanel.dev for free to get run history,
# token cost tracking, and a cross-machine dashboard. Without this,
# Agent Server works fine locally but run history lives only in memory.
# AGENT_SERVER_PANEL_URL=https://www.agentpanel.dev
# AGENT_SERVER_PANEL_API_KEY=ap_live_...

# --- Telegram (optional) ---
# Create a bot at https://t.me/BotFather to get a token. Enables:
#   - Notifications from agents that set notification.channel: telegram
#   - Interactive agents (interaction.channel: telegram)
#   - Direct chat with agents by messaging the bot
# AGENT_SERVER_TELEGRAM_BOT_TOKEN=

# --- Sleep/wake catch-up (optional) ---
# When true, the server detects sleep gaps and triggers any agents
# that missed their cron window while the Mac was asleep.
# AGENT_SERVER_CATCH_UP=true

# --- Custom ports / paths (advanced) ---
# AGENT_SERVER_PORT=47821
# AGENT_SERVER_AGENTS_DIR=~/.agent-server/agents
`;
export function initAgentServer(baseDir, options = {}) {
    const { verbose = false } = options;
    const agentsDir = join(baseDir, 'agents');
    const locksDir = join(baseDir, 'locks');
    const logsDir = join(baseDir, 'logs');
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(locksDir, { recursive: true });
    mkdirSync(logsDir, { recursive: true });
    // Seed sample agents only on a true first run: no seed marker AND
    // no pre-existing agent files. Either condition means the user has
    // either already been through first-run (and possibly deleted the
    // samples) or brought their own agents — in both cases, leave the
    // folder alone.
    const markerPath = join(agentsDir, SEED_MARKER);
    if (!existsSync(markerPath) && isDirEmptyOfAgents(agentsDir)) {
        writeIfMissing(join(agentsDir, 'hello-world.yaml'), SAMPLE_AGENT_HELLO, verbose);
        writeIfMissing(join(agentsDir, 'pulse.md'), SAMPLE_AGENT_PULSE, verbose);
    }
    // Drop the marker so future launches never re-seed, even if the
    // user deletes every agent.
    writeIfMissing(markerPath, '', verbose);
    writeIfMissing(join(baseDir, '.env'), ENV_SCAFFOLD, verbose);
    if (verbose) {
        console.log(`Agent Server initialized at: ${baseDir}`);
        console.log('');
        console.log('Next steps:');
        console.log('  1. Edit or add agents in: ' + agentsDir);
        console.log('  2. Edit ' + join(baseDir, '.env') + ' to enable Panel telemetry or Telegram');
        console.log('  3. Start the daemon: agent-server start');
    }
}
function writeIfMissing(filePath, content, verbose) {
    if (existsSync(filePath))
        return;
    writeFileSync(filePath, content, 'utf-8');
    if (verbose) {
        console.log(`Created: ${filePath}`);
    }
}
function isDirEmptyOfAgents(dir) {
    if (!existsSync(dir))
        return true;
    const entries = readdirSync(dir);
    // Hidden/system files (e.g. .DS_Store, .seeded) don't count.
    return entries.every((name) => name.startsWith('.'));
}
//# sourceMappingURL=init.js.map