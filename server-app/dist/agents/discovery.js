import { readdir, readFile } from 'fs/promises';
import { join, extname } from 'path';
import { parseAgentFile } from './config.js';
export const AGENT_EXTENSIONS = new Set(['.yaml', '.yml', '.md']);
function isAgentFile(filename) {
    return AGENT_EXTENSIONS.has(extname(filename));
}
async function tryParseAgent(directory, file) {
    try {
        const content = await readFile(join(directory, file), 'utf-8');
        return parseAgentFile(content);
    }
    catch {
        console.warn(`Skipping invalid agent definition: ${file}`);
        return null;
    }
}
export async function discoverAgents(directory) {
    let entries;
    try {
        entries = await readdir(directory);
    }
    catch {
        return [];
    }
    const agentFiles = entries.filter(isAgentFile).sort();
    const results = await Promise.all(agentFiles.map((file) => tryParseAgent(directory, file)));
    const unique = new Map();
    for (const agent of results) {
        if (!agent)
            continue;
        if (unique.has(agent.id)) {
            console.warn(`Skipping duplicate agent id: ${agent.id}`);
            continue;
        }
        unique.set(agent.id, agent);
    }
    return [...unique.values()]
        .sort((a, b) => a.id.localeCompare(b.id));
}
//# sourceMappingURL=discovery.js.map