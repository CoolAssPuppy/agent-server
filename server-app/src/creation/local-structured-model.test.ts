import { describe, expect, it } from 'vitest';
import {
  createLocalStructuredModel,
  type LocalCodexFactory,
  type LocalCodexOptions,
  type LocalThreadOptions,
  type LocalTurnOptions,
} from './local-structured-model.js';

type CapturedCall = {
  codex?: LocalCodexOptions;
  thread?: LocalThreadOptions;
  turn?: LocalTurnOptions;
};

function successfulFactory(captured: CapturedCall, response: unknown): LocalCodexFactory {
  return (options) => {
    captured.codex = options;
    return {
      startThread(threadOptions) {
        captured.thread = threadOptions;
        return {
          async run(_prompt, turnOptions) {
            captured.turn = turnOptions;
            return { finalResponse: JSON.stringify(response) };
          },
        };
      },
    };
  };
}

describe('local structured model runner', () => {
  it('runs Codex read-only without network, web search, MCP additions, or inherited secrets', async () => {
    const captured: CapturedCall = {};
    const model = createLocalStructuredModel({
      createCodex: successfulFactory(captured, { answer: 'safe' }),
      environment: {
        HOME: '/Users/test',
        PATH: '/usr/bin',
        CODEX_HOME: '/Users/test/.codex',
        SECRET_TOKEN: 'must-not-pass',
      },
      timeoutMs: 1_000,
    });

    const value = await model.generate('Return a safe answer.', { type: 'object' }, { requestKey: 'proposal' });

    expect(value).toEqual({ answer: 'safe' });
    expect(captured.thread).toEqual({
      workingDirectory: expect.any(String),
      skipGitRepoCheck: true,
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      networkAccessEnabled: false,
      webSearchMode: 'disabled',
    });
    expect(captured.turn?.outputSchema).toEqual({ type: 'object' });
    expect(captured.codex?.config).toEqual({ mcp_servers: {} });
    expect(captured.codex?.env).not.toHaveProperty('SECRET_TOKEN');
    expect(captured.codex?.env).toMatchObject({ CODEX_HOME: '/Users/test/.codex', HOME: '/Users/test' });
  });

  it('retries one invalid structured response and returns valid JSON', async () => {
    let calls = 0;
    const createCodex: LocalCodexFactory = () => ({
      startThread: () => ({
        async run() {
          calls += 1;
          return { finalResponse: calls === 1 ? 'not json' : '{"answer":"second attempt"}' };
        },
      }),
    });
    const model = createLocalStructuredModel({ createCodex, timeoutMs: 1_000 });

    await expect(model.generate('Answer.', { type: 'object' })).resolves.toEqual({ answer: 'second attempt' });
    expect(calls).toBe(2);
  });

  it('cancels an older Codex turn with the same key when a replacement starts', async () => {
    let firstSignal: AbortSignal | undefined;
    let calls = 0;
    const createCodex: LocalCodexFactory = () => ({
      startThread: () => ({
        async run(_prompt, options) {
          calls += 1;
          if (calls === 1) {
            firstSignal = options.signal;
            await new Promise<void>((resolve) => options.signal?.addEventListener('abort', () => resolve(), { once: true }));
            throw new Error('cancelled');
          }
          return { finalResponse: '{"answer":"new"}' };
        },
      }),
    });
    const model = createLocalStructuredModel({ createCodex, timeoutMs: 1_000 });

    const oldRequest = model.generate('Old.', { type: 'object' }, { requestKey: 'proposal' });
    const newRequest = model.generate('New.', { type: 'object' }, { requestKey: 'proposal' });

    await expect(newRequest).resolves.toEqual({ answer: 'new' });
    await expect(oldRequest).rejects.toThrow('cancelled');
    expect(firstSignal?.aborted).toBe(true);
  });
});
