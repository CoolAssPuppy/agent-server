import type { AgentConfig } from './agents/config.js';
import type { ExecutionResult } from './execution/executor.js';
import type { StoredRun } from './reporting/store.js';
import type { Conversation, ConversationMessage } from './conversation/schema.js';
export declare function makeAgent(overrides?: Partial<AgentConfig>): AgentConfig;
export declare function makeExecutionResult(overrides?: Partial<ExecutionResult>): ExecutionResult;
export declare function makeStoredRun(overrides?: Partial<StoredRun>): StoredRun;
export declare function makeConversationMessage(overrides?: Partial<ConversationMessage>): ConversationMessage;
export declare function makeConversation(overrides?: Partial<Conversation>): Conversation;
export declare function createTempDir(label?: string): string;
//# sourceMappingURL=test-factories.d.ts.map