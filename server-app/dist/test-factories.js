import { mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
export function makeAgent(overrides = {}) {
    return {
        id: 'test-agent',
        name: 'Test Agent',
        schedule: '* * * * *',
        prompt: 'Do something.',
        tools: [],
        disallowed_tools: [],
        max_turns: 20,
        enabled: true,
        ...overrides,
    };
}
export function makeExecutionResult(overrides = {}) {
    return {
        summary: 'Done',
        output: {},
        usage: { turns: 3 },
        turnCount: 3,
        toolsUsed: ['Read'],
        filesRead: [],
        filesWritten: [],
        commandsRun: [],
        ...overrides,
    };
}
export function makeStoredRun(overrides = {}) {
    return {
        runId: 'run-1',
        agentId: 'test-agent',
        agentName: 'Test Agent',
        status: 'completed',
        startedAt: new Date('2026-03-09T10:00:00Z'),
        turnCount: 3,
        toolsUsed: ['Read'],
        filesRead: [],
        filesWritten: [],
        commandsRun: [],
        progressMessages: [],
        ...overrides,
    };
}
export function makeConversationMessage(overrides = {}) {
    return {
        role: 'user',
        content: 'Hello',
        createdAt: new Date('2026-03-12T10:00:00Z'),
        ...overrides,
    };
}
export function makeConversation(overrides = {}) {
    return {
        id: 'conv-1',
        chatId: 123,
        agentId: 'test-agent',
        messages: [],
        createdAt: new Date('2026-03-12T10:00:00Z'),
        expiresAt: new Date('2026-03-12T10:30:00Z'),
        status: 'active',
        ...overrides,
    };
}
export function createTempDir(label = 'test') {
    const dir = join(tmpdir(), `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    return dir;
}
//# sourceMappingURL=test-factories.js.map