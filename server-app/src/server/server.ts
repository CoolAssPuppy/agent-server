import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { join } from 'path';
import type { ServerConfig } from '../platform/config.js';
import type { AgentConfig } from '../agents/config.js';
import type { Reporter } from '../execution/runner.js';
import { createApi } from './api.js';
import { discoverAgents } from '../agents/discovery.js';
import { RunStore } from '../reporting/store.js';
import { runAgent } from '../execution/runner.js';
import { executeAgent } from '../plugins/claude-code.js';
import { ExecutorRegistry } from '../execution/executor-registry.js';
import { createReporter } from '../reporting/reporter-factory.js';
import { shouldRun, hasMissedRun } from '../agents/scheduler.js';
import { evaluateTriggers } from '../agents/triggers.js';
import { FileWatcher, extractWatchConfigs } from '../agents/file-watcher.js';
import { ChannelDispatcher } from '../channels/dispatcher.js';
import { InteractionStore } from '../interaction/store.js';
import type { InteractionRequest } from '../interaction/schema.js';
import { createTelegramChannel } from '../channels/telegram.js';
import { formatCompletionNotification, formatFailureNotification, formatAgentListMessage } from '../interaction/notification.js';
import { routeMessage } from '../channels/router.js';
import { randomUUID } from 'crypto';
import { ProgressBroadcaster, type ProgressEvent } from './websocket.js';

export type ServerInstance = {
  stop: () => void;
};

const TIMEOUT_PATTERN = /^(\d+)(m|h)$/;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

function parseTimeout(timeout: string): number {
  const match = TIMEOUT_PATTERN.exec(timeout);
  if (!match) return DEFAULT_TIMEOUT_MS;

  const value = parseInt(match[1], 10);
  const unit = match[2];
  return unit === 'h' ? value * 60 * 60 * 1000 : value * 60 * 1000;
}

export function startServer(config: ServerConfig): ServerInstance {
  const store = new RunStore();
  const interactionStore = new InteractionStore();
  const channelDispatcher = new ChannelDispatcher();
  const port = config.port;

  const executorRegistry = new ExecutorRegistry();
  executorRegistry.register('claude-code', executeAgent);
  executorRegistry.setDefault('claude-code');

  const activeControllers = new Map<string, AbortController>();
  const broadcaster = new ProgressBroadcaster();

  async function handleInteractionResult(
    runId: string,
    agent: AgentConfig,
    interaction: InteractionRequest,
  ): Promise<void> {
    if (!agent.interaction) return;

    const interactionId = randomUUID();
    const timeoutMs = parseTimeout(agent.interaction.timeout);

    interactionStore.add({
      id: interactionId,
      runId,
      agentId: agent.id,
      replyAgentId: agent.interaction.on_reply,
      request: interaction,
      channel: agent.interaction.channel,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + timeoutMs),
    });

    await channelDispatcher.dispatch(interactionId, agent.interaction.channel, interaction);
  }

  function sendNotification(agent: AgentConfig, status: 'completed' | 'failed', detail?: string): void {
    if (!agent.notification) return;

    const shouldNotify = status === 'completed'
      ? agent.notification.on_complete
      : agent.notification.on_failure;

    if (!shouldNotify) return;

    const message = status === 'completed'
      ? formatCompletionNotification(agent.name, detail)
      : formatFailureNotification(agent.name, detail);

    channelDispatcher.notify(agent.notification.channel, message)
      .catch((err) => console.error(`[notification] Failed for ${agent.id}:`, err));
  }

  async function fireDownstreamTriggers(sourceAgentId: string, status: 'completed' | 'failed'): Promise<void> {
    try {
      const agents = await discoverAgents(config.agentsDir);
      const downstream = evaluateTriggers(agents, sourceAgentId, status);
      for (const agent of downstream) {
        console.log(`[triggers] ${status} ${sourceAgentId} -> triggering ${agent.id}`);
        triggerRunForAgent(agent);
      }
    } catch (err) {
      console.error(`[triggers] Failed to evaluate triggers for ${sourceAgentId}:`, err);
    }
  }

  type RunDoneCallback = (result: { status: 'completed' | 'failed'; summary?: string; error?: string }) => void;

  function triggerRunForAgent(agent: AgentConfig, promptSuffix?: string, onDone?: RunDoneCallback): string {
    const runId = randomUUID();
    const abortController = new AbortController();
    activeControllers.set(runId, abortController);

    const now = new Date();
    store.add({
      runId,
      agentId: agent.id,
      agentName: agent.name,
      status: 'running',
      startedAt: now,
      turnCount: 0,
      toolsUsed: [],
      filesRead: [],
      filesWritten: [],
      commandsRun: [],
      progressMessages: [],
    });

    broadcaster.emit({
      type: 'run_started',
      runId,
      agentId: agent.id,
      timestamp: now.toISOString(),
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
            broadcaster.emit({
              type: 'run_progress',
              runId,
              agentId: agent.id,
              message: msg,
              metadata: meta,
              timestamp: new Date().toISOString(),
            });
            return reporter.progress(msg, meta);
          },
          complete: (result) => reporter.complete(result),
          fail: (error) => reporter.fail(error),
          stop: () => reporter.stop(),
        };
        const executor = executorRegistry.resolve(a);
        const result = await executor(a, wrappedReporter, { abortController });
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
        if (result.interaction && agent.interaction) {
          void handleInteractionResult(runId, agent, result.interaction);
        }
        broadcaster.emit({
          type: 'run_completed',
          runId,
          agentId: agent.id,
          summary: result.summary,
          timestamp: new Date().toISOString(),
        });
        sendNotification(agent, 'completed', result.summary);
        onDone?.({ status: 'completed', summary: result.summary });
        void fireDownstreamTriggers(agent.id, 'completed');
        return result;
      },
      createReporter: (rid, name) => createReporter(config, rid, name),
      promptSuffix,
    }).then((result) => {
      activeControllers.delete(runId);
      if (result.status === 'failed') {
        store.update(runId, {
          status: 'failed',
          completedAt: new Date(),
          error: result.error,
        });
        broadcaster.emit({
          type: 'run_failed',
          runId,
          agentId: agent.id,
          error: result.error,
          timestamp: new Date().toISOString(),
        });
        sendNotification(agent, 'failed', result.error);
        onDone?.({ status: 'failed', error: result.error });
        void fireDownstreamTriggers(agent.id, 'failed');
      }
    }).catch((err) => {
      activeControllers.delete(runId);
      const errorMsg = err instanceof Error ? err.message : String(err);
      store.update(runId, {
        status: 'failed',
        completedAt: new Date(),
        error: errorMsg,
      });
      broadcaster.emit({
        type: 'run_failed',
        runId,
        agentId: agent.id,
        error: errorMsg,
        timestamp: new Date().toISOString(),
      });
      sendNotification(agent, 'failed', errorMsg);
      onDone?.({ status: 'failed', error: errorMsg });
      void fireDownstreamTriggers(agent.id, 'failed');
    });

    return runId;
  }

  async function triggerRun(agentId: string, promptSuffix?: string): Promise<string> {
    const agents = await discoverAgents(config.agentsDir);
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    return triggerRunForAgent(agent, promptSuffix);
  }

  function cancelRun(runId: string): boolean {
    const controller = activeControllers.get(runId);
    if (!controller) return false;

    controller.abort();
    activeControllers.delete(runId);
    store.update(runId, {
      status: 'failed',
      completedAt: new Date(),
      error: 'Cancelled by user',
    });
    return true;
  }

  let lastCheckedAt = new Date();
  const SLEEP_GAP_MULTIPLIER = 2;

  async function runDueAgents(): Promise<void> {
    const agents = await discoverAgents(config.agentsDir);
    const now = new Date();

    if (config.catchUp) {
      const gap = now.getTime() - lastCheckedAt.getTime();
      if (gap > SLEEP_GAP_MULTIPLIER * config.checkIntervalMs) {
        console.log(`[catch-up] Detected sleep gap of ${Math.round(gap / 1000)}s, checking for missed agents`);
        const missedAgents = agents.filter((agent) => hasMissedRun(agent, lastCheckedAt, now));
        for (const agent of missedAgents) {
          try {
            console.log(`[catch-up] Triggering missed agent: ${agent.id}`);
            triggerRunForAgent(agent);
          } catch (err) {
            console.error(`[catch-up] ${agent.id}: error - ${err}`);
          }
        }
      }
    }

    lastCheckedAt = now;

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
    cancelRun,
  });

  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  app.get('/ws', upgradeWebSocket(() => {
    let listener: ((event: ProgressEvent) => void) | undefined;

    return {
      onOpen(_event, ws) {
        listener = (progressEvent: ProgressEvent) => {
          ws.send(JSON.stringify(progressEvent));
        };
        broadcaster.subscribe(listener);
      },
      onClose() {
        if (listener) {
          broadcaster.unsubscribe(listener);
          listener = undefined;
        }
      },
    };
  }));

  const httpServer = serve({ fetch: app.fetch, port });
  injectWebSocket(httpServer);
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

  async function setupTelegram(): Promise<void> {
    if (!config.telegramBotToken) return;

    const chatIdPath = join(config.agentsDir, '..', 'telegram.json');
    const telegramChannel = await createTelegramChannel({
      botToken: config.telegramBotToken,
      chatIdPath,
    });

    telegramChannel.onReply((reply) => {
      const interaction = interactionStore.get(reply.interactionId);
      if (!interaction || interaction.status !== 'pending') return;

      interactionStore.markActed(reply.interactionId);
      const promptSuffix = reply.selectedValue ?? reply.freeText;
      if (!promptSuffix) return;

      console.log(`[telegram] Reply for ${interaction.agentId}, triggering ${interaction.replyAgentId}`);
      void triggerRun(interaction.replyAgentId, promptSuffix).catch((err) => {
        console.error(`[telegram] Failed to trigger ${interaction.replyAgentId}: ${err}`);
      });
    });

    telegramChannel.onMessage((text) => {
      void (async () => {
        try {
          const agents = await discoverAgents(config.agentsDir);
          const result = await routeMessage(text, agents);

          if (result.type === 'list') {
            await telegramChannel.notify(formatAgentListMessage(agents));
            return;
          }

          if (result.type === 'none') {
            await telegramChannel.notify('No matching agent found for your message.');
            return;
          }

          const { agent } = result;
          await telegramChannel.notify(`Running ${agent.name}...`);

          triggerRunForAgent(agent, result.context, (done) => {
            const message = done.status === 'completed'
              ? formatCompletionNotification(agent.name, done.summary)
              : formatFailureNotification(agent.name, done.error);
            void telegramChannel.notify(message);
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[telegram] Message routing failed: ${msg}`);
          void telegramChannel.notify(`Error: ${msg}`);
        }
      })();
    });

    channelDispatcher.register(telegramChannel);
    await telegramChannel.start();
    console.log('  Telegram: connected');
  }

  const telegramPromise = setupTelegram();

  const expiryInterval = setInterval(() => {
    const expiredIds = interactionStore.expireStale();
    if (expiredIds.length > 0) {
      console.log(`[interactions] Expired ${expiredIds.length} stale interaction(s)`);
      const expiredWithChannels = expiredIds
        .map((id) => {
          const interaction = interactionStore.get(id);
          return interaction ? { id, channel: interaction.channel } : null;
        })
        .filter((item): item is { id: string; channel: string } => item !== null);

      void channelDispatcher.expireInteractions(expiredWithChannels);
    }
  }, 60_000);

  return {
    stop: () => {
      clearInterval(interval);
      clearInterval(expiryInterval);
      httpServer.close();
      void fileWatcherPromise.then((w) => w?.stop());
      void telegramPromise.then(() => channelDispatcher.stopAll());
      console.log('Agent Server stopped.');
    },
  };
}
