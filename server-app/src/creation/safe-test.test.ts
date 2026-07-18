import { describe, expect, it, vi } from 'vitest';
import { makeAgent } from '../test-factories.js';
import { createSafeTestTrigger, prepareSafeTestAgent } from './safe-test.js';

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
    }));
    const executed = triggerAgent.mock.calls[0]?.[0];
    expect(executed?.prompt).toContain('External actions are intentionally unavailable');
  });

  it('strips all write, command, web, message, and chained behavior', () => {
    const safe = prepareSafeTestAgent(makeAgent({
      tools: ['Read', 'Glob', 'Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch'],
      permissions: { allow: ['Read', 'Glob', 'Write', 'Edit', 'Bash', 'WebFetch'], deny: [] },
      schedule: '0 17 * * 5',
      on_failure: [{ agent: 'alert' }],
      conversation: { enabled: true, ttl: '30m' },
    }));

    expect(safe.tools).toEqual(['Read', 'Glob']);
    expect(safe.permissions?.deny).toEqual(expect.arrayContaining([
      'Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch', 'web_search', 'mcp__*',
    ]));
    expect(safe.schedule).toBeUndefined();
    expect(safe.on_failure).toBeUndefined();
    expect(safe.conversation).toBeUndefined();
    expect(safe.max_turns).toBeLessThanOrEqual(5);
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
