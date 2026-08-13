import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { LOG_LEVELS, LogEntryTooLargeError, type AgentLogStore, type LogLevel } from './log-store.js';
import { buildLogReadTool } from './log-read-tool.js';

export const AGENT_LOG_SERVER_NAME = 'agent_log';
export const AGENT_LOG_TOOL_NAME = 'mcp__agent_log__write_log';

const TOOL_DESCRIPTION = [
  'Write a log entry for this run.',
  'Use it to record what happened, and to keep a document that could not be delivered',
  'to its destination, such as a page body an external service refused.',
  'The server owns the location, so there is no path to pass and no file access to grant.',
].join(' ');

export type LogToolContext = {
  store: AgentLogStore;
  agentId: string;
  runId: string;
};

export type LogToolInput = {
  message: string;
  level?: LogLevel;
  body?: string;
  data?: Record<string, unknown>;
};

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

const inputShape = {
  message: z.string().min(1).max(500).describe('One line saying what happened.'),
  level: z.enum(LOG_LEVELS).optional().describe('debug, info, warn, or error. Defaults to info.'),
  body: z.string().optional().describe('Long text to keep with the entry, such as an undelivered document.'),
  data: z.record(z.string(), z.unknown()).optional().describe('Extra fields to record alongside the message.'),
};

export async function writeAgentLog(
  context: LogToolContext,
  input: LogToolInput,
): Promise<ToolResult> {
  if (input.message.trim().length === 0) {
    return errorResult('The log entry had no message, so nothing was written.');
  }
  try {
    const record = context.store.append({
      agentId: context.agentId,
      runId: context.runId,
      message: input.message,
      level: input.level,
      body: input.body,
      data: input.data,
    });
    return { content: [{ type: 'text', text: `Logged at ${record.timestamp}.` }] };
  } catch (error) {
    if (error instanceof LogEntryTooLargeError) return errorResult(error.message);
    return errorResult(`The log entry could not be written: ${(error as Error).message}`);
  }
}

export function createAgentLogMcpServer(context: LogToolContext) {
  return createSdkMcpServer({
    name: AGENT_LOG_SERVER_NAME,
    version: '1.0.0',
    tools: [
      tool('write_log', TOOL_DESCRIPTION, inputShape, async (args) => writeAgentLog(context, {
        message: args.message,
        level: args.level,
        body: args.body,
        data: args.data,
      })),
      buildLogReadTool(context),
    ],
  });
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}
