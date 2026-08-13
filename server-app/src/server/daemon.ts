import { randomUUID } from 'crypto';
import type { ServerConfig } from '../platform/config.js';
import type { AgentConfig } from '../agents/config.js';
import { discoverAgents } from '../agents/discovery.js';
import { shouldRun } from '../agents/scheduler.js';
import { runAgent, type RunResult } from '../execution/runner.js';
import { createDefaultExecutorRegistry } from '../execution/default-executors.js';
import { discoverRuntimePaths } from '../execution/runtime-discovery.js';
import { createReporter } from '../reporting/reporter-factory.js';
import { replayPendingTerminals } from '../reporting/reporter.js';
import { ScheduleSync } from '../reporting/sync-schedule.js';
import { RealtimeClient } from '../reporting/realtime-client.js';
import { TriggerHandler, type InvokeRun } from '../execution/trigger-handler.js';
import { ConsoleChannel } from '../channels/console.js';
import type { ChannelReply } from '../channels/channel.js';
import { homedir } from 'os';
import { join } from 'path';
import type { Reporter } from '../execution/runner.js';
import { ConnectionProfileStore } from '../connections/profile-store.js';
import { ConnectionCapabilityStore } from '../connections/capability-store.js';
import { ConnectionOperationBindingStore } from '../connections/operation-binding-store.js';
import { createConnectionResolvingExecutor } from '../connections/connection-executor.js';
import { RuntimeAssignmentStore } from '../agents/runtime-assignment-store.js';
import { AgentBindingStore } from '../agents/agent-binding-store.js';
import { createAgentLogger } from '../logging/index.js';

type RunOptions = {
  promptSuffix?: string;
};

function runAgentWithConfig(config: ServerConfig, agent: AgentConfig, options: RunOptions = {}) {
  const registry = createDefaultExecutorRegistry();
  const runtimePaths = discoverRuntimePaths();
  const profiles = new ConnectionProfileStore(join(config.agentsDir, '..', 'connections.json'));
  const runtimeAssignments = new RuntimeAssignmentStore(
    join(config.agentsDir, '..', 'runtime-assignments.json'),
  );
  const agentBindings = new AgentBindingStore(join(config.agentsDir, '..', 'agent-bindings.json'));
  const capabilities = new ConnectionCapabilityStore(
    join(config.agentsDir, '..', 'connection-capabilities.json'),
  );
  const operationBindings = new ConnectionOperationBindingStore(
    join(config.agentsDir, '..', 'connection-operation-bindings.json'),
  );
  const logger = createAgentLogger({ logsDir: config.logsDir, machineId: config.machineId });
  const execute = createConnectionResolvingExecutor(profiles, (candidate) => async (resolved, reporter, extra) => (
    registry.resolve(candidate)(resolved, reporter, { ...extra, ...runtimePaths, logger })
  ), runtimeAssignments, agentBindings, capabilities, operationBindings);
  return runAgent({
    agent,
    lockDir: config.lockDir,
    execute,
    createReporter: (runId, agentName, convId) => createReporter(config, runId, agentName, {
      conversationId: convId,
      agentTelemetry: agent.telemetry,
    }),
    promptSuffix: options.promptSuffix,
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
  options: RunOptions = {},
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
  if (options.promptSuffix) {
    console.log(`  with: ${options.promptSuffix}`);
  }

  const result = await runAgentWithConfig(config, agent, options);

  if (result.status === 'skipped') {
    console.log('Skipped: agent is already running');
    return;
  }

  if (result.status === 'failed') {
    console.error(`Failed: ${result.error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Completed (run: ${result.runId})\n`);
  if (result.result) {
    console.log(`Summary: ${result.result.summary}`);
    console.log(`Turns: ${result.result.turnCount}`);
    if (result.result.toolsUsed.length > 0) {
      console.log(`Tools used: ${result.result.toolsUsed.join(', ')}`);
    }
    if (result.result.filesWritten.length > 0) {
      console.log(`Files written: ${result.result.filesWritten.join(', ')}`);
    }
  }

  if (agent.interaction?.on_reply) {
    const replyAgent = agents.find((a) => a.id === agent.interaction!.on_reply);
    if (!replyAgent) {
      console.error(`Reply agent not found: ${agent.interaction.on_reply}`);
      return;
    }
    await handleInteraction(config, agent, result, replyAgent);
  }
}

async function handleInteraction(
  config: ServerConfig,
  agent: AgentConfig,
  result: RunResult,
  replyAgent: AgentConfig,
): Promise<void> {
  if (!result.result?.interaction || !agent.interaction) return;

  const interaction = result.result.interaction;
  const interactionId = randomUUID();

  if (agent.interaction.channel !== 'console') {
    console.log(`\nInteraction request sent to ${agent.interaction.channel} (not handled in CLI mode)`);
    return;
  }

  const channel = new ConsoleChannel();
  let reply: ChannelReply | undefined;

  channel.onReply((r) => {
    reply = r;
  });

  await channel.send(interactionId, interaction);

  if (!reply) return;

  const promptSuffix = reply.selectedValue ?? reply.freeText;
  if (!promptSuffix) return;

  console.log(`\nTriggering ${replyAgent.name} (${replyAgent.id})...`);
  await runSingleAgent(config, replyAgent.id, { promptSuffix });
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
    schedule: a.schedule ?? '(on-demand)',
    enabled: a.enabled ? 'yes' : 'no',
    turns: String(a.max_turns),
  }));

  console.table(rows);
}

function createInvokeRun(config: ServerConfig): InvokeRun {
  const registry = createDefaultExecutorRegistry();
  const runtimePaths = discoverRuntimePaths();
  const profiles = new ConnectionProfileStore(join(config.agentsDir, '..', 'connections.json'));
  const runtimeAssignments = new RuntimeAssignmentStore(
    join(config.agentsDir, '..', 'runtime-assignments.json'),
  );
  const agentBindings = new AgentBindingStore(join(config.agentsDir, '..', 'agent-bindings.json'));
  const capabilities = new ConnectionCapabilityStore(
    join(config.agentsDir, '..', 'connection-capabilities.json'),
  );
  const operationBindings = new ConnectionOperationBindingStore(
    join(config.agentsDir, '..', 'connection-operation-bindings.json'),
  );
  const logger = createAgentLogger({ logsDir: config.logsDir, machineId: config.machineId });
  const execute = createConnectionResolvingExecutor(profiles, (candidate) => async (resolved, reporter, extra) => (
    registry.resolve(candidate)(resolved, reporter, { ...extra, ...runtimePaths, logger })
  ), runtimeAssignments, agentBindings, capabilities, operationBindings);
  return async (options) => {
    return runAgent({
      agent: options.agent,
      lockDir: config.lockDir,
      execute,
      createReporter: (runId, agentName, convId) => {
        const reporter = createReporter(config, runId, agentName, {
          conversationId: convId,
          agentTelemetry: options.agent.telemetry,
        });
        const wrapped: Reporter = {
          start: async () => {
            await options.onRunStart(runId);
            await reporter.start();
          },
          progress: (message, metadata) => reporter.progress(message, metadata),
          complete: (result) => reporter.complete(result),
          fail: (error) => reporter.fail(error),
          stop: () => reporter.stop(),
        };
        return wrapped;
      },
      promptSuffix: options.promptSuffix,
    });
  };
}

/**
 * @deprecated Use `startServer` from './server.js' instead. The production CLI
 * entry (`cli.ts`) already uses `startServer`, which composes the local HTTP
 * API, scheduler, file watchers, SSE trigger/decision channel, ScheduleSync,
 * pending-terminal replay, and graceful shutdown. This function is retained
 * only to avoid breaking external importers; it will be removed in a future
 * release.
 */
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

  void replayPendingTerminals({ getApiKey: () => config.panelApiKey, panelUrl: config.panelUrl });

  void runDueAgents(config);

  const interval = setInterval(() => {
    void runDueAgents(config);
  }, config.checkIntervalMs);

  const panelConfigured = Boolean(config.panelUrl && config.panelApiKey);

  const scheduleSync = panelConfigured
    ? new ScheduleSync({
        agentsDir: config.agentsDir,
        panelUrl: config.panelUrl!,
        panelApiKey: config.panelApiKey!,
        machineId: config.machineId,
      })
    : undefined;

  const realtimeClient = panelConfigured
    ? new RealtimeClient({
        panelUrl: config.panelUrl!,
        panelApiKey: config.panelApiKey!,
        cursorPath: join(homedir(), '.agent-server', 'sse-cursor'),
      })
    : undefined;

  const triggerHandler = realtimeClient
    ? new TriggerHandler({
        agentsDir: config.agentsDir,
        panelUrl: config.panelUrl!,
        panelApiKey: config.panelApiKey!,
        sseEvents: realtimeClient.events,
        invokeRun: createInvokeRun(config),
      })
    : undefined;

  if (scheduleSync) {
    void scheduleSync.start();
  }

  if (triggerHandler) {
    triggerHandler.start();
  }

  if (realtimeClient) {
    void realtimeClient.start();
  }

  return {
    stop: () => {
      clearInterval(interval);
      scheduleSync?.stop();
      triggerHandler?.stop();
      realtimeClient?.stop();
      console.log('Agent Server stopped.');
    },
  };
}
