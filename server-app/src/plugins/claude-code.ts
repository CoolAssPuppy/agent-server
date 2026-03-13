import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { AgentConfig } from '../agents/config.js';
import { resolveEnvVars } from '../agents/config.js';
import type { Reporter } from '../execution/runner.js';
import { truncate, WRITE_TOOLS, type ExecutionResult } from '../execution/executor.js';
import { expandHome } from '../agents/file-watcher.js';
import { parseInteractionBlock } from '../interaction/parser.js';
import { buildCanUseTool } from '../execution/permissions.js';

type ExecuteAgentExtra = {
  abortController?: AbortController;
};

export async function executeAgent(
  agent: AgentConfig,
  reporter: Reporter,
  extra?: ExecuteAgentExtra,
): Promise<ExecutionResult> {
  const cwd = agent.working_directory
    ? expandHome(agent.working_directory)
    : process.env.HOME ?? process.cwd();

  const permissionMode = agent.permission_mode ?? 'bypassPermissions';

  const { ANTHROPIC_API_KEY: _, ...cleanEnv } = process.env;

  const options: Options = {
    maxTurns: agent.max_turns,
    cwd,
    permissionMode,
    allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions' ? true : undefined,
    allowedTools: agent.tools.length > 0 ? agent.tools : undefined,
    disallowedTools: agent.disallowed_tools && agent.disallowed_tools.length > 0
      ? agent.disallowed_tools
      : undefined,
    canUseTool: agent.permissions ? buildCanUseTool(agent.permissions) : undefined,
    abortController: extra?.abortController,
    mcpServers: buildMcpServers(agent),
    env: cleanEnv as Record<string, string>,
  };

  let turnCount = 0;
  const toolsUsed = new Set<string>();
  const allFilesRead = new Set<string>();
  const allFilesWritten = new Set<string>();
  const allCommandsRun: string[] = [];
  let lastAssistantText = '';
  let lastToolName: string | null = null;

  const stream = query({ prompt: agent.prompt, options });

  for await (const message of stream) {
    if (message.type === 'assistant') {
      turnCount++;
      const content = message.message?.content;
      if (!Array.isArray(content)) continue;

      const textParts: string[] = [];

      for (const block of content) {
        if (block.type === 'text' && 'text' in block) {
          textParts.push(block.text as string);
        }

        if (block.type === 'tool_use' && 'name' in block) {
          const name = block.name as string;
          toolsUsed.add(name);
          lastToolName = name;

          const input = ('input' in block ? block.input : {}) as Record<string, unknown>;
          const filePath = typeof input.file_path === 'string' ? input.file_path : null;

          if (name === 'Read' && filePath) {
            allFilesRead.add(filePath);
          } else if (WRITE_TOOLS.has(name) && filePath) {
            allFilesWritten.add(filePath);
          } else if (name === 'Bash' && typeof input.command === 'string') {
            allCommandsRun.push(input.command);
          }
        }
      }

      if (textParts.length > 0) {
        lastAssistantText = textParts.join('\n');
      }

      const summary = textParts.length > 0
        ? truncate(textParts.join(' '))
        : lastToolName
          ? `Using tool: ${lastToolName}`
          : null;

      if (summary) {
        void reporter.progress(summary, {
          turns_completed: turnCount,
          tools_used: [...toolsUsed],
          files_written: [...allFilesWritten],
          commands_run: allCommandsRun.length,
        });
      }
    }

    if (message.type === 'result') {
      if (message.subtype !== 'success') {
        const errors = 'errors' in message ? (message.errors as string[]) : [];
        throw new Error(errors.join('; ') || `Agent failed: ${message.subtype}`);
      }

      const resultText = 'result' in message ? (message.result as string) : '';

      return buildResult({
        summary: resultText || 'Agent completed',
        turnCount: message.num_turns,
        toolsUsed,
        allFilesRead,
        allFilesWritten,
        allCommandsRun,
        lastAssistantText,
      });
    }
  }

  return buildResult({
    summary: lastAssistantText || 'Agent completed',
    turnCount,
    toolsUsed,
    allFilesRead,
    allFilesWritten,
    allCommandsRun,
    lastAssistantText,
  });
}

function buildResult(params: {
  summary: string;
  turnCount: number;
  toolsUsed: Set<string>;
  allFilesRead: Set<string>;
  allFilesWritten: Set<string>;
  allCommandsRun: string[];
  lastAssistantText: string;
}): ExecutionResult {
  const interaction = parseInteractionBlock(params.lastAssistantText);

  return {
    summary: params.summary,
    output: {},
    usage: {
      turns: params.turnCount,
      files_read: params.allFilesRead.size,
      files_written: params.allFilesWritten.size,
      commands_run: params.allCommandsRun.length,
    },
    turnCount: params.turnCount,
    toolsUsed: [...params.toolsUsed],
    filesRead: [...params.allFilesRead],
    filesWritten: [...params.allFilesWritten],
    commandsRun: params.allCommandsRun,
    interaction,
  };
}

function buildMcpServers(agent: AgentConfig): Options['mcpServers'] {
  if (!agent.mcp_servers) return undefined;

  const servers: NonNullable<Options['mcpServers']> = {};

  for (const [name, config] of Object.entries(agent.mcp_servers)) {
    if ('command' in config) {
      servers[name] = {
        ...config,
        env: config.env ? resolveEnvVars(config.env) : undefined,
      };
    } else if ('url' in config) {
      servers[name] = {
        ...config,
        headers: config.headers ? resolveEnvVars(config.headers) : undefined,
      };
    }
  }

  return Object.keys(servers).length > 0 ? servers : undefined;
}
