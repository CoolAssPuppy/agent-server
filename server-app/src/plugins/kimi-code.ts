import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { realpath, readFile, stat, writeFile } from 'fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'path';
import { Readable, Writable } from 'stream';
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type McpServer,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionUpdate,
  type Stream,
  type ToolCall,
  type ToolCallUpdate,
  type ToolKind,
} from '@agentclientprotocol/sdk';
import type { AgentConfig, McpServerConfig } from '../agents/config.js';
import { buildKimiChildEnvironment } from '../agents/environment-policy.js';
import { expandHome } from '../agents/file-watcher.js';
import type { ExecutionResult, ToolCallTrace } from '../execution/executor.js';
import { truncate } from '../execution/executor.js';
import { isToolPermitted } from '../execution/permission-policy.js';
import type { Reporter } from '../execution/runner.js';
import { parseInteractionBlock } from '../interaction/parser.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_LENGTH = 4_000;

type KimiAcpOptions = {
  abortController?: AbortController;
  disableMcpServers?: boolean;
};

type KimiProcessOptions = KimiAcpOptions & {
  kimiExecutablePath?: string;
};

type KimiState = {
  assistantText: string;
  tools: Map<string, TrackedTool>;
  filesRead: Set<string>;
  filesWritten: Set<string>;
  commandsRun: string[];
};

type TrackedTool = {
  name: string;
  status: 'succeeded' | 'failed';
  input?: unknown;
  output?: unknown;
};

type FileGrant = {
  path: string;
  kind: 'file' | 'folder';
  canWrite: boolean;
};

/** Run an agent through an already connected ACP stream. Exposed for protocol conformance tests. */
export async function runKimiAcpSession(
  agent: AgentConfig,
  reporter: Reporter,
  stream: Stream,
  options: KimiAcpOptions = {},
): Promise<ExecutionResult> {
  assertKimiSafety(agent);
  const startedAt = performance.now();
  const state = createState();
  const filePolicy = await createFilePolicy(agent);
  let negotiatedVersion: string | undefined;

  const app = client({ name: 'Agent Server' })
    .onRequest(methods.client.session.requestPermission, ({ params }) => {
      const requestedTool = permissionToolName(params.toolCall, state);
      const response = permissionResponse(
        agent,
        params,
        requestedTool,
        options.abortController?.signal.aborted === true,
      );
      void reporter.progress(`Reviewing Kimi tool: ${requestedTool}`, {
        permission_options: params.options.map((option) => option.kind),
        permission_outcome: response.outcome.outcome === 'selected'
          ? response.outcome.optionId
          : 'cancelled',
      });
      return response;
    })
    .onRequest(methods.client.fs.readTextFile, async ({ params }) => {
      await filePolicy.assertReadable(params.path);
      const file = await stat(params.path);
      if (file.size > MAX_FILE_BYTES) throw new Error('The requested file is too large to read safely.');
      const content = await readFile(params.path, 'utf8');
      return { content: sliceLines(content, params.line, params.limit) };
    })
    .onRequest(methods.client.fs.writeTextFile, async ({ params }) => {
      if (Buffer.byteLength(params.content, 'utf8') > MAX_FILE_BYTES) {
        throw new Error('The requested file is too large to write safely.');
      }
      await filePolicy.assertWritable(params.path);
      await writeFile(params.path, params.content, 'utf8');
      return {};
    });

  const response = await app.connectWith(stream, async (context) => {
    const initialized = await context.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: false,
      },
      clientInfo: { name: 'Agent Server', version: '3.0.2' },
    });
    if (initialized.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(`Kimi Code uses unsupported ACP protocol ${initialized.protocolVersion}.`);
    }
    negotiatedVersion = initialized.agentInfo?.version ?? undefined;

    const builder = context.buildSession({
      cwd: workingDirectory(agent),
      additionalDirectories: additionalDirectories(agent),
      mcpServers: options.disableMcpServers ? [] : kimiMcpServers(agent.mcp_servers ?? {}),
    });
    return builder.withSession(async (session) => {
      if (agent.model) {
        await context.request(methods.agent.session.setConfigOption, {
          sessionId: session.sessionId,
          configId: 'model',
          value: agent.model,
        });
      }

      const cancel = (): void => {
        void context.notify(methods.agent.session.cancel, { sessionId: session.sessionId });
      };
      options.abortController?.signal.addEventListener('abort', cancel, { once: true });
      try {
        void session.prompt(agent.prompt);
        for (;;) {
          const message = await session.nextUpdate();
          if (message.kind === 'stop') return message.response;
          handleUpdate(message.update, state, reporter);
        }
      } finally {
        options.abortController?.signal.removeEventListener('abort', cancel);
      }
    });
  });

  const durationMs = Math.round(performance.now() - startedAt);
  const toolCalls = [...state.tools.values()].map<ToolCallTrace>((tool) => ({
    name: tool.name,
    status: tool.status,
    input: tool.input,
    output: tool.output,
  }));
  return {
    summary: state.assistantText.trim() || 'Agent completed',
    output: {},
    usage: {
      input_tokens: response.usage?.inputTokens ?? 0,
      output_tokens: response.usage?.outputTokens ?? 0,
      total_tokens: response.usage?.totalTokens ?? 0,
      cost_source: 'subscription-not-reported',
      duration_ms: durationMs,
      acp_protocol: PROTOCOL_VERSION,
      kimi_version: negotiatedVersion,
    },
    turnCount: 1,
    toolsUsed: [...new Set([...state.tools.values()].map((tool) => tool.name))],
    filesRead: [...state.filesRead],
    filesWritten: [...state.filesWritten],
    commandsRun: state.commandsRun,
    interaction: parseInteractionBlock(state.assistantText),
    model: agent.model ?? 'Kimi Code',
    stopReason: response.stopReason,
    durationMs,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

/** Run an agent through the user's installed Kimi Code ACP executable. */
export async function executeKimiCodeAgent(
  agent: AgentConfig,
  reporter: Reporter,
  options: KimiProcessOptions = {},
): Promise<ExecutionResult> {
  const executable = options.kimiExecutablePath;
  if (!executable) throw new Error('Kimi Code is not installed or is turned off in Settings.');

  const child = spawn(executable, ['acp'], {
    cwd: workingDirectory(agent),
    env: buildKimiChildEnvironment(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-MAX_STDERR_LENGTH);
  });

  const stream = ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  );
  try {
    return await runKimiAcpSession(agent, reporter, stream, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/auth|login|sign.?in/i.test(`${message}\n${stderr}`)) {
      throw new Error('Kimi Code needs you to sign in. Run `kimi login`, then try again.');
    }
    throw error;
  } finally {
    stopChild(child);
  }
}

function createState(): KimiState {
  return {
    assistantText: '',
    tools: new Map(),
    filesRead: new Set(),
    filesWritten: new Set(),
    commandsRun: [],
  };
}

function handleUpdate(update: SessionUpdate, state: KimiState, reporter: Reporter): void {
  if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
    state.assistantText += update.content.text;
    void reporter.progress(truncate(update.content.text), progressMetadata(state));
    return;
  }
  if (update.sessionUpdate === 'tool_call') {
    trackTool(update, state);
    void reporter.progress(`Using tool: ${toolName(update)}`, progressMetadata(state));
    return;
  }
  if (update.sessionUpdate === 'tool_call_update') updateTrackedTool(update, state);
}

function trackTool(call: ToolCall, state: KimiState): void {
  const name = toolName(call);
  state.tools.set(call.toolCallId, {
    name,
    status: call.status === 'failed' ? 'failed' : 'succeeded',
    input: call.rawInput,
    output: call.rawOutput,
  });
  const paths = call.locations?.map((location) => location.path) ?? pathsFromInput(call.rawInput);
  if (name === 'Read' || name === 'Grep') paths.forEach((path) => state.filesRead.add(path));
  if (name === 'Write' || name === 'Edit') paths.forEach((path) => state.filesWritten.add(path));
  if (name === 'Bash') {
    const command = stringField(call.rawInput, 'command');
    if (command) state.commandsRun.push(command);
  }
}

function updateTrackedTool(update: ToolCallUpdate, state: KimiState): void {
  const current = state.tools.get(update.toolCallId);
  if (!current) return;
  state.tools.set(update.toolCallId, {
    ...current,
    status: update.status === 'failed' ? 'failed' : current.status,
    input: update.rawInput ?? current.input,
    output: update.rawOutput ?? current.output,
  });
}

function permissionResponse(
  agent: AgentConfig,
  request: RequestPermissionRequest,
  requestedTool: string,
  isCancelled: boolean,
): RequestPermissionResponse {
  if (isCancelled) return { outcome: { outcome: 'cancelled' } };
  const permitted = permittedTool(agent, requestedTool);
  const kind = permitted ? 'allow_once' : 'reject_once';
  const option = request.options.find((candidate) => candidate.kind === kind)
    ?? (!permitted ? request.options.find((candidate) => candidate.kind === 'reject_always') : undefined);
  return option
    ? { outcome: { outcome: 'selected', optionId: option.optionId } }
    : { outcome: { outcome: 'cancelled' } };
}

function permittedTool(agent: AgentConfig, name: string): boolean {
  if (name === 'Edit') return isToolPermitted(agent, 'Edit') || isToolPermitted(agent, 'Write');
  if (name === 'Grep') return isToolPermitted(agent, 'Grep') || isToolPermitted(agent, 'Read');
  if (name === 'Unknown') return false;
  return isToolPermitted(agent, name);
}

function permissionToolName(call: ToolCallUpdate, state: KimiState): string {
  const direct = toolName(call);
  return direct === 'Unknown' ? state.tools.get(call.toolCallId)?.name ?? direct : direct;
}

function toolName(call: Pick<ToolCallUpdate, 'kind' | 'title' | 'rawInput' | '_meta'>): string {
  const metadataName = stringField(call._meta, 'toolName') ?? stringField(call._meta, 'tool_name');
  if (metadataName) return metadataName;
  if (stringField(call.rawInput, 'command')) return 'Bash';
  const byKind: Partial<Record<ToolKind, string>> = {
    read: 'Read',
    search: 'Grep',
    edit: 'Edit',
    delete: 'Write',
    move: 'Write',
    execute: 'Bash',
    fetch: 'WebFetch',
  };
  if (call.kind && byKind[call.kind]) return byKind[call.kind] ?? 'Unknown';
  const title = call.title?.trim();
  if (title?.startsWith('mcp__')) return title.split(/\s/, 1)[0];
  return 'Unknown';
}

function progressMetadata(state: KimiState): Record<string, unknown> {
  return {
    turns_completed: 1,
    tools_used: [...new Set([...state.tools.values()].map((tool) => tool.name))],
    files_written: [...state.filesWritten],
    commands_run: state.commandsRun.length,
  };
}

function assertKimiSafety(agent: AgentConfig): void {
  if ((agent.file_access?.length ?? 0) > 0 && isToolPermitted(agent, 'Bash')) {
    throw new Error('Kimi Code cannot enforce exact file access while command execution is allowed.');
  }
}

async function createFilePolicy(agent: AgentConfig): Promise<{
  assertReadable: (path: string) => Promise<void>;
  assertWritable: (path: string) => Promise<void>;
}> {
  const configured = agent.file_access ?? [{
    path: workingDirectory(agent),
    kind: 'folder' as const,
    access: 'read_write' as const,
  }];
  const grants = await Promise.all(configured.map(async (grant): Promise<FileGrant> => ({
    path: await canonicalGrantPath(expandHome(grant.path), grant.kind),
    kind: grant.kind,
    canWrite: grant.access === 'read_write',
  })));

  return {
    assertReadable: async (path) => {
      if (!isToolPermitted(agent, 'Read')) throw new Error(`Reading ${path} is not permitted.`);
      const target = await canonicalTargetPath(path, false);
      if (!grants.some((grant) => contains(grant, target))) throw new Error(`Reading ${path} is not permitted.`);
    },
    assertWritable: async (path) => {
      const canUseWrite = isToolPermitted(agent, 'Write') || isToolPermitted(agent, 'Edit');
      if (!canUseWrite) throw new Error(`Writing ${path} is not permitted.`);
      const target = await canonicalTargetPath(path, true);
      if (!grants.some((grant) => grant.canWrite && contains(grant, target))) {
        throw new Error(`Writing ${path} is not permitted.`);
      }
    },
  };
}

async function canonicalGrantPath(path: string, kind: 'file' | 'folder'): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    if (kind === 'folder') throw new Error(`Kimi Code cannot access missing folder ${path}.`);
    return canonicalTargetPath(path, true);
  }
}

async function canonicalTargetPath(path: string, mayNotExist: boolean): Promise<string> {
  if (!isAbsolute(path)) throw new Error(`Path ${path} is not permitted.`);
  try {
    return await realpath(path);
  } catch {
    if (!mayNotExist) throw new Error(`Path ${path} is not permitted.`);
    return resolve(await realpath(dirname(path)), basename(path));
  }
}

function contains(grant: FileGrant, target: string): boolean {
  if (grant.kind === 'file') return grant.path === target;
  const child = relative(grant.path, target);
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

function workingDirectory(agent: AgentConfig): string {
  return resolve(expandHome(agent.working_directory ?? process.env.HOME ?? process.cwd()));
}

function additionalDirectories(agent: AgentConfig): string[] {
  const cwd = workingDirectory(agent);
  return [...new Set((agent.file_access ?? [])
    .filter((grant) => grant.kind === 'folder')
    .map((grant) => resolve(expandHome(grant.path)))
    .filter((path) => path !== cwd))];
}

function kimiMcpServers(servers: Record<string, McpServerConfig>): McpServer[] {
  return Object.entries(servers).map(([name, config]) => {
    if ('command' in config) {
      return {
        name,
        command: config.command,
        args: config.args ?? [],
        env: Object.entries(config.env ?? {}).map(([variable, value]) => ({ name: variable, value })),
      };
    }
    return {
      type: config.type,
      name,
      url: config.url,
      headers: Object.entries(config.headers ?? {}).map(([header, value]) => ({ name: header, value })),
    };
  });
}

function sliceLines(content: string, line?: number | null, limit?: number | null): string {
  if (line === undefined && limit === undefined) return content;
  const lines = content.split('\n');
  const start = Math.max(0, (line ?? 1) - 1);
  return lines.slice(start, limit ? start + limit : undefined).join('\n');
}

function pathsFromInput(value: unknown): string[] {
  const path = stringField(value, 'path') ?? stringField(value, 'file_path');
  return path ? [path] : [];
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' ? candidate : undefined;
}

function stopChild(child: ChildProcessWithoutNullStreams): void {
  child.stdin.end();
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
}
