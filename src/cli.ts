#!/usr/bin/env node

import { Command } from 'commander';
import { homedir } from 'os';
import { join } from 'path';
import { loadConfig } from './config.js';
import { listAgents, runSingleAgent } from './daemon.js';
import { startServer } from './server.js';
import { initAgentServer } from './init.js';

const program = new Command();

program
  .name('agent-server')
  .description('Lightweight agent orchestration server powered by Claude Code')
  .version('0.1.0');

program
  .command('start')
  .description('Start the server with HTTP API and agent scheduler')
  .action(() => {
    const config = loadConfig();
    const server = startServer(config);

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
  .action(async (agentId: string) => {
    const config = loadConfig();
    await runSingleAgent(config, agentId);
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
  .description('Create config directory with a sample agent')
  .action(() => {
    const baseDir = join(homedir(), '.agent-server');
    initAgentServer(baseDir);
  });

program.parse();
