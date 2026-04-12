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
const baseDir = join(homedir(), '.agent-server');
const fileEnv = loadEnvFile(baseDir, process.env);
Object.assign(process.env, fileEnv);
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
const program = new Command();
program
    .name('agent-server')
    .description('Lightweight agent orchestration server powered by Claude Code')
    .version('0.1.0');
program
    .command('start')
    .description('Start the server with HTTP API and agent scheduler')
    .action(() => {
    // Self-heal on every launch: idempotently ensure ~/.agent-server/
    // has its directories, .env scaffold, and sample agents. This makes
    // the macOS app work out of the box on first install without the
    // user having to run `agent-server init` manually.
    initAgentServer(baseDir);
    const config = loadConfig();
    const server = startServer(config, { anthropicApiKey });
    const shutdown = () => {
        server.stop();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
});
program
    .command('run <agentId>')
    .description('Run a specific agent immediately (ignores schedule)')
    .option('--with <context>', 'Extra context appended to the agent prompt')
    .action(async (agentId, opts) => {
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
//# sourceMappingURL=cli.js.map