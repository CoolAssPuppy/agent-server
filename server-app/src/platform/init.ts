import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const SAMPLE_AGENT = `id: hello-world
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

export function initAgentServer(baseDir: string): void {
  const agentsDir = join(baseDir, 'agents');
  const locksDir = join(baseDir, 'locks');
  const logsDir = join(baseDir, 'logs');

  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(locksDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  const samplePath = join(agentsDir, 'hello-world.yaml');
  if (!existsSync(samplePath)) {
    writeFileSync(samplePath, SAMPLE_AGENT, 'utf-8');
    console.log(`Created sample agent: ${samplePath}`);
  }

  console.log(`Agent Server initialized at: ${baseDir}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Edit agents in: ' + agentsDir);
  console.log('  2. Set environment variables:');
  console.log('     AGENT_SERVER_PANEL_URL=https://your-panel.vercel.app');
  console.log('     AGENT_SERVER_PANEL_API_KEY=ap_live_...');
  console.log('  3. Start the daemon: agent-server start');
}
