import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { LogRecord } from './record.js';
import type { AgentLogger } from './logger.js';
import type { LogToolContext } from './log-tool-context.js';

export const AGENT_LOG_READ_TOOL_NAME = 'mcp__agent_log__read_log';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const TOOL_DESCRIPTION = [
  'Read back what this agent logged on earlier runs, newest first.',
  'Use it to recover state a previous run recorded, such as the last hash it saw,',
  'instead of keeping a file of your own.',
  'Only this agent entries are visible.',
].join(' ');

export type LogReadInput = {
  messageContains?: string;
  limit?: number;
  includeBody?: boolean;
};

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

const inputShape = {
  messageContains: z.string().max(200).optional()
    .describe('Only entries whose message contains this text, matched without case.'),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional()
    .describe(`How many entries to return, newest first. Defaults to ${DEFAULT_LIMIT}.`),
  includeBody: z.boolean().optional()
    .describe('Include the long body of each entry. Off by default because bodies are large.'),
};

export async function readAgentLog(
  context: { logger: AgentLogger; agentId: string },
  input: LogReadInput,
): Promise<ToolResult> {
  const needle = input.messageContains?.toLowerCase();
  // Entries come from the logger's designated readable driver. A read is one
  // answer from one place, never a merge of every driver a write reached.
  const entries = context.logger.readAgent(context.agentId)
    .filter((record) => (needle ? record.message.toLowerCase().includes(needle) : true))
    .reverse()
    .slice(0, Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT))
    .map((record) => (input.includeBody ? record : withoutBody(record)));
  return { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }] };
}

export function buildLogReadTool(context: LogToolContext) {
  return tool('read_log', TOOL_DESCRIPTION, inputShape, async (args) => readAgentLog(context, {
    messageContains: args.messageContains,
    limit: args.limit,
    includeBody: args.includeBody,
  }));
}

function withoutBody(record: LogRecord): Omit<LogRecord, 'body'> {
  const { body: _body, ...rest } = record;
  return rest;
}
