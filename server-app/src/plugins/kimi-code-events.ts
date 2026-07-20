import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionUpdate,
  ToolCall,
  ToolCallUpdate,
  ToolKind,
} from '@agentclientprotocol/sdk';
import type { AgentConfig } from '../agents/config.js';
import type { ToolCallTrace } from '../execution/executor.js';
import { isToolPermitted } from '../execution/permission-policy.js';
import type { Reporter } from '../execution/runner.js';

type TrackedTool = {
  name: string;
  status: 'succeeded' | 'failed';
  input?: unknown;
  output?: unknown;
};

export type KimiExecutionState = {
  assistantText: string;
  tools: Map<string, TrackedTool>;
  filesRead: Set<string>;
  filesWritten: Set<string>;
  commandsRun: string[];
};

export function createKimiExecutionState(): KimiExecutionState {
  return {
    assistantText: '',
    tools: new Map(),
    filesRead: new Set(),
    filesWritten: new Set(),
    commandsRun: [],
  };
}

export function handleKimiUpdate(
  update: SessionUpdate,
  state: KimiExecutionState,
  reporter: Reporter,
): void {
  if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
    state.assistantText += update.content.text;
    return;
  }
  if (update.sessionUpdate === 'tool_call') {
    trackTool(update, state);
    void reporter.progress(`Using tool: ${kimiToolName(update)}`, progressMetadata(state));
    return;
  }
  if (update.sessionUpdate === 'tool_call_update') updateTrackedTool(update, state);
}

export function kimiPermissionResponse(
  agent: AgentConfig,
  request: RequestPermissionRequest,
  requestedTool: string,
  isCancelled: boolean,
): RequestPermissionResponse {
  if (isCancelled) return { outcome: { outcome: 'cancelled' } };
  const permitted = isKimiToolPermitted(agent, requestedTool);
  const kind = permitted ? 'allow_once' : 'reject_once';
  const option = request.options.find((candidate) => candidate.kind === kind)
    ?? (!permitted ? request.options.find((candidate) => candidate.kind === 'reject_always') : undefined);
  return option
    ? { outcome: { outcome: 'selected', optionId: option.optionId } }
    : { outcome: { outcome: 'cancelled' } };
}

export function kimiPermissionToolName(
  call: ToolCallUpdate,
  state: KimiExecutionState,
): string {
  const direct = kimiToolName(call);
  return direct === 'Unknown' ? state.tools.get(call.toolCallId)?.name ?? direct : direct;
}

export function isKimiPermissionGranted(
  request: RequestPermissionRequest,
  response: RequestPermissionResponse,
): boolean {
  if (response.outcome.outcome !== 'selected') return false;
  const selectedOptionId = response.outcome.optionId;
  return request.options.some((option) => (
    option.optionId === selectedOptionId && option.kind.startsWith('allow_')
  ));
}

export function kimiToolTraces(state: KimiExecutionState): ToolCallTrace[] {
  return [...state.tools.values()].map((tool) => ({
    name: tool.name,
    status: tool.status,
    input: tool.input,
    output: tool.output,
  }));
}

export function kimiToolsUsed(state: KimiExecutionState): string[] {
  return [...new Set([...state.tools.values()].map((tool) => tool.name))];
}

function trackTool(call: ToolCall, state: KimiExecutionState): void {
  const name = kimiToolName(call);
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

function updateTrackedTool(update: ToolCallUpdate, state: KimiExecutionState): void {
  const current = state.tools.get(update.toolCallId);
  if (!current) return;
  state.tools.set(update.toolCallId, {
    ...current,
    status: update.status === 'failed' ? 'failed' : current.status,
    input: update.rawInput ?? current.input,
    output: update.rawOutput ?? current.output,
  });
}

function isKimiToolPermitted(agent: AgentConfig, name: string): boolean {
  if (name === 'Edit') return isToolPermitted(agent, 'Edit') || isToolPermitted(agent, 'Write');
  if (name === 'Grep') return isToolPermitted(agent, 'Grep') || isToolPermitted(agent, 'Read');
  if (name === 'Unknown') return false;
  return isToolPermitted(agent, name);
}

function kimiToolName(
  call: Pick<ToolCallUpdate, 'kind' | 'title' | 'rawInput' | '_meta'>,
): string {
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

function progressMetadata(state: KimiExecutionState): Record<string, unknown> {
  return {
    turns_completed: 1,
    tools_used: kimiToolsUsed(state),
    files_written: [...state.filesWritten],
    commands_run: state.commandsRun.length,
  };
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
