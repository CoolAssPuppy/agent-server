import { spawn } from 'child_process';
import type { AgentConfig } from '../agents/config.js';
import type { Reporter } from '../execution/runner.js';
import {
  parseStreamEvent,
  extractToolMetadata,
  extractTextParts,
  summarizeTurn,
  type ExecutionResult,
} from '../execution/executor.js';
import { expandHome } from '../agents/file-watcher.js';
import { parseInteractionBlock } from '../interaction/parser.js';

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

  const cwd = agent.working_directory
    ? expandHome(agent.working_directory)
    : process.env.HOME ?? process.cwd();

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    child.stdin.write(agent.prompt);
    child.stdin.end();

    let turnCount = 0;
    const toolsUsed = new Set<string>();
    const allFilesRead = new Set<string>();
    const allFilesWritten = new Set<string>();
    const allCommandsRun: string[] = [];
    let lastSummary = '';
    let buffer = '';
    let lastAssistantText = '';

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
          const texts = extractTextParts(event);
          if (texts.length > 0) {
            lastAssistantText = texts.join('\n');
          }
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

      const interaction = parseInteractionBlock(lastAssistantText);

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
        interaction,
      });
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn Claude Code: ${err.message}`));
    });
  });
}
