#!/usr/bin/env node

import { realpathSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import { loadConfig, loadEnvFile } from './platform/config.js';
import { listAgents, runSingleAgent } from './server/daemon.js';
import { startServer } from './server/server.js';
import { initAgentServer } from './platform/init.js';
import { installLaunchAgent, uninstallLaunchAgent } from './platform/launchd.js';
import { createPanelClient } from './reporting/panel-client.js';
import { AGENT_SERVER_VERSION } from './version.js';
import { runCleanupCommand } from './platform/cleanup-command.js';
import { toErrorMessage } from './util/errors.js';
import type { Analytics } from './analytics/analytics.js';
import { createAnalyticsFromEnvironment } from './analytics/factory.js';
import { ANALYTICS_EVENTS } from './analytics/events.js';
import { classifyErrorReason } from './analytics/reason.js';
import { loadOrCreateMachineId } from './platform/machine-identity.js';
import { redeemPairingCode, savePairing } from './platform/pairing.js';

type CliOutput = {
  log: (message: string) => void;
  error: (message: string) => void;
};

export type CliDependencies = {
  baseDir: string;
  argv: string[];
  env: NodeJS.ProcessEnv;
  anthropicApiKey?: string;
  output: CliOutput;
  initAgentServer: typeof initAgentServer;
  loadEnvFile: typeof loadEnvFile;
  loadConfig: typeof loadConfig;
  startFileLogger: (logsDir: string) => Promise<void> | void;
  startServer: typeof startServer;
  runSingleAgent: typeof runSingleAgent;
  listAgents: typeof listAgents;
  createPanelClient: typeof createPanelClient;
  runCleanupCommand: typeof runCleanupCommand;
  installLaunchAgent: typeof installLaunchAgent;
  uninstallLaunchAgent: typeof uninstallLaunchAgent;
  onSignal: (signal: 'SIGINT' | 'SIGTERM', listener: () => void) => void;
  exit: (code: number) => void;
  setExitCode: (code: number) => void;
  analytics: Analytics;
  /** Injected so uptime is measurable without a real clock in tests. */
  now: () => number;
};

/**
 * Wraps one command action in the invoked/failed pair.
 *
 * Every verb reports the same two events with the same property, so a single
 * wrapper is what keeps CLI usage answerable without a capture call scattered
 * through each action. The flush is what makes one-shot commands work: `list`
 * and `run` exit within milliseconds of their action resolving, well before the
 * ten-second batch timer would have fired.
 */
function instrument<Args extends unknown[]>(
  analytics: Analytics,
  command: string,
  action: (...args: Args) => Promise<void> | void,
): (...args: Args) => Promise<void> {
  return async (...args: Args) => {
    analytics.capture(ANALYTICS_EVENTS.cliCommandInvoked, { command });
    try {
      await action(...args);
    } catch (error) {
      analytics.capture(ANALYTICS_EVENTS.cliCommandFailed, {
        command,
        reason: classifyErrorReason(error),
      });
      throw error;
    } finally {
      await analytics.flush();
    }
  };
}

/** Construct the CLI without reading process state or starting background work. */
export function createCli(dependencies: CliDependencies): Command {
  const program = new Command();
  const { analytics } = dependencies;

  program
    .name('agent-server')
    .description('Lightweight agent orchestration server for Claude Code, Codex, and Kimi Code')
    .version(AGENT_SERVER_VERSION);

  program
    .command('start')
    .description('Start the server with HTTP API and agent scheduler')
    .action(instrument(analytics, 'start', async () => {
      dependencies.initAgentServer(dependencies.baseDir);
      Object.assign(
        dependencies.env,
        dependencies.loadEnvFile(dependencies.baseDir, dependencies.env),
      );
      const config = dependencies.loadConfig(dependencies.env);

      await dependencies.startFileLogger(config.logsDir);
      const server = dependencies.startServer(config, {
        anthropicApiKey: dependencies.anthropicApiKey,
        analytics,
      });

      const startedAt = dependencies.now();
      let isShuttingDown = false;
      const shutdown = async (signal: string): Promise<void> => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        let exitCode = 0;
        try {
          await server.stop();
        } catch (error) {
          exitCode = 1;
          dependencies.output.error(`[shutdown] error: ${toErrorMessage(error)}`);
        } finally {
          analytics.capture(ANALYTICS_EVENTS.serverStopped, {
            signal,
            exit_code: exitCode,
            uptime_seconds: Math.round((dependencies.now() - startedAt) / 1000),
          });
          await analytics.shutdown();
          dependencies.exit(exitCode);
        }
      };

      dependencies.onSignal('SIGINT', () => { void shutdown('SIGINT'); });
      dependencies.onSignal('SIGTERM', () => { void shutdown('SIGTERM'); });

      try {
        await server.ready;
      } catch (error) {
        analytics.capture(ANALYTICS_EVENTS.serverStartFailed, {
          reason: classifyErrorReason(error),
        });
        try {
          await server.stop();
        } catch (cleanupError) {
          dependencies.output.error(
            `[startup] cleanup error: ${toErrorMessage(cleanupError)}`,
          );
        }
        throw error;
      }

      analytics.capture(ANALYTICS_EVENTS.serverStarted, {
        port: config.port,
        catch_up: config.catchUp,
        panel_enabled: config.panelEnabled && Boolean(config.panelUrl),
        slack_configured: Boolean(config.slackBotToken && config.slackAppToken),
        telegram_configured: Boolean(config.telegramBotToken),
      });
    }));

  program
    .command('run <agentId>')
    .description('Run a specific agent immediately (ignores schedule)')
    .option('--with <context>', 'Extra context appended to the agent prompt')
    .action(instrument(analytics, 'run', async (agentId: string, options: { with?: string }) => {
      const config = dependencies.loadConfig(dependencies.env);
      await dependencies.runSingleAgent(config, agentId, { promptSuffix: options.with });
    }));

  program
    .command('list')
    .description('List all discovered agents')
    .action(instrument(analytics, 'list', async () => {
      const config = dependencies.loadConfig(dependencies.env);
      await dependencies.listAgents(config);
    }));

  program
    .command('pair <code>')
    .description('Exchange a pairing code from Agent Panel for this machine\'s own credential')
    .action(instrument(analytics, 'pair', async (code: string) => {
      const config = dependencies.loadConfig(dependencies.env);

      if (!config.panelUrl) {
        console.error('AGENT_SERVER_PANEL_URL is not set, so there is no Panel to pair with.');
        process.exitCode = 1;
        return;
      }

      const machineId = loadOrCreateMachineId(config.workspaceDir);
      const result = await redeemPairingCode({
        code,
        panelUrl: config.panelUrl,
        machineId,
        serverVersion: AGENT_SERVER_VERSION,
      });

      if (!result.ok) {
        console.error(result.error);
        process.exitCode = 1;
        return;
      }

      savePairing(config.workspaceDir, result.record);
      console.log(`Paired as "${result.record.displayName}".`);
      console.log('Restart Agent Server for it to start using this credential.');
    }));

  program
    .command('init')
    .description('Create config directory with sample agents and an .env scaffold')
    .action(instrument(analytics, 'init', () => {
      dependencies.initAgentServer(dependencies.baseDir, { verbose: true });
      analytics.capture(ANALYTICS_EVENTS.workspaceInitialized);
    }));

  program
    .command('cleanup')
    .description('Mark orphaned panel runs as failed')
    .action(instrument(analytics, 'cleanup', async () => {
      const config = dependencies.loadConfig(dependencies.env);
      const panelClient = dependencies.createPanelClient(config);
      const exitCode = await dependencies.runCleanupCommand(panelClient, dependencies.output);
      if (exitCode !== 0) dependencies.setExitCode(exitCode);
    }));

  program
    .command('install')
    .description('Install macOS LaunchAgent for auto-start on login')
    .action(instrument(analytics, 'install', () => {
      const config = dependencies.loadConfig(dependencies.env);
      const plistPath = dependencies.installLaunchAgent({
        cliPath: dependencies.argv[1] ?? '',
        logsDir: config.logsDir,
      });
      dependencies.output.log(`LaunchAgent installed: ${plistPath}`);
      dependencies.output.log('');
      dependencies.output.log('To activate now:');
      dependencies.output.log(`  launchctl load ${plistPath}`);
      dependencies.output.log('');
      dependencies.output.log('To deactivate:');
      dependencies.output.log(`  launchctl unload ${plistPath}`);
      analytics.capture(ANALYTICS_EVENTS.launchAgentChanged, { action: 'installed' });
    }));

  program
    .command('uninstall')
    .description('Remove the macOS LaunchAgent')
    .action(instrument(analytics, 'uninstall', () => {
      dependencies.uninstallLaunchAgent();
      dependencies.output.log('LaunchAgent removed.');
      dependencies.output.log(
        'Run `launchctl remove com.agent-server.daemon` to stop the running instance.',
      );
      analytics.capture(ANALYTICS_EVENTS.launchAgentChanged, { action: 'removed' });
    }));

  return program;
}

function createProductionDependencies(): CliDependencies {
  const baseDir = process.env.AGENT_SERVER_HOME || join(homedir(), '.agent-server');
  const fileEnv = loadEnvFile(baseDir, process.env);
  Object.assign(process.env, fileEnv);
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  return {
    baseDir,
    argv: process.argv,
    env: process.env,
    anthropicApiKey,
    output: console,
    initAgentServer,
    loadEnvFile,
    loadConfig,
    startFileLogger: async (logsDir) => {
      const { startFileLogger } = await import('./platform/file-logger.js');
      startFileLogger({ logsDir });
    },
    startServer,
    runSingleAgent,
    listAgents,
    createPanelClient,
    runCleanupCommand,
    installLaunchAgent,
    uninstallLaunchAgent,
    onSignal: (signal, listener) => {
      process.on(signal, listener);
    },
    exit: (code) => {
      process.exit(code);
    },
    setExitCode: (code) => {
      process.exitCode = code;
    },
    analytics: createAnalyticsFromEnvironment(),
    now: () => Date.now(),
  };
}

async function runCli(argv: string[] = process.argv): Promise<void> {
  const dependencies = createProductionDependencies();
  await createCli({ ...dependencies, argv }).parseAsync(argv);
}

function isDirectExecution(argv: string[]): boolean {
  const executable = argv[1];
  if (!executable) return false;
  try {
    return realpathSync(executable) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectExecution(process.argv)) {
  void runCli().catch((error) => {
    console.error(`Command failed: ${toErrorMessage(error)}`);
    process.exitCode = 1;
  });
}
