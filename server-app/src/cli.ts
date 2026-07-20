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
};

/** Construct the CLI without reading process state or starting background work. */
export function createCli(dependencies: CliDependencies): Command {
  const program = new Command();

  program
    .name('agent-server')
    .description('Lightweight agent orchestration server for Claude Code, Codex, and Kimi Code')
    .version(AGENT_SERVER_VERSION);

  program
    .command('start')
    .description('Start the server with HTTP API and agent scheduler')
    .action(async () => {
      dependencies.initAgentServer(dependencies.baseDir);
      Object.assign(
        dependencies.env,
        dependencies.loadEnvFile(dependencies.baseDir, dependencies.env),
      );
      const config = dependencies.loadConfig(dependencies.env);

      await dependencies.startFileLogger(config.logsDir);
      const server = dependencies.startServer(config, {
        anthropicApiKey: dependencies.anthropicApiKey,
      });

      let isShuttingDown = false;
      const shutdown = async (): Promise<void> => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        let exitCode = 0;
        try {
          await server.stop();
        } catch (error) {
          exitCode = 1;
          dependencies.output.error(`[shutdown] error: ${toErrorMessage(error)}`);
        } finally {
          dependencies.exit(exitCode);
        }
      };

      dependencies.onSignal('SIGINT', () => { void shutdown(); });
      dependencies.onSignal('SIGTERM', () => { void shutdown(); });

      try {
        await server.ready;
      } catch (error) {
        try {
          await server.stop();
        } catch (cleanupError) {
          dependencies.output.error(
            `[startup] cleanup error: ${toErrorMessage(cleanupError)}`,
          );
        }
        throw error;
      }
    });

  program
    .command('run <agentId>')
    .description('Run a specific agent immediately (ignores schedule)')
    .option('--with <context>', 'Extra context appended to the agent prompt')
    .action(async (agentId: string, options: { with?: string }) => {
      const config = dependencies.loadConfig(dependencies.env);
      await dependencies.runSingleAgent(config, agentId, { promptSuffix: options.with });
    });

  program
    .command('list')
    .description('List all discovered agents')
    .action(async () => {
      const config = dependencies.loadConfig(dependencies.env);
      await dependencies.listAgents(config);
    });

  program
    .command('init')
    .description('Create config directory with sample agents and an .env scaffold')
    .action(() => {
      dependencies.initAgentServer(dependencies.baseDir, { verbose: true });
    });

  program
    .command('cleanup')
    .description('Mark orphaned panel runs as failed')
    .action(async () => {
      const config = dependencies.loadConfig(dependencies.env);
      const panelClient = dependencies.createPanelClient(config);
      const exitCode = await dependencies.runCleanupCommand(panelClient, dependencies.output);
      if (exitCode !== 0) dependencies.setExitCode(exitCode);
    });

  program
    .command('install')
    .description('Install macOS LaunchAgent for auto-start on login')
    .action(() => {
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
    });

  program
    .command('uninstall')
    .description('Remove the macOS LaunchAgent')
    .action(() => {
      dependencies.uninstallLaunchAgent();
      dependencies.output.log('LaunchAgent removed.');
      dependencies.output.log(
        'Run `launchctl remove com.agent-server.daemon` to stop the running instance.',
      );
    });

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
