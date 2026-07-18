import {
  Codex,
  type CodexOptions,
  type ThreadOptions,
  type TurnOptions,
} from '@openai/codex-sdk';
import { tmpdir } from 'os';
import { buildCodexChildEnvironment } from '../agents/environment-policy.js';

export type LocalCodexOptions = CodexOptions;
export type LocalThreadOptions = ThreadOptions;
export type LocalTurnOptions = TurnOptions;

type LocalCodexClient = {
  startThread: (options: ThreadOptions) => {
    run: (prompt: string, options: TurnOptions) => Promise<{ finalResponse: string }>;
  };
};
export type LocalCodexFactory = (options: CodexOptions) => LocalCodexClient;

export type StructuredGenerationOptions = {
  requestKey?: string;
  signal?: AbortSignal;
};

export type LocalStructuredModel = {
  readonly handlesRetries: true;
  generate: (
    prompt: string,
    outputSchema: Record<string, unknown>,
    options?: StructuredGenerationOptions,
  ) => Promise<unknown>;
};

type RunnerOptions = {
  createCodex?: LocalCodexFactory;
  environment?: Record<string, string | undefined>;
  timeoutMs?: number;
  codexExecutablePath?: string;
};

function parseStructuredResponse(response: string): unknown {
  try {
    return JSON.parse(response) as unknown;
  } catch {
    throw new Error('The local model did not return valid structured output.');
  }
}

function withTimeout<T>(promise: Promise<T>, controller: AbortController, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Local structured model timed out.'));
    }, timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Local Codex structured output with read-only, offline execution. */
export function createLocalStructuredModel(options: RunnerOptions = {}): LocalStructuredModel {
  const createCodex = options.createCodex ?? ((codexOptions: CodexOptions) => new Codex(codexOptions));
  const timeoutMs = options.timeoutMs ?? 30_000;
  const active = new Map<string, AbortController>();

  return {
    handlesRetries: true,
    async generate(prompt, outputSchema, generationOptions = {}) {
      const key = generationOptions.requestKey;
      if (key) active.get(key)?.abort();
      let lastError: unknown;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        if (generationOptions.signal?.aborted) controller.abort();
        generationOptions.signal?.addEventListener('abort', () => controller.abort(), { once: true });
        if (key) active.set(key, controller);

        const codex = createCodex({
          codexPathOverride: options.codexExecutablePath,
          env: buildCodexChildEnvironment(options.environment ?? process.env),
          config: { mcp_servers: {} },
        });
        const thread = codex.startThread({
          workingDirectory: tmpdir(),
          skipGitRepoCheck: true,
          sandboxMode: 'read-only',
          approvalPolicy: 'never',
          networkAccessEnabled: false,
          webSearchMode: 'disabled',
        });

        try {
          const turn = await withTimeout(
            thread.run(prompt, { outputSchema, signal: controller.signal }),
            controller,
            timeoutMs,
          );
          const value = parseStructuredResponse(turn.finalResponse);
          if (key && active.get(key) === controller) active.delete(key);
          return value;
        } catch (error) {
          lastError = error;
          const wasReplaced = key !== undefined && active.get(key) !== controller;
          if (wasReplaced || generationOptions.signal?.aborted) throw error;
          if (attempt === 1 && key && active.get(key) === controller) active.delete(key);
        }
      }
      throw lastError instanceof Error ? lastError : new Error('Local structured model failed.');
    },
  };
}
