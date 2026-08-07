import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { RuntimeConnectionPolicy } from '../connections/runtime-policy.js';

const PolicyValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const RuntimePolicySchema = z.object({
  allowedTools: z.array(z.string().min(1)).max(512),
  argumentConstraints: z.record(
    z.string().min(1),
    z.record(z.string().min(1), z.array(PolicyValueSchema).min(1).max(256)),
  ),
}).strict();

const RelayPayloadSchema = z.object({
  transport: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('stdio'),
      command: z.string().min(1),
      args: z.array(z.string()).default([]),
    }).strict(),
    z.object({ kind: z.literal('http'), url: z.url() }).strict(),
    z.object({ kind: z.literal('sse'), url: z.url() }).strict(),
  ]),
  policy: RuntimePolicySchema,
  credential_broker: z.string().min(1).optional(),
  credential_grant: z.string().min(1).optional(),
}).strict().superRefine((payload, context) => {
  if ((payload.credential_broker === undefined) !== (payload.credential_grant === undefined)) {
    context.addIssue({
      code: 'custom',
      message: 'Credential broker and grant must be provided together',
    });
  }
});

type RelayPayload = z.infer<typeof RelayPayloadSchema>;

type UpstreamToolClient = Pick<Client, 'listTools' | 'callTool'>;

const NOTION_CHILD_LIMIT = 100;

/** Filters an upstream inventory before it reaches a coding runtime. */
export function filterPermittedTools<T extends { name: string }>(
  tools: readonly T[],
  policy: RuntimeConnectionPolicy,
): T[] {
  const allowed = new Set(policy.allowedTools);
  return tools.filter(({ name }) => allowed.has(name));
}

function valueDescription(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return 'an unsupported value';
}

function argumentAtPath(argumentsValue: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    const record = current as Record<string, unknown>;
    return Object.hasOwn(record, segment) ? record[segment] : undefined;
  }, argumentsValue);
}

function pageIdFromValue(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (Array.isArray(value)) {
    return value.map(pageIdFromValue).find((id) => id !== undefined);
  }
  const record = value as Record<string, unknown>;
  if (record.object === 'page' && typeof record.id === 'string') return record.id;
  return Object.values(record).map(pageIdFromValue).find((id) => id !== undefined);
}

function notionPageId(result: Awaited<ReturnType<UpstreamToolClient['callTool']>>): string | undefined {
  const structuredId = pageIdFromValue(result.structuredContent);
  if (structuredId) return structuredId;
  if (!Array.isArray(result.content)) return undefined;
  for (const block of result.content) {
    if (typeof block !== 'object' || block === null) continue;
    if (!('type' in block) || block.type !== 'text') continue;
    if (!('text' in block) || typeof block.text !== 'string') continue;
    try {
      const id = pageIdFromValue(JSON.parse(block.text));
      if (id) return id;
    } catch {
      continue;
    }
  }
  return undefined;
}

async function callUpstreamTool(
  upstream: UpstreamToolClient,
  name: string,
  argumentsValue: Record<string, unknown>,
): ReturnType<UpstreamToolClient['callTool']> {
  const children = argumentsValue.children;
  if (name !== 'API-post-page' || !Array.isArray(children)
    || children.length <= NOTION_CHILD_LIMIT) {
    return upstream.callTool({ name, arguments: argumentsValue });
  }

  const created = await upstream.callTool({
    name,
    arguments: { ...argumentsValue, children: children.slice(0, NOTION_CHILD_LIMIT) },
  });
  const pageId = notionPageId(created);
  if (!pageId) {
    throw new McpError(ErrorCode.InternalError, 'Notion created the page without returning its ID.');
  }
  for (let offset = NOTION_CHILD_LIMIT; offset < children.length; offset += NOTION_CHILD_LIMIT) {
    const appended = await upstream.callTool({
      name: 'API-patch-block-children',
      arguments: {
        block_id: pageId,
        children: children.slice(offset, offset + NOTION_CHILD_LIMIT),
      },
    });
    if (appended.isError) {
      throw new McpError(ErrorCode.InternalError, 'Notion could not append all page blocks.');
    }
  }
  return created;
}

/** Returns a stable refusal reason, or undefined when the call is permitted. */
export function toolCallPolicyError(
  policy: RuntimeConnectionPolicy,
  tool: string,
  argumentsValue: Record<string, unknown>,
): string | undefined {
  if (!policy.allowedTools.includes(tool)) {
    return `Tool "${tool}" is not approved for this run.`;
  }
  for (const [field, permitted] of Object.entries(policy.argumentConstraints[tool] ?? {})) {
    const supplied = argumentAtPath(argumentsValue, field);
    if (supplied === undefined) {
      return `Tool "${tool}" requires an approved ${field} for this run.`;
    }
    if (!permitted.some((value) => Object.is(value, supplied))) {
      return `Tool "${tool}" cannot use ${field}=${valueDescription(supplied)} for this run.`;
    }
  }
  return undefined;
}

function parsePayload(raw: string | undefined): RelayPayload {
  if (!raw) throw new Error('Missing MCP policy relay payload');
  return RelayPayloadSchema.parse(JSON.parse(raw));
}

async function fetchCredentials(
  socketPath: string,
  grant: string,
): Promise<Record<string, string>> {
  return new Promise((resolvePromise, reject) => {
    const socket = createConnection(socketPath);
    let response = '';
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.end(`${grant}\n`));
    socket.on('data', (chunk: string) => {
      response += chunk;
      if (response.length > 64 * 1024) socket.destroy(new Error('Credential response is too large'));
    });
    socket.once('error', reject);
    socket.once('end', () => {
      try {
        const parsed: unknown = JSON.parse(response);
        const result = z.object({ credentials: z.record(z.string(), z.string()) }).safeParse(parsed);
        if (!result.success) throw new Error('Credential grant was refused');
        resolvePromise(result.data.credentials);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function authenticatedFetch(credentials: Record<string, string>): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    for (const [name, value] of Object.entries(credentials)) headers.set(name, value);
    return fetch(input, { ...init, headers });
  };
}

function upstreamTransport(
  payload: RelayPayload,
  credentials: Record<string, string>,
): Transport {
  switch (payload.transport.kind) {
    case 'stdio':
      return new StdioClientTransport({
        command: payload.transport.command,
        args: payload.transport.args,
        env: { ...getDefaultEnvironment(), ...credentials },
        stderr: 'inherit',
      });
    case 'http':
      return new StreamableHTTPClientTransport(new URL(payload.transport.url), {
        fetch: authenticatedFetch(credentials),
      });
    case 'sse':
      return new SSEClientTransport(new URL(payload.transport.url), {
        fetch: authenticatedFetch(credentials),
      });
  }
}

async function runRelay(payload: RelayPayload): Promise<void> {
  const credentials = payload.credential_broker && payload.credential_grant
    ? await fetchCredentials(payload.credential_broker, payload.credential_grant)
    : {};
  const upstream = new Client(
    { name: 'agent-server-policy-relay', version: '1.0.0' },
    { capabilities: {} },
  );
  const upstreamConnection = upstreamTransport(payload, credentials);
  await upstream.connect(upstreamConnection);

  const relay = createPolicyRelayServer(upstream, payload.policy);

  const runtimeConnection = new StdioServerTransport();
  const closed = new Promise<void>((resolvePromise) => {
    relay.onclose = resolvePromise;
  });
  await relay.connect(runtimeConnection);
  await closed;
  await upstream.close();
}

/** Creates the MCP-facing server used by every runtime. */
export function createPolicyRelayServer(
  upstream: UpstreamToolClient,
  policy: RuntimeConnectionPolicy,
): Server {
  const relay = new Server(
    { name: 'agent-server-policy-relay', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  relay.setRequestHandler(ListToolsRequestSchema, async ({ params }) => {
    const result = await upstream.listTools(params);
    return {
      ...result,
      tools: filterPermittedTools(result.tools, policy),
    };
  });
  relay.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const policyError = toolCallPolicyError(
      policy,
      params.name,
      params.arguments ?? {},
    );
    if (policyError) throw new McpError(ErrorCode.InvalidParams, policyError);
    return callUpstreamTool(upstream, params.name, params.arguments ?? {});
  });
  return relay;
}

async function main(): Promise<void> {
  await runRelay(parsePayload(process.argv[2]));
}

const isMain = process.argv[1] !== undefined
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'MCP policy relay failed';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
