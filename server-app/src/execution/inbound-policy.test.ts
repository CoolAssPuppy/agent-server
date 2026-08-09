import { describe, it, expect } from 'vitest';
import { canRunFromInbound } from './inbound-policy.js';
import type { AgentConfig } from '../agents/config.js';

function agent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'linear-capture',
    name: 'Linear Capture',
    prompt: 'Read the issue and write it down.',
    tools: [],
    disallowed_tools: [],
    max_turns: 20,
    enabled: true,
    ...overrides,
  } as AgentConfig;
}

const LINEAR_READ_ONLY = {
  tools: ['mcp__claude_ai_Linear', 'mcp__notion-work'],
  permissions: {
    allow: ['mcp__claude_ai_Linear__get_*', 'mcp__claude_ai_Linear__list_*'],
    deny: [
      'mcp__claude_ai_Linear__save_*',
      'mcp__claude_ai_Linear__create_*',
      'mcp__claude_ai_Linear__update_*',
      'mcp__claude_ai_Linear__delete_*',
      'mcp__claude_ai_Linear__merge_*',
      'mcp__claude_ai_Linear__submit_*',
      'mcp__claude_ai_Linear__resolve_*',
    ],
  },
};

describe('Running an agent because an inbound event asked', () => {
  it('allows an agent that reads the source and writes somewhere else', () => {
    expect(canRunFromInbound(agent(LINEAR_READ_ONLY), 'linear')).toEqual({ allowed: true });
  });

  it('refuses an agent that can write back to the source that triggered it', () => {
    const verdict = canRunFromInbound(
      agent({
        tools: ['mcp__claude_ai_Linear'],
        permissions: { allow: ['mcp__claude_ai_Linear__save_comment'], deny: [] },
      }),
      'linear',
    );

    expect(verdict.allowed).toBe(false);
  });

  it('names the exact deny entries that would make it eligible', () => {
    const verdict = canRunFromInbound(
      agent({
        tools: ['mcp__claude_ai_Linear'],
        permissions: {
          allow: ['mcp__claude_ai_Linear__list_*'],
          deny: ['mcp__claude_ai_Linear__save_*', 'mcp__claude_ai_Linear__create_*'],
        },
      }),
      'linear',
    );

    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.reason).toContain('update_*');
    expect(verdict.reason).toContain('delete_*');
    expect(verdict.reason).not.toContain('save_*');
  });

  it('allows an agent that cannot reach the source at all', () => {
    // It cannot write back to something it has no connection to.
    expect(
      canRunFromInbound(
        agent({ tools: ['mcp__notion-work'], permissions: { allow: [], deny: [] } }),
        'linear',
      ),
    ).toEqual({ allowed: true });
  });

  it('accepts a whole-server deny as covering every write family', () => {
    expect(
      canRunFromInbound(
        agent({
          tools: ['mcp__claude_ai_Linear'],
          permissions: { allow: ['mcp__claude_ai_Linear__get_issue'], deny: ['mcp__claude_ai_Linear'] },
        }),
        'linear',
      ),
    ).toEqual({ allowed: true });
  });

  it('judges each source separately', () => {
    // Writing to Notion is the whole point. It only matters that the agent
    // cannot write to the source that triggered it.
    const notionWriter = agent({
      ...LINEAR_READ_ONLY,
      permissions: {
        ...LINEAR_READ_ONLY.permissions,
        allow: [...LINEAR_READ_ONLY.permissions.allow, 'mcp__notion-work__notion-create-pages'],
      },
    });

    expect(canRunFromInbound(notionWriter, 'linear')).toEqual({ allowed: true });
    expect(canRunFromInbound(notionWriter, 'notion').allowed).toBe(false);
  });

  it('refuses a source it has no write policy for, rather than guessing', () => {
    const verdict = canRunFromInbound(agent(LINEAR_READ_ONLY), 'generic');

    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.reason).toContain('no write policy');
  });

  it('refuses a Slack agent that can send messages', () => {
    const verdict = canRunFromInbound(
      agent({
        tools: ['mcp__claude_ai_Slack'],
        permissions: { allow: ['mcp__claude_ai_Slack__slack_send_message'], deny: [] },
      }),
      'slack',
    );

    expect(verdict.allowed).toBe(false);
  });

  it('allows a Slack agent that denies every send family', () => {
    expect(
      canRunFromInbound(
        agent({
          tools: ['mcp__claude_ai_Slack'],
          permissions: {
            allow: ['mcp__claude_ai_Slack__slack_read_*'],
            deny: [
              'mcp__claude_ai_Slack__slack_send_*',
              'mcp__claude_ai_Slack__slack_schedule_*',
              'mcp__claude_ai_Slack__slack_create_*',
              'mcp__claude_ai_Slack__slack_update_*',
              'mcp__claude_ai_Slack__slack_add_*',
            ],
          },
        }),
        'slack',
      ),
    ).toEqual({ allowed: true });
  });
});
