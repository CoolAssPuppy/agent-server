import { spawn } from 'child_process';
import type { AgentConfig } from './agent-config.js';
import type { Reporter } from './runner.js';
import { expandHome } from './file-watcher.js';

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

export function summarizeTurn(event: ClaudeStreamEvent): string | null {
  if (event.type === 'result' && typeof event.result === 'string') {
    return truncate(event.result);
  }

  if (event.type !== 'assistant' || !event.message?.content) return null;

  const textParts: string[] = [];
  let toolName: string | null = null;

  for (const block of event.message.content) {
    if (block.type === 'text' && block.text) {
      textParts.push(block.text);
    } else if (block.type === 'tool_use' && block.name) {
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

export async function executeAgent(
  agent: AgentConfig,
  reporter: Reporter,
): Promise<ExecutionResult> {
  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--max-turns', String(agent.max_turns),
    '--verbose',
  ];

  if (agent.tools.length > 0) {
    args.push('--allowedTools', agent.tools.join(','));
  }

  args.push(agent.prompt);

  const cwd = agent.working_directory
    ? expandHome(agent.working_directory)
    : process.env.HOME ?? process.cwd();

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let turnCount = 0;
    const toolsUsed = new Set<string>();
    const allFilesRead = new Set<string>();
    const allFilesWritten = new Set<string>();
    const allCommandsRun: string[] = [];
    let lastSummary = '';
    let buffer = '';

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const event = parseStreamEvent(line);
        if (!event) continue;

        const meta = extractToolMetadata(event);

        if (event.type === 'assistant') {
          turnCount++;
        }

        meta.toolNames.forEach((name) => toolsUsed.add(name));
        meta.filesRead.forEach((f) => allFilesRead.add(f));
        meta.filesWritten.forEach((f) => allFilesWritten.add(f));
        allCommandsRun.push(...meta.commandsRun);

        const summary = summarizeTurn(event);
        if (summary) {
          lastSummary = summary;
          void reporter.progress(summary, {
            turns_completed: turnCount,
            tools_used: [...toolsUsed],
            files_written: [...allFilesWritten],
            commands_run: allCommandsRun.length,
          });
        }
      }
    });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      if (buffer.trim()) {
        const event = parseStreamEvent(buffer);
        if (event) {
          const summary = summarizeTurn(event);
          if (summary) lastSummary = summary;
        }
      }

      if (code !== 0) {
        reject(new Error(`Claude Code exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }

      resolve({
        summary: lastSummary || 'Agent completed',
        output: {},
        usage: {
          turns: turnCount,
          files_read: allFilesRead.size,
          files_written: allFilesWritten.size,
          commands_run: allCommandsRun.length,
        },
        turnCount,
        toolsUsed: [...toolsUsed],
        filesRead: [...allFilesRead],
        filesWritten: [...allFilesWritten],
        commandsRun: allCommandsRun,
      });
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn Claude Code: ${err.message}`));
    });
  });
}
