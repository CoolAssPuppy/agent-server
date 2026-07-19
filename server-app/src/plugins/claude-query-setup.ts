import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options, Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

type PromptGate = {
  messages: AsyncIterable<SDKUserMessage>;
  release: () => void;
  cancel: () => void;
};

function createPromptGate(prompt: string): PromptGate {
  let settle!: (shouldSend: boolean) => void;
  const readiness = new Promise<boolean>((resolve) => { settle = resolve; });

  return {
    messages: (async function* () {
      if (!await readiness) return;
      yield {
        type: 'user',
        message: { role: 'user', content: prompt },
        parent_tool_use_id: null,
        session_id: '',
      };
    })(),
    release: () => { settle(true); },
    cancel: () => { settle(false); },
  };
}

/** Starts Claude without MCP process arguments, then configures MCP over its control stream. */
export async function startClaudeQueryWithMcp(
  prompt: string,
  options: Options,
  mcpServers: NonNullable<Options['mcpServers']>,
  abortController: AbortController,
): Promise<Query> {
  const gate = createPromptGate(prompt);
  const stream = query({ prompt: gate.messages, options });

  try {
    await stream.setMcpServers(mcpServers);
    gate.release();
    return stream;
  } catch (error) {
    gate.cancel();
    abortController.abort(error);
    try {
      stream.close();
    } catch {
      // Preserve the MCP setup failure as the actionable error.
    }
    throw error;
  }
}
