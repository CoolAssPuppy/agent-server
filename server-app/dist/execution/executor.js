export const MAX_SUMMARY_LENGTH = 200;
export function parseStreamEvent(line) {
    const trimmed = line.trim();
    if (!trimmed)
        return null;
    try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
export function truncate(text) {
    if (text.length <= MAX_SUMMARY_LENGTH)
        return text;
    let end = MAX_SUMMARY_LENGTH;
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
        end--;
    }
    return text.slice(0, end) + '...';
}
export function extractTextParts(event) {
    if (event.type !== 'assistant' || !event.message?.content)
        return [];
    const parts = [];
    for (const block of event.message.content) {
        if (block.type === 'text' && block.text) {
            parts.push(block.text);
        }
    }
    return parts;
}
export function summarizeTurn(event) {
    if (event.type === 'result' && typeof event.result === 'string') {
        return truncate(event.result);
    }
    if (event.type !== 'assistant' || !event.message?.content)
        return null;
    const textParts = extractTextParts(event);
    let toolName = null;
    for (const block of event.message.content) {
        if (block.type === 'tool_use' && block.name) {
            toolName = block.name;
        }
    }
    if (textParts.length > 0) {
        return truncate(textParts.join(' '));
    }
    if (toolName) {
        return `Using tool: ${toolName}`;
    }
    return null;
}
export const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
export function extractToolMetadata(event) {
    const toolNames = [];
    const filesRead = [];
    const filesWritten = [];
    const commandsRun = [];
    if (event.type !== 'assistant' || !event.message?.content) {
        return { toolNames, filesRead, filesWritten, commandsRun };
    }
    for (const block of event.message.content) {
        if (block.type !== 'tool_use' || !block.name)
            continue;
        toolNames.push(block.name);
        const input = block.input ?? {};
        const filePath = typeof input.file_path === 'string' ? input.file_path : null;
        if (block.name === 'Read' && filePath) {
            filesRead.push(filePath);
        }
        else if (WRITE_TOOLS.has(block.name) && filePath) {
            filesWritten.push(filePath);
        }
        else if (block.name === 'Bash' && typeof input.command === 'string') {
            commandsRun.push(input.command);
        }
    }
    return { toolNames, filesRead, filesWritten, commandsRun };
}
//# sourceMappingURL=executor.js.map