import type { ServerConfig } from './config.js';
import type { AgentConfig } from './agent-config.js';
import type { Reporter } from './runner.js';
import { discoverAgents } from './discovery.js';
import { shouldRun } from './scheduler.js';
import { runAgent } from './runner.js';
import { executeAgent } from './executor.js';
import { TelemetryReporter } from './reporter.js';

function createReporter(config: ServerConfig, runId: string, agentName: string): Reporter {
  if (!config.panelUrl || !config.panelApiKey) {
    return {
      start: async () => {},
      progress: async () => {},
      complete: async () => {},
      fail: async () => {},
      stop: () => {},
    };
  }

  return new TelemetryReporter({
    runId,
    agentName,
    endpoint: `${config.panelUrl}/api/runs/${runId}/status`,
    apiKey: config.panelApiKey,
    heartbeatMs: config.heartbeatMs,
  });
}

function runAgentWithConfig(config: ServerConfig, agent: AgentConfig) {
  return runAgent({
    agent,
    lockDir: config.lockDir,
    execute: executeAgent,
    createReporter: (runId, agentName) => createReporter(config, runId, agentName),
  });
}

export async function runDueAgents(config: ServerConfig): Promise<void> {
  const agents = await discoverAgents(config.agentsDir);
  const now = new Date();

  const dueAgents = agents.filter((agent) => shouldRun(agent, now));
  if (dueAgents.length === 0) return;

  console.log(`[${now.toISOString()}] ${dueAgents.length} agent(s) due: ${dueAgents.map((a) => a.id).join(', ')}`);

  const results = await Promise.allSettled(
    dueAgents.map((agent) => runAgentWithConfig(config, agent))
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const agent = dueAgents[i];
    if (result.status === 'fulfilled') {
      const r = result.value;
      if (r.status === 'skipped') {
        console.log(`  ${agent.id}: skipped (already running)`);
      } else {
        console.log(`  ${agent.id}: ${r.status} (run: ${r.runId})`);
      }
    } else {
      console.error(`  ${agent.id}: error - ${result.reason}`);
    }
  }
}

export async function runSingleAgent(
  config: ServerConfig,
  agentId: string,
): Promise<void> {
  const agents = await discoverAgents(config.agentsDir);
  const agent = agents.find((a) => a.id === agentId);

  if (!agent) {
    console.error(`Agent not found: ${agentId}`);
    console.error(`Available agents: ${agents.map((a) => a.id).join(', ') || '(none)'}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Running agent: ${agent.name} (${agent.id})`);

  const result = await runAgentWithConfig(config, agent);

  if (result.status === 'skipped') {
    console.log('Skipped: agent is already running');
  } else if (result.status === 'completed') {
    console.log(`Completed (run: ${result.runId})`);
  } else {
    console.error(`Failed: ${result.error}`);
    process.exitCode = 1;
  }
}

export async function listAgents(config: ServerConfig): Promise<void> {
  const agents = await discoverAgents(config.agentsDir);

  if (agents.length === 0) {
    console.log('No agents found.');
    console.log(`Agent directory: ${config.agentsDir}`);
    return;
  }

  console.log(`Found ${agents.length} agent(s):\n`);

  const rows = agents.map((a) => ({
    id: a.id,
    name: a.name,
    schedule: a.schedule,
    enabled: a.enabled ? 'yes' : 'no',
    turns: String(a.max_turns),
  }));

  console.table(rows);
}

export function startDaemon(config: ServerConfig): { stop: () => void } {
  console.log('Agent Server starting...');
  console.log(`  Agents: ${config.agentsDir}`);
  console.log(`  Check interval: ${config.checkIntervalMs / 1000}s`);
  if (config.panelUrl) {
    console.log(`  Panel: ${config.panelUrl}`);
  } else {
    console.log('  Panel: not configured (telemetry disabled)');
  }
  console.log('');

  void runDueAgents(config);

  const interval = setInterval(() => {
    void runDueAgents(config);
  }, config.checkIntervalMs);

  return {
    stop: () => {
      clearInterval(interval);
      console.log('Agent Server stopped.');
    },
  };
}
