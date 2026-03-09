import { serve } from '@hono/node-server';
import type { ServerConfig } from './config.js';
import type { AgentConfig } from './agent-config.js';
import type { Reporter } from './runner.js';
import { createApi } from './api.js';
import { discoverAgents } from './discovery.js';
import { RunStore } from './store.js';
import { runAgent } from './runner.js';
import { executeAgent } from './executor.js';
import { ExecutorRegistry } from './executor-registry.js';
import { createReporter } from './reporter-factory.js';
import { shouldRun } from './scheduler.js';
import { FileWatcher, extractWatchConfigs } from './file-watcher.js';
import { randomUUID } from 'crypto';

export type ServerInstance = {
  stop: () => void;
};

export function startServer(config: ServerConfig): ServerInstance {
  const store = new RunStore();
  const port = config.port;

  const executorRegistry = new ExecutorRegistry();
  executorRegistry.register('claude-code', executeAgent);
  executorRegistry.setDefault('claude-code');

  function triggerRunForAgent(agent: AgentConfig): string {
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

    runAgent({
      agent,
      lockDir: config.lockDir,
      execute: async (a, reporter) => {
        const wrappedReporter: Reporter = {
          start: () => reporter.start(),
          progress: (msg, meta) => {
            store.addProgress(runId, msg);
            if (meta) {
              store.update(runId, {
                turnCount: typeof meta.turns_completed === 'number' ? meta.turns_completed : 0,
                toolsUsed: Array.isArray(meta.tools_used) ? meta.tools_used as string[] : [],
              });
            }
            return reporter.progress(msg, meta);
          },
          complete: (result) => reporter.complete(result),
          fail: (error) => reporter.fail(error),
          stop: () => reporter.stop(),
        };
        const executor = executorRegistry.resolve(a);
        const result = await executor(a, wrappedReporter);
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
    }).catch((err) => {
      store.update(runId, {
        status: 'failed',
        completedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return runId;
  }

  async function triggerRun(agentId: string): Promise<string> {
    const agents = await discoverAgents(config.agentsDir);
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    return triggerRunForAgent(agent);
  }

  async function runDueAgents(): Promise<void> {
    const agents = await discoverAgents(config.agentsDir);
    const now = new Date();
    const dueAgents = agents.filter((agent) => shouldRun(agent, now));
    if (dueAgents.length === 0) return;

    console.log(`[${now.toISOString()}] ${dueAgents.length} agent(s) due: ${dueAgents.map((a) => a.id).join(', ')}`);

    for (const agent of dueAgents) {
      try {
        triggerRunForAgent(agent);
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

  async function setupFileWatchers(): Promise<FileWatcher | null> {
    const agents = await discoverAgents(config.agentsDir);
    const watchConfigs = extractWatchConfigs(agents);
    if (watchConfigs.length === 0) return null;

    console.log(`  File watches: ${watchConfigs.length} path(s)`);
    const watcher = new FileWatcher({
      watches: watchConfigs,
      onChange: (agentId, filePath) => {
        console.log(`[file-watch] ${filePath} changed, triggering ${agentId}`);
        void triggerRun(agentId).catch((err) => {
          console.error(`[file-watch] Failed to trigger ${agentId}: ${err}`);
        });
      },
    });
    watcher.start();
    return watcher;
  }

  const fileWatcherPromise = setupFileWatchers();

  return {
    stop: () => {
      clearInterval(interval);
      httpServer.close();
      void fileWatcherPromise.then((w) => w?.stop());
      console.log('Agent Server stopped.');
    },
  };
}
