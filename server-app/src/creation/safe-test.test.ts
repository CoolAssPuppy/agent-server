import { describe, expect, it, vi } from 'vitest';
import { makeAgent } from '../test-factories.js';
import { createSafeTestTrigger, prepareSafeTestAgent } from './safe-test.js';
import { safeTestSupport } from './safe-test-support.js';

describe('safe agent tests', () => {
  it('passes an ephemeral read-only override to execution without changing the saved agent', async () => {
    const saved = makeAgent({
      tools: ['Read', 'Write', 'Bash', 'WebFetch'],
      disallowed_tools: [],
      permissions: { allow: ['Read', 'Write', 'Bash', 'WebFetch'], deny: [] },
      codex_sandbox: 'workspace-write',
      notification: { channel: 'slack', on_complete: true, on_failure: true },
      interaction: { channel: 'telegram', on_reply: 'next', timeout: '30m' },
      watch: [{ path: '~/Documents' }],
      on_complete: [{ agent: 'next' }],
      connection_bindings: { notes: '11111111-1111-4111-8111-111111111111' },
      connections: {
        notes: {
          type: 'notion', name: 'Notion Work', purpose: 'Publish a report',
          operations: ['notion.page.create'], resources: {},
        },
      },
      calendar_access: [{ id: 'calendar-1', name: 'Work', access: 'read_write' }],
      native_services: {
        reminders: { resources: [{ id: 'list-1', name: 'Tasks', actions: ['read', 'create'] }] },
      },
      file_access: [
        { path: '/Users/test/Reference', kind: 'folder', access: 'read_only' },
        { path: '/Users/test/Output', kind: 'folder', access: 'read_write' },
      ],
    });
    const original = structuredClone(saved);
    const triggerAgent = vi.fn(() => 'safe-run');
    const trigger = createSafeTestTrigger({ getAgent: async () => saved, triggerAgent });

    await expect(trigger(saved.id)).resolves.toBe('safe-run');
    expect(saved).toEqual(original);
    expect(triggerAgent).toHaveBeenCalledWith(expect.objectContaining({
      tools: ['Read'],
      permissions: expect.objectContaining({ allow: ['Read'] }),
      codex_sandbox: 'read-only',
      permission_mode: 'dontAsk',
      notification: undefined,
      interaction: undefined,
      watch: undefined,
      on_complete: undefined,
      mcp_servers: {},
      connection_bindings: undefined,
      connections: undefined,
      calendar_access: undefined,
      native_services: undefined,
      file_access: [
        { path: '/Users/test/Reference', kind: 'folder', access: 'read_only' },
        { path: '/Users/test/Output', kind: 'folder', access: 'read_only' },
      ],
    }));
    const executed = triggerAgent.mock.calls[0]?.[0];
    expect(executed?.prompt).toContain('External actions are intentionally unavailable');
  });

  it('does not start an executor whose safe-test effects are not proven', async () => {
    const triggerAgent = vi.fn(() => 'unsafe-run');
    const trigger = createSafeTestTrigger({
      getAgent: async () => makeAgent({ executor: 'codex' }),
      triggerAgent,
    });

    await expect(trigger('test-agent')).rejects.toMatchObject({
      code: 'safe_test_unavailable',
      message: expect.stringContaining('Codex'),
    });
    expect(triggerAgent).not.toHaveBeenCalled();
  });

  it('publishes the enforced effects for each supported executor', () => {
    expect(safeTestSupport(makeAgent({ executor: 'claude-code' }))).toMatchObject({
      available: true,
      executor: 'claude-code',
      effects: {
        files: 'reviewed_read_only',
        commands: 'blocked',
        network: 'blocked',
        connections: 'simulated',
        externalWrites: 'blocked',
      },
    });
    expect(safeTestSupport(makeAgent({ executor: 'kimi-code' }))).toMatchObject({
      available: true,
      executor: 'kimi-code',
    });
    expect(safeTestSupport(makeAgent({ executor: 'codex' }))).toEqual({
      available: false,
      executor: 'codex',
      reason: 'Safe test is unavailable for Codex because command isolation has not been proven.',
    });
  });

  it('strips all write, command, web, message, and chained behavior', () => {
    const safe = prepareSafeTestAgent(makeAgent({
      tools: ['Read', 'Glob', 'Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch', 'FetchURL'],
      permissions: { allow: ['Read', 'Glob', 'Write', 'Edit', 'Bash', 'WebFetch'], deny: [] },
      schedule: '0 17 * * 5',
      on_failure: [{ agent: 'alert' }],
      conversation: { enabled: true, ttl: '30m' },
      file_access: [{ path: '/Users/test/Reference', kind: 'folder', access: 'read_only' }],
    }));

    expect(safe.tools).toEqual(['Read', 'Glob']);
    expect(safe.permissions?.deny).toEqual(expect.arrayContaining([
      'Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch', 'FetchURL', 'web_search', 'mcp__*',
    ]));
    expect(safe.schedule).toBeUndefined();
    expect(safe.on_failure).toBeUndefined();
    expect(safe.conversation).toBeUndefined();
    expect(safe.max_turns).toBeLessThanOrEqual(5);
  });

  it('does not invent broad read access when no paths were reviewed', () => {
    const safe = prepareSafeTestAgent(makeAgent({
      tools: ['Read', 'Glob', 'Grep'],
      permissions: { allow: ['Read', 'Glob', 'Grep'], deny: [] },
    }));

    expect(safe.file_access).toEqual([]);
    expect(safe.tools).toEqual([]);
    expect(safe.permissions?.allow).toEqual([]);
  });

  it('runs service agents with external connections stripped', async () => {
    const saved = makeAgent({
      tools: ['mcp__github__list_activity'],
      permissions: { allow: ['mcp__github__list_activity'], deny: [] },
    });
    const triggerAgent = vi.fn(() => 'safe-run');
    const trigger = createSafeTestTrigger({ getAgent: async () => saved, triggerAgent });

    await expect(trigger(saved.id)).resolves.toBe('safe-run');
    expect(triggerAgent.mock.calls[0]?.[0].permissions?.allow).toEqual([]);
    expect(triggerAgent.mock.calls[0]?.[0].mcp_servers).toEqual({});
  });
});
