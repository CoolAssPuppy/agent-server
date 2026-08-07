import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ThreadEvent } from '@openai/codex-sdk';
import type { AgentConfig } from '../agents/config.js';
import { deriveCodexNetworkAccess, deriveCodexSandbox } from '../execution/codex-safety.js';
import { expandHome } from '../agents/file-watcher.js';
import { buildCodexPermissionOverrides, resolveCodexCommand } from './codex-file-policy.js';
import { startCredentialBroker, type CredentialBrokerPlan } from './credential-broker.js';

export type ScopedCodexInvocation = {
  executable: string;
  arguments: string[];
  environment: Record<string, string>;
  credentialBroker?: CredentialBrokerPlan;
};

export type ScopedCodexOptions = {
  agent: AgentConfig;
  environment: Record<string, string>;
  codexExecutablePath?: string;
  config?: unknown;
  baseUrl?: string;
  apiKey?: string;
  credentialBroker?: CredentialBrokerPlan;
};

/** Build a direct CLI invocation because the SDK cannot encode permission profiles. */
export function buildScopedCodexInvocation(options: ScopedCodexOptions): ScopedCodexInvocation {
  const command = resolveCodexCommand(options.codexExecutablePath);
  const workingDirectory = options.agent.working_directory
    ? expandHome(options.agent.working_directory)
    : options.environment.HOME ?? process.cwd();
  const hasFileAccess = hasScopedFileAccess(options.agent);
  const config = [
    ...(hasFileAccess ? buildCodexPermissionOverrides(options.agent) : []),
    hasFileAccess
      ? `permissions.agent-server.network.enabled=${deriveCodexNetworkAccess(options.agent)}`
      : `sandbox_workspace_write.network_access=${deriveCodexNetworkAccess(options.agent)}`,
    'approval_policy="never"',
    'web_search="disabled"',
    'shell_environment_policy.inherit="core"',
    ...(options.baseUrl ? [`openai_base_url=${JSON.stringify(options.baseUrl)}`] : []),
    ...configOverrides(options.config),
  ];
  const model = options.agent.model;
  return {
    executable: command.executable,
    arguments: [
      ...command.arguments,
      'exec',
      '--experimental-json',
      '--ignore-user-config',
      ...(model ? ['--model', model] : []),
      ...(!hasFileAccess
        ? ['--sandbox', deriveCodexSandbox(options.agent)]
        : []),
      '--cd', workingDirectory,
      '--skip-git-repo-check',
      ...config.flatMap((override) => ['--config', override]),
    ],
    environment: {
      ...options.environment,
      CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'codex_sdk_ts',
      ...(options.apiKey ? { CODEX_API_KEY: options.apiKey } : {}),
    },
    ...(options.credentialBroker ? { credentialBroker: options.credentialBroker } : {}),
  };
}

function hasScopedFileAccess(agent: AgentConfig): boolean {
  return (agent.file_access?.length ?? 0) > 0;
}

/** Stream the CLI's SDK-compatible JSONL events with cancellation and stderr context. */
export async function* streamScopedCodex(
  invocation: ScopedCodexInvocation,
  prompt: string,
  signal?: AbortSignal,
): AsyncGenerator<ThreadEvent> {
  const closeCredentialBroker = await startCredentialBroker(invocation.credentialBroker);
  const child = spawn(invocation.executable, invocation.arguments, {
    env: invocation.environment,
    signal,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stderr: Buffer[] = [];
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  child.stdin.end(prompt);
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, exitSignal) => resolve({ code, signal: exitSignal }));
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    for await (const line of lines) yield parseThreadEvent(line);
    const result = await exit;
    if (result.code !== 0 || result.signal) {
      const detail = result.signal ? `signal ${result.signal}` : `code ${result.code ?? 1}`;
      throw new Error(`Codex Exec exited with ${detail}: ${Buffer.concat(stderr).toString('utf8')}`);
    }
  } finally {
    lines.close();
    if (!child.killed) child.kill();
    await closeCredentialBroker();
  }
}

function parseThreadEvent(line: string): ThreadEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new Error(`Codex emitted invalid JSON: ${line}`, { cause: error });
  }
  if (!isThreadEvent(value)) throw new Error(`Codex emitted an unsupported event: ${line}`);
  return value;
}

function isThreadEvent(value: unknown): value is ThreadEvent {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  return [
    'thread.started', 'turn.started', 'turn.completed', 'turn.failed',
    'item.started', 'item.updated', 'item.completed', 'error',
  ].includes(value.type);
}

function configOverrides(config: unknown): string[] {
  if (config === undefined) return [];
  if (!isRecord(config)) throw new Error('Codex configuration must be an object');
  return Object.entries(config).map(([key, value]) => `${key}=${tomlValue(value)}`);
}

function tomlValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`;
  if (!isRecord(value)) throw new Error('Codex configuration contains an unsupported value');
  return `{${Object.entries(value)
    .map(([key, child]) => `${tomlKey(key)} = ${tomlValue(child)}`)
    .join(', ')}}`;
}

function tomlKey(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
