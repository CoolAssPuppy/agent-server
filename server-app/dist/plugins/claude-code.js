import { query } from '@anthropic-ai/claude-agent-sdk';
import { resolveEnvVars } from '../agents/config.js';
import { truncate, WRITE_TOOLS } from '../execution/executor.js';
import { expandHome } from '../agents/file-watcher.js';
import { parseInteractionBlock } from '../interaction/parser.js';
import { buildCanUseTool } from '../execution/permissions.js';
export async function executeAgent(agent, reporter, extra) {
    const cwd = agent.working_directory
        ? expandHome(agent.working_directory)
        : process.env.HOME ?? process.cwd();
    const permissionMode = agent.permission_mode ?? 'bypassPermissions';
    const options = {
        maxTurns: agent.max_turns,
        cwd,
        permissionMode,
        allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions' ? true : undefined,
        allowedTools: agent.tools.length > 0 ? agent.tools : undefined,
        disallowedTools: agent.disallowed_tools && agent.disallowed_tools.length > 0
            ? agent.disallowed_tools
            : undefined,
        canUseTool: agent.permissions ? buildCanUseTool(agent.permissions) : undefined,
        abortController: extra?.abortController,
        mcpServers: buildMcpServers(agent),
    };
    let turnCount = 0;
    const toolsUsed = new Set();
    const allFilesRead = new Set();
    const allFilesWritten = new Set();
    const allCommandsRun = [];
    let lastAssistantText = '';
    let lastToolName = null;
    let mcpServers = [];
    const stream = query({ prompt: agent.prompt, options });
    mcpServers = await handleMcpServerStatus(stream, reporter);
    for await (const message of stream) {
        if (message.type === 'assistant') {
            turnCount++;
            const content = message.message?.content;
            if (!Array.isArray(content))
                continue;
            const textParts = [];
            for (const block of content) {
                if (block.type === 'text' && 'text' in block) {
                    textParts.push(block.text);
                }
                if (block.type === 'tool_use' && 'name' in block) {
                    const name = block.name;
                    toolsUsed.add(name);
                    lastToolName = name;
                    const input = ('input' in block ? block.input : {});
                    const filePath = typeof input.file_path === 'string' ? input.file_path : null;
                    if (name === 'Read' && filePath) {
                        allFilesRead.add(filePath);
                    }
                    else if (WRITE_TOOLS.has(name) && filePath) {
                        allFilesWritten.add(filePath);
                    }
                    else if (name === 'Bash' && typeof input.command === 'string') {
                        allCommandsRun.push(input.command);
                    }
                }
            }
            if (textParts.length > 0) {
                lastAssistantText = textParts.join('\n');
            }
            const summary = textParts.length > 0
                ? truncate(textParts.join(' '))
                : lastToolName
                    ? `Using tool: ${lastToolName}`
                    : null;
            if (summary) {
                void reporter.progress(summary, {
                    turns_completed: turnCount,
                    tools_used: [...toolsUsed],
                    files_written: [...allFilesWritten],
                    commands_run: allCommandsRun.length,
                });
            }
        }
        if (message.type === 'result') {
            if (message.subtype !== 'success') {
                const errors = 'errors' in message ? message.errors : [];
                throw new Error(errors.join('; ') || `Agent failed: ${message.subtype}`);
            }
            const resultText = 'result' in message ? message.result : '';
            return buildResult({
                summary: resultText || 'Agent completed',
                turnCount: message.num_turns,
                toolsUsed,
                allFilesRead,
                allFilesWritten,
                allCommandsRun,
                lastAssistantText,
                mcpServers,
            });
        }
    }
    return buildResult({
        summary: lastAssistantText || 'Agent completed',
        turnCount,
        toolsUsed,
        allFilesRead,
        allFilesWritten,
        allCommandsRun,
        lastAssistantText,
        mcpServers,
    });
}
function buildResult(params) {
    const interaction = parseInteractionBlock(params.lastAssistantText);
    return {
        summary: params.summary,
        output: {},
        usage: {
            turns: params.turnCount,
            files_read: params.allFilesRead.size,
            files_written: params.allFilesWritten.size,
            commands_run: params.allCommandsRun.length,
        },
        turnCount: params.turnCount,
        toolsUsed: [...params.toolsUsed],
        filesRead: [...params.allFilesRead],
        filesWritten: [...params.allFilesWritten],
        commandsRun: params.allCommandsRun,
        interaction,
        mcpServers: params.mcpServers.length > 0 ? params.mcpServers : undefined,
    };
}
export const RECONNECT_DELAY_MS = 3000;
export const MAX_RECONNECT_ATTEMPTS = 2;
function logMcpStatus(servers) {
    const connected = servers.filter((s) => s.status === 'connected').map((s) => s.name);
    const failed = servers.filter((s) => s.status === 'failed');
    const needsAuth = servers.filter((s) => s.status === 'needs-auth').map((s) => s.name);
    const pending = servers.filter((s) => s.status === 'pending').map((s) => s.name);
    const disabled = servers.filter((s) => s.status === 'disabled').map((s) => s.name);
    if (connected.length > 0) {
        console.log(`[mcp] Connected: ${connected.join(', ')}`);
    }
    if (failed.length > 0) {
        console.error(`[mcp] Failed: ${failed.map((s) => `${s.name}${s.error ? ` (${s.error})` : ''}`).join(', ')}`);
    }
    if (needsAuth.length > 0) {
        console.error(`[mcp] Needs auth: ${needsAuth.join(', ')} -- re-authenticate in Claude Code`);
    }
    if (pending.length > 0) {
        console.log(`[mcp] Pending: ${pending.join(', ')}`);
    }
    if (disabled.length > 0) {
        console.log(`[mcp] Disabled: ${disabled.join(', ')}`);
    }
}
async function fetchMcpStatus(stream) {
    try {
        const statuses = await stream.mcpServerStatus();
        return statuses.map((s) => ({
            name: s.name,
            status: s.status,
            error: s.error,
        }));
    }
    catch {
        return [];
    }
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function handleMcpServerStatus(stream, reporter) {
    const servers = await fetchMcpStatus(stream);
    if (servers.length === 0)
        return [];
    logMcpStatus(servers);
    const failedServers = servers.filter((s) => s.status === 'failed');
    if (failedServers.length > 0) {
        for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
            console.log(`[mcp] Reconnecting failed servers (attempt ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS})...`);
            for (const server of failedServers) {
                try {
                    await stream.reconnectMcpServer(server.name);
                }
                catch {
                    console.error(`[mcp] Reconnect failed for ${server.name}`);
                }
            }
            await delay(RECONNECT_DELAY_MS);
            const updated = await fetchMcpStatus(stream);
            const stillFailed = updated.filter((s) => s.status === 'failed');
            if (stillFailed.length === 0) {
                console.log('[mcp] All servers reconnected successfully');
                logMcpStatus(updated);
                reportMcpStatus(updated, reporter);
                return updated;
            }
            if (attempt === MAX_RECONNECT_ATTEMPTS - 1) {
                console.error(`[mcp] Servers still failed after ${MAX_RECONNECT_ATTEMPTS} attempts: ${stillFailed.map((s) => s.name).join(', ')}`);
                logMcpStatus(updated);
                reportMcpStatus(updated, reporter);
                return updated;
            }
        }
    }
    reportMcpStatus(servers, reporter);
    return servers;
}
function reportMcpStatus(servers, reporter) {
    const connected = servers.filter((s) => s.status === 'connected').length;
    const failed = servers.filter((s) => s.status === 'failed').length;
    const needsAuth = servers.filter((s) => s.status === 'needs-auth').length;
    const parts = [];
    if (connected > 0)
        parts.push(`${connected} connected`);
    if (failed > 0)
        parts.push(`${failed} failed`);
    if (needsAuth > 0)
        parts.push(`${needsAuth} needs auth`);
    if (parts.length > 0) {
        void reporter.progress(`[mcp] ${parts.join(', ')}`, {
            mcp_servers: servers,
        });
    }
}
export function buildMcpServers(agent) {
    const servers = {};
    if (agent.mcp_servers) {
        for (const [name, config] of Object.entries(agent.mcp_servers)) {
            if ('command' in config) {
                servers[name] = {
                    ...config,
                    env: config.env ? resolveEnvVars(config.env) : undefined,
                };
            }
            else if ('url' in config) {
                servers[name] = {
                    ...config,
                    headers: config.headers ? resolveEnvVars(config.headers) : undefined,
                };
            }
        }
    }
    const eventKitBin = process.env.AGENT_SERVER_EVENTKIT_BIN;
    if (eventKitBin && !servers.eventkit) {
        servers.eventkit = {
            type: 'stdio',
            command: eventKitBin,
            args: [],
        };
    }
    return Object.keys(servers).length > 0 ? servers : undefined;
}
//# sourceMappingURL=claude-code.js.map