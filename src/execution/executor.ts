import type { InteractionRequest } from '../interaction/schema.js';

const MAX_SUMMARY_LENGTH = 200;

export type ClaudeStreamEvent = {
  type: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
  result?: string;
  [key: string]: unknown;
};

export type ExecutionResult = {
  summary: string;
  output: Record<string, unknown>;
  usage: Record<string, unknown>;
  turnCount: number;
  toolsUsed: string[];
  filesRead: string[];
  filesWritten: string[];
  commandsRun: string[];
  interaction?: InteractionRequest;
};

export function parseStreamEvent(line: string): ClaudeStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as ClaudeStreamEvent;
  } catch {
    return null;
  }
}

function truncate(text: string): string {
  if (text.length <= MAX_SUMMARY_LENGTH) return text;
  return text.slice(0, MAX_SUMMARY_LENGTH) + '...';
}

export function extractTextParts(event: ClaudeStreamEvent): string[] {
  if (event.type !== 'assistant' || !event.message?.content) return [];

  const parts: string[] = [];
  for (const block of event.message.content) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
    }
  }
  return parts;
}

export function summarizeTurn(event: ClaudeStreamEvent): string | null {
  if (event.type === 'result' && typeof event.result === 'string') {
    return truncate(event.result);
  }

  if (event.type !== 'assistant' || !event.message?.content) return null;

  const textParts = extractTextParts(event);
  let toolName: string | null = null;

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

type ToolMetadata = {
  toolNames: string[];
  filesRead: string[];
  filesWritten: string[];
  commandsRun: string[];
};

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

export function extractToolMetadata(event: ClaudeStreamEvent): ToolMetadata {
  const toolNames: string[] = [];
  const filesRead: string[] = [];
  const filesWritten: string[] = [];
  const commandsRun: string[] = [];

  if (event.type !== 'assistant' || !event.message?.content) {
    return { toolNames, filesRead, filesWritten, commandsRun };
  }

  for (const block of event.message.content) {
    if (block.type !== 'tool_use' || !block.name) continue;

    toolNames.push(block.name);
    const input = block.input ?? {};
    const filePath = typeof input.file_path === 'string' ? input.file_path : null;

    if (block.name === 'Read' && filePath) {
      filesRead.push(filePath);
    } else if (WRITE_TOOLS.has(block.name) && filePath) {
      filesWritten.push(filePath);
    } else if (block.name === 'Bash' && typeof input.command === 'string') {
      commandsRun.push(input.command);
    }
  }

  return { toolNames, filesRead, filesWritten, commandsRun };
}
