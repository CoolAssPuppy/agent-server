import { mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { AgentConfig } from './agents/config.js';
import type { ExecutionResult } from './execution/executor.js';
import type { StoredRun } from './reporting/store.js';
import type { Conversation, ConversationMessage } from './conversation/schema.js';
import type { Analytics } from './analytics/analytics.js';
import type { AnalyticsEventName, AnalyticsProperties } from './analytics/events.js';

export function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
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

export function makeExecutionResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
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

export function makeStoredRun(overrides: Partial<StoredRun> = {}): StoredRun {
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

export function makeConversationMessage(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    role: 'user',
    content: 'Hello',
    createdAt: new Date('2026-03-12T10:00:00Z'),
    ...overrides,
  };
}

export function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
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

export function createTempDir(label: string = 'test'): string {
  const dir = join(tmpdir(), `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export type RecordedAnalyticsEvent = {
  event: AnalyticsEventName;
  properties: AnalyticsProperties;
};

export type RecordingAnalytics = Analytics & {
  readonly captured: RecordedAnalyticsEvent[];
  names: () => AnalyticsEventName[];
  find: (event: AnalyticsEventName) => RecordedAnalyticsEvent | undefined;
};

/** In-memory analytics for tests: records captures instead of sending them. */
export function makeRecordingAnalytics(): RecordingAnalytics {
  const captured: RecordedAnalyticsEvent[] = [];
  return {
    captured,
    names: () => captured.map(({ event }) => event),
    find: (event) => captured.find((entry) => entry.event === event),
    capture: (event, properties = {}) => {
      captured.push({ event, properties });
    },
    flush: async () => {},
    shutdown: async () => {},
  };
}
