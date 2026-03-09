import { serve } from '@hono/node-server';
import type { ServerConfig } from './config.js';
import { createApi } from './api.js';
import { discoverAgents } from './discovery.js';
import { RunStore } from './store.js';
import { runAgent } from './runner.js';
import { executeAgent } from './executor.js';
import { TelemetryReporter } from './reporter.js';
import type { Reporter } from './runner.js';
import { shouldRun } from './scheduler.js';
import { randomUUID } from 'crypto';

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

export type ServerInstance = {
  stop: () => void;
};

export function startServer(config: ServerConfig): ServerInstance {
  const store = new RunStore();
  const port = config.port;

  async function triggerRun(agentId: string): Promise<string> {
    const agents = await discoverAgents(config.agentsDir);
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);

    const runId = randomUUID();
    store.add({
      runId,
      agentId: agent.id,
      agentName: agent.name,
      status: 'running',
      startedAt: new Date(),
      turnCount: 0,
      toolsUsed: [],
      filesRead: [],
      filesWritten: [],
      commandsRun: [],
      progressMessages: [],
    });

    void runAgent({
      agent,
      lockDir: config.lockDir,
      execute: async (a, reporter) => {
        const wrappedReporter: Reporter = {
          start: () => reporter.start(),
          progress: (msg, meta) => {
            store.addProgress(runId, msg);
            if (meta) {
              store.update(runId, {
                turnCount: (meta.turns_completed as number) ?? 0,
                toolsUsed: (meta.tools_used as string[]) ?? [],
              });
            }
            return reporter.progress(msg, meta);
          },
          complete: (result) => reporter.complete(result),
          fail: (error) => reporter.fail(error),
          stop: () => reporter.stop(),
        };
        const result = await executeAgent(a, wrappedReporter);
        store.update(runId, {
          status: 'completed',
          completedAt: new Date(),
          summary: result.summary,
          turnCount: result.turnCount,
          toolsUsed: result.toolsUsed,
          filesRead: result.filesRead,
          filesWritten: result.filesWritten,
          commandsRun: result.commandsRun,
        });
        return result;
      },
      createReporter: (rid, name) => createReporter(config, rid, name),
    }).then((result) => {
      if (result.status === 'failed') {
        store.update(runId, {
          status: 'failed',
          completedAt: new Date(),
          error: result.error,
        });
      }
    });

    return runId;
  }

  async function runDueAgents(): Promise<void> {
    const agents = await discoverAgents(config.agentsDir);
    const now = new Date();
    const dueAgents = agents.filter((agent) => shouldRun(agent, now));
    if (dueAgents.length === 0) return;

    console.log(`[${now.toISOString()}] ${dueAgents.length} agent(s) due: ${dueAgents.map((a) => a.id).join(', ')}`);

    for (const agent of dueAgents) {
      try {
        await triggerRun(agent.id);
      } catch (err) {
        console.error(`  ${agent.id}: error - ${err}`);
      }
    }
  }

  const app = createApi({
    getAgents: () => discoverAgents(config.agentsDir),
    store,
    triggerRun,
  });

  const httpServer = serve({ fetch: app.fetch, port });
  console.log(`Agent Server API listening on http://localhost:${port}`);

  void runDueAgents();
  const interval = setInterval(() => {
    void runDueAgents();
  }, config.checkIntervalMs);

  return {
    stop: () => {
      clearInterval(interval);
      httpServer.close();
      console.log('Agent Server stopped.');
    },
  };
}
