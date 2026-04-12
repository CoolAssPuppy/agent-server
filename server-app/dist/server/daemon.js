import { randomUUID } from 'crypto';
import { discoverAgents } from '../agents/discovery.js';
import { shouldRun } from '../agents/scheduler.js';
import { runAgent } from '../execution/runner.js';
import { executeAgent } from '../plugins/claude-code.js';
import { ExecutorRegistry } from '../execution/executor-registry.js';
import { createReporter } from '../reporting/reporter-factory.js';
import { ConsoleChannel } from '../channels/console.js';
function createDefaultRegistry() {
    const registry = new ExecutorRegistry();
    registry.register('claude-code', executeAgent);
    registry.setDefault('claude-code');
    return registry;
}
function runAgentWithConfig(config, agent, options = {}) {
    const registry = createDefaultRegistry();
    return runAgent({
        agent,
        lockDir: config.lockDir,
        execute: (a, reporter) => registry.resolve(a)(a, reporter),
        createReporter: (runId, agentName, convId) => createReporter(config, runId, agentName, { conversationId: convId }),
        promptSuffix: options.promptSuffix,
    });
}
export async function runDueAgents(config) {
    const agents = await discoverAgents(config.agentsDir);
    const now = new Date();
    const dueAgents = agents.filter((agent) => shouldRun(agent, now));
    if (dueAgents.length === 0)
        return;
    console.log(`[${now.toISOString()}] ${dueAgents.length} agent(s) due: ${dueAgents.map((a) => a.id).join(', ')}`);
    const results = await Promise.allSettled(dueAgents.map((agent) => runAgentWithConfig(config, agent)));
    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const agent = dueAgents[i];
        if (result.status === 'fulfilled') {
            const r = result.value;
            if (r.status === 'skipped') {
                console.log(`  ${agent.id}: skipped (already running)`);
            }
            else {
                console.log(`  ${agent.id}: ${r.status} (run: ${r.runId})`);
            }
        }
        else {
            console.error(`  ${agent.id}: error - ${result.reason}`);
        }
    }
}
export async function runSingleAgent(config, agentId, options = {}) {
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
        const replyAgent = agents.find((a) => a.id === agent.interaction.on_reply);
        if (!replyAgent) {
            console.error(`Reply agent not found: ${agent.interaction.on_reply}`);
            return;
        }
        await handleInteraction(config, agent, result, replyAgent);
    }
}
async function handleInteraction(config, agent, result, replyAgent) {
    if (!result.result?.interaction || !agent.interaction)
        return;
    const interaction = result.result.interaction;
    const interactionId = randomUUID();
    if (agent.interaction.channel !== 'console') {
        console.log(`\nInteraction request sent to ${agent.interaction.channel} (not handled in CLI mode)`);
        return;
    }
    const channel = new ConsoleChannel();
    let reply;
    channel.onReply((r) => {
        reply = r;
    });
    await channel.send(interactionId, interaction);
    if (!reply)
        return;
    const promptSuffix = reply.selectedValue ?? reply.freeText;
    if (!promptSuffix)
        return;
    console.log(`\nTriggering ${replyAgent.name} (${replyAgent.id})...`);
    await runSingleAgent(config, replyAgent.id, { promptSuffix });
}
export async function listAgents(config) {
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
export function startDaemon(config) {
    console.log('Agent Server starting...');
    console.log(`  Agents: ${config.agentsDir}`);
    console.log(`  Check interval: ${config.checkIntervalMs / 1000}s`);
    if (config.panelUrl) {
        console.log(`  Panel: ${config.panelUrl}`);
    }
    else {
        console.log('  Panel: not configured (telemetry disabled)');
    }
    console.log('');
    void runDueAgents(config);
    const interval = setInterval(() => {
        void runDueAgents(config);
    }, config.checkIntervalMs);
    return {
        stop: () => {
            clearInterval(interval);
            console.log('Agent Server stopped.');
        },
    };
}
//# sourceMappingURL=daemon.js.map