import { describe, expect, it } from 'vitest';
import { renderLosslessAgentPatch } from '../agents/lossless-yaml-editor.js';
import { ConfigurationPatchSchema } from '../analysis/patch.js';
import type { ConnectionProfile } from './profile.js';
import { planInlineConnectionAdoption } from './adoption.js';

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const CREDENTIAL_ID = '22222222-2222-4222-8222-222222222222';

function profile(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    schema_version: 1,
    id: PROFILE_ID,
    label: 'A label the user may rename',
    adapter: { id: 'notion.rest-mcp', version: 1 },
    runtime_name: 'notion-personal',
    credentials: [{
      id: CREDENTIAL_ID,
      label: 'Token',
      environment_variable: 'NOTION_PERSONAL_API_KEY',
      secret: true,
    }],
    transport: {
      kind: 'mcp_stdio',
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server'],
      environment: { NOTION_TOKEN: CREDENTIAL_ID },
    },
    created_at: '2026-07-19T18:00:00.000Z',
    updated_at: '2026-07-19T18:00:00.000Z',
    ...overrides,
  };
}

const agentContent = `---
# Keep this comment exactly
id: lessons
name: Daily Lessons
custom_setting: keep-me
mcp_servers:
  notion-personal:
    command: npx
    args: ["-y", "@notionhq/notion-mcp-server"]
    env:
      NOTION_TOKEN: "\${NOTION_PERSONAL_API_KEY}"
  unrelated:
    type: http
    url: https://example.test/mcp
permissions:
  allow:
    - "mcp__notion-personal__API-post-search"
  deny: []
---

# Instructions

Keep this body exactly.
`;

describe('inline connection adoption planning', () => {
  it('proposes one reviewed patch for an exact runtime, transport, and credential-reference match', () => {
    const plan = planInlineConnectionAdoption(
      [{ content: agentContent }],
      [profile()],
    );

    expect(plan.refusals).toEqual([]);
    expect(plan.proposals).toHaveLength(1);
    const proposal = plan.proposals[0];
    expect(proposal.bindings).toEqual([{
      runtime_name: 'notion-personal',
      connection_id: PROFILE_ID,
    }]);
    expect(ConfigurationPatchSchema.parse(proposal.patch)).toEqual(proposal.patch);
    expect(proposal.patch.changes.connection_bindings).toEqual({
      'notion-personal': PROFILE_ID,
    });
    expect(proposal.patch.changes.mcp_servers).toBeUndefined();
  });

  it('keeps unrelated fields, comments, and the Markdown body when the proposed write is rendered', () => {
    const [proposal] = planInlineConnectionAdoption(
      [{ content: agentContent }],
      [profile()],
    ).proposals;
    const writes = new Map<string, unknown>(Object.entries(proposal.patch.changes));
    const rendered = renderLosslessAgentPatch(agentContent, writes, undefined);

    expect(rendered).toContain('# Keep this comment exactly');
    expect(rendered).toContain('custom_setting: keep-me');
    expect(rendered).toContain('unrelated:');
    expect(rendered).toContain('connection_bindings:');
    expect(rendered).toContain(`notion-personal: ${PROFILE_ID}`);
    expect(rendered).toContain('# Instructions\n\nKeep this body exactly.\n');
  });

  it('refuses an ambiguous exact match instead of choosing by label or input order', () => {
    const other = profile({
      id: '33333333-3333-4333-8333-333333333333',
      label: 'A different label',
    });
    const plan = planInlineConnectionAdoption(
      [{ content: agentContent }],
      [profile(), other],
    );

    expect(plan.proposals).toEqual([]);
    expect(plan.refusals).toEqual([{
      agent_id: 'lessons',
      runtime_name: 'notion-personal',
      reason: 'ambiguous_match',
      candidate_connection_ids: [PROFILE_ID, other.id],
    }]);
  });

  it('does not adopt a profile with a different environment reference', () => {
    const differentCredential = profile({
      credentials: [{
        id: CREDENTIAL_ID,
        label: 'Token',
        environment_variable: 'NOTION_API_KEY',
        secret: true,
      }],
    });
    const plan = planInlineConnectionAdoption(
      [{ content: agentContent }],
      [differentCredential],
    );

    expect(plan.proposals).toEqual([]);
    expect(plan.refusals[0]).toMatchObject({
      agent_id: 'lessons',
      runtime_name: 'notion-personal',
      reason: 'no_exact_match',
    });
  });

  it('does not adopt an identical transport under a different runtime identity', () => {
    const plan = planInlineConnectionAdoption(
      [{ content: agentContent }],
      [profile({ runtime_name: 'notion-work' })],
    );

    expect(plan.proposals).toEqual([]);
    expect(plan.refusals).toEqual([]);
  });

  it('treats omitted optional transport collections as their exact empty form', () => {
    const content = `id: helper
name: Helper
prompt: Use the helper.
mcp_servers:
  helper:
    command: helper-command
`;
    const noCredentialProfile = profile({
      runtime_name: 'helper',
      credentials: [],
      transport: {
        kind: 'mcp_stdio',
        command: 'helper-command',
        args: [],
        environment: {},
      },
    });

    expect(planInlineConnectionAdoption([{ content }], [noCredentialProfile]).proposals)
      .toHaveLength(1);
  });

  it('does not propose a migration for a runtime that is already bound', () => {
    const alreadyBound = agentContent.replace(
      'mcp_servers:',
      `connection_bindings:\n  notion-personal: ${PROFILE_ID}\nmcp_servers:`,
    );

    expect(planInlineConnectionAdoption([{ content: alreadyBound }], [profile()])).toEqual({
      proposals: [],
      refusals: [],
    });
  });
});
