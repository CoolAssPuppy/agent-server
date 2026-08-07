import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeConnectionPolicy } from '../connections/runtime-policy.js';
import {
  filterPermittedTools,
  createPolicyRelayServer,
  toolCallPolicyError,
} from './mcp-policy-relay.js';

const policy: RuntimeConnectionPolicy = {
  allowedTools: ['API-post-search', 'API-post-page'],
  argumentConstraints: {
    'API-post-page': { data_source_id: ['database-1'] },
  },
};

describe('MCP policy relay', () => {
  it('shows a runtime only the approved tool inventory', () => {
    const filtered = filterPermittedTools([
      { name: 'API-post-page', description: 'Create page', inputSchema: { type: 'object' as const } },
      { name: 'API-delete-a-block', description: 'Delete block', inputSchema: { type: 'object' as const } },
      { name: 'API-post-search', description: 'Search', inputSchema: { type: 'object' as const } },
    ], policy);

    expect(filtered.map(({ name }) => name)).toEqual(['API-post-page', 'API-post-search']);
  });

  it('rejects tools and resource arguments outside the prepared policy', () => {
    expect(toolCallPolicyError(policy, 'API-delete-a-block', {}))
      .toBe('Tool "API-delete-a-block" is not approved for this run.');
    expect(toolCallPolicyError(policy, 'API-post-page', { data_source_id: 'database-2' }))
      .toBe('Tool "API-post-page" cannot use data_source_id="database-2" for this run.');
  });

  it('allows an approved tool only with its bound resource argument', () => {
    expect(toolCallPolicyError(policy, 'API-post-page', { data_source_id: 'database-1' }))
      .toBeUndefined();
    expect(toolCallPolicyError(policy, 'API-post-page', {}))
      .toBe('Tool "API-post-page" requires an approved data_source_id for this run.');
    expect(toolCallPolicyError(policy, 'API-post-search', { query: 'roadmap' }))
      .toBeUndefined();
  });

  it('enforces an approved nested resource argument', () => {
    const nestedPolicy: RuntimeConnectionPolicy = {
      allowedTools: ['API-post-page'],
      argumentConstraints: {
        'API-post-page': { 'parent.database_id': ['database-1'] },
      },
    };

    expect(toolCallPolicyError(nestedPolicy, 'API-post-page', {
      parent: { type: 'database_id', database_id: 'database-1' },
    })).toBeUndefined();
    expect(toolCallPolicyError(nestedPolicy, 'API-post-page', {
      parent: { type: 'database_id', database_id: 'database-2' },
    })).toBe(
      'Tool "API-post-page" cannot use parent.database_id="database-2" for this run.',
    );
  });

  it('enforces the policy through the MCP protocol', async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'created' }] }));
    const relay = createPolicyRelayServer({
      listTools: async () => ({
        tools: [
          { name: 'API-post-page', inputSchema: { type: 'object' as const } },
          { name: 'API-delete-a-block', inputSchema: { type: 'object' as const } },
        ],
      }),
      callTool,
    }, policy);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const runtime = new Client(
      { name: 'test-runtime', version: '1.0.0' },
      { capabilities: {} },
    );
    await relay.connect(serverTransport);
    await runtime.connect(clientTransport);
    try {
      expect((await runtime.listTools()).tools.map(({ name }) => name))
        .toEqual(['API-post-page']);
      await expect(runtime.callTool({
        name: 'API-post-page',
        arguments: { data_source_id: 'database-1' },
      })).resolves.toMatchObject({ content: [{ text: 'created' }] });
      await expect(runtime.callTool({
        name: 'API-post-page',
        arguments: { data_source_id: 'database-2' },
      })).rejects.toThrow('cannot use data_source_id');
      expect(callTool).toHaveBeenCalledTimes(1);
    } finally {
      await runtime.close();
      await relay.close();
    }
  });

  it('appends Notion page blocks beyond the create request limit', async () => {
    const children = Array.from({ length: 130 }, (_, index) => ({
      object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: `${index}` } }] },
    }));
    const callTool = vi.fn(async (request: { name: string; arguments?: Record<string, unknown> }) => {
      if (request.name === 'API-post-page') {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ object: 'page', id: 'page-123' }) }],
        };
      }
      return { content: [{ type: 'text' as const, text: 'appended' }] };
    });
    const relay = createPolicyRelayServer({
      listTools: async () => ({ tools: [] }),
      callTool,
    }, {
      allowedTools: ['API-post-page'],
      argumentConstraints: { 'API-post-page': { 'parent.database_id': ['database-1'] } },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const runtime = new Client(
      { name: 'test-runtime', version: '1.0.0' },
      { capabilities: {} },
    );
    await relay.connect(serverTransport);
    await runtime.connect(clientTransport);
    try {
      await runtime.callTool({
        name: 'API-post-page',
        arguments: {
          parent: { type: 'database_id', database_id: 'database-1' },
          children,
        },
      });
      expect(callTool).toHaveBeenNthCalledWith(1, {
        name: 'API-post-page',
        arguments: expect.objectContaining({ children: children.slice(0, 100) }),
      });
      expect(callTool).toHaveBeenNthCalledWith(2, {
        name: 'API-patch-block-children',
        arguments: { block_id: 'page-123', children: children.slice(100) },
      });
    } finally {
      await runtime.close();
      await relay.close();
    }
  });
});
