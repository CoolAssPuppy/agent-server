import { serve } from '@hono/node-server';
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
import { shouldRun } from '../agents/scheduler.js';
import { FileWatcher, extractWatchConfigs } from '../agents/file-watcher.js';
import { ChannelDispatcher } from '../channels/dispatcher.js';
import { InteractionStore } from '../interaction/store.js';
import type { InteractionRequest } from '../interaction/schema.js';
import { createTelegramChannel } from '../channels/telegram.js';
import { formatCompletionNotification, formatFailureNotification, formatAgentListMessage } from '../interaction/notification.js';
import { routeMessage } from '../channels/router.js';
import { randomUUID } from 'crypto';

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

  type RunDoneCallback = (result: { status: 'completed' | 'failed'; summary?: string; error?: string }) => void;

  function triggerRunForAgent(agent: AgentConfig, promptSuffix?: string, onDone?: RunDoneCallback): string {
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
        if (result.interaction && agent.interaction) {
          void handleInteractionResult(runId, agent, result.interaction);
        }
        sendNotification(agent, 'completed', result.summary);
        onDone?.({ status: 'completed', summary: result.summary });
        return result;
      },
      createReporter: (rid, name) => createReporter(config, rid, name),
      promptSuffix,
    }).then((result) => {
      if (result.status === 'failed') {
        store.update(runId, {
          status: 'failed',
          completedAt: new Date(),
          error: result.error,
        });
        sendNotification(agent, 'failed', result.error);
        onDone?.({ status: 'failed', error: result.error });
      }
    }).catch((err) => {
      const errorMsg = err instanceof Error ? err.message : String(err);
      store.update(runId, {
        status: 'failed',
        completedAt: new Date(),
        error: errorMsg,
      });
      sendNotification(agent, 'failed', errorMsg);
      onDone?.({ status: 'failed', error: errorMsg });
    });

    return runId;
  }

  async function triggerRun(agentId: string, promptSuffix?: string): Promise<string> {
    const agents = await discoverAgents(config.agentsDir);
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    return triggerRunForAgent(agent, promptSuffix);
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
    const expired = interactionStore.expireStale();
    if (expired.length > 0) {
      console.log(`[interactions] Expired ${expired.length} stale interaction(s)`);
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
