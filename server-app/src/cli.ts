#!/usr/bin/env node

import { Command } from 'commander';
import { homedir } from 'os';
import { join } from 'path';
import { loadConfig, loadEnvFile } from './platform/config.js';
import { listAgents, runSingleAgent } from './server/daemon.js';
import { startServer } from './server/server.js';
import { initAgentServer } from './platform/init.js';
import { installLaunchAgent, uninstallLaunchAgent } from './platform/launchd.js';
import { createPanelClient } from './reporting/panel-client.js';

const baseDir = process.env.AGENT_SERVER_HOME || join(homedir(), '.agent-server');
const fileEnv = loadEnvFile(baseDir, process.env);
Object.assign(process.env, fileEnv);

const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const program = new Command();

program
  .name('agent-server')
  .description('Lightweight agent orchestration server powered by Claude Code')
  .version('3.0.2');

program
  .command('start')
  .description('Start the server with HTTP API and agent scheduler')
  .action(() => {
    // Self-heal on every launch: idempotently ensure ~/.agent-server/
    // has its directories, .env scaffold, and sample agents. This makes
    // the macOS app work out of the box on first install without the
    // user having to run `agent-server init` manually.
    initAgentServer(baseDir);

    // Initialization creates the local API key on first launch. Reload the
    // file so that same launch uses the freshly generated credential.
    Object.assign(process.env, loadEnvFile(baseDir, process.env));

    const config = loadConfig();

    // Mirror console output to a rotated file sink so users can diagnose
    // stuck runs without relying on the parent process to preserve stdout.
    // Safe to run regardless of how the daemon was launched (launchd, GUI
    // app child, manual shell).
    // Lazy-loaded so tests that import CLI symbols don't trigger FS work.
    void import('./platform/file-logger.js').then(({ startFileLogger }) => {
      startFileLogger({ logsDir: config.logsDir });
    });

    const server = startServer(config, { anthropicApiKey });

    let shuttingDown = false;
    const shutdown = async (): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;
      try {
        await server.stop();
      } catch (err) {
        console.error('[shutdown] error:', err);
      } finally {
        process.exit(0);
      }
    };

    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });
  });

program
  .command('run <agentId>')
  .description('Run a specific agent immediately (ignores schedule)')
  .option('--with <context>', 'Extra context appended to the agent prompt')
  .action(async (agentId: string, opts: { with?: string }) => {
    const config = loadConfig();
    await runSingleAgent(config, agentId, { promptSuffix: opts.with });
  });

program
  .command('list')
  .description('List all discovered agents')
  .action(async () => {
    const config = loadConfig();
    await listAgents(config);
  });

program
  .command('init')
  .description('Create config directory with sample agents and an .env scaffold')
  .action(() => {
    initAgentServer(baseDir, { verbose: true });
  });

program
  .command('cleanup')
  .description('Mark orphaned panel runs as failed')
  .action(async () => {
    const config = loadConfig();
    const panelClient = createPanelClient(config);

    if (!panelClient) {
      console.error('No panel URL configured. Set AGENT_SERVER_PANEL_URL and AGENT_SERVER_PANEL_API_KEY.');
      process.exit(1);
    }

    const cleaned = await panelClient.failOrphanedRuns();
    console.log(`Cleaned up ${cleaned} orphaned run(s).`);
  });

program
  .command('install')
  .description('Install macOS LaunchAgent for auto-start on login')
  .action(() => {
    const cliPath = process.argv[1];
    const config = loadConfig();
    const plistPath = installLaunchAgent({
      cliPath,
      logsDir: config.logsDir,
    });
    console.log(`LaunchAgent installed: ${plistPath}`);
    console.log('');
    console.log('To activate now:');
    console.log(`  launchctl load ${plistPath}`);
    console.log('');
    console.log('To deactivate:');
    console.log(`  launchctl unload ${plistPath}`);
  });

program
  .command('uninstall')
  .description('Remove the macOS LaunchAgent')
  .action(() => {
    uninstallLaunchAgent();
    console.log('LaunchAgent removed.');
    console.log('Run `launchctl remove com.agent-server.daemon` to stop the running instance.');
  });

program.parse();
