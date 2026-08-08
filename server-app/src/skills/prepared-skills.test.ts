import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentBindingSet } from '../agents/agent-binding-store.js';
import {
  attachRuntimeConnectionPolicies,
  runtimeConnectionPolicy,
} from '../connections/runtime-policy.js';
import { createTempDir, makeAgent } from '../test-factories.js';
import { prepareAgentSkills } from './prepared-skills.js';

function installedSkill(): string {
  const directory = join(createTempDir('prepared-skill'), 'fiction-diagnostic');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'SKILL.md'), `---
name: fiction-diagnostic
description: Diagnose fiction drafts for developmental and prose problems.
---

# Fiction diagnostic

Ground every finding in an exact passage and location.
`);
  return directory;
}

function bindings(path: string): AgentBindingSet {
  return {
    revision: 1,
    connections: {},
    skills: { editorial_diagnostic: { path } },
  };
}

describe('prepared agent skills', () => {
  it('injects one validated local implementation for a semantic skill requirement', async () => {
    const agent = makeAgent({
      prompt: 'Review only manuscript changes since the prior run.',
      skills: {
        editorial_diagnostic: {
          name: 'Fiction manuscript diagnostic',
          purpose: 'Find structural, continuity, character, and prose problems.',
        },
      },
    });

    const prepared = await prepareAgentSkills(agent, bindings(installedSkill()));

    expect(prepared.prompt).toContain('Review only manuscript changes since the prior run.');
    expect(prepared.prompt).toContain('Fiction manuscript diagnostic');
    expect(prepared.prompt).toContain('Find structural, continuity, character, and prose problems.');
    expect(prepared.prompt).toContain('Ground every finding in an exact passage and location.');
    expect(prepared.prompt).toContain('<agent_server_skills>');
  });

  it('refuses to run when a required local skill is not selected', async () => {
    const agent = makeAgent({
      skills: {
        editorial_diagnostic: {
          name: 'Fiction manuscript diagnostic',
          purpose: 'Diagnose the manuscript.',
        },
      },
    });

    await expect(prepareAgentSkills(agent, {
      revision: 0, connections: {}, skills: {},
    })).rejects.toThrow('Choose a local skill for "Fiction manuscript diagnostic"');
  });

  it('prepares the same instructions before either Codex or Claude Code is selected', async () => {
    const skillPath = installedSkill();
    const base = makeAgent({
      skills: {
        editorial_diagnostic: {
          name: 'Fiction manuscript diagnostic', purpose: 'Diagnose the manuscript.',
        },
      },
    });

    const codex = await prepareAgentSkills({ ...base, executor: 'codex' }, bindings(skillPath));
    const claude = await prepareAgentSkills({ ...base, executor: 'claude-code' }, bindings(skillPath));

    expect(codex.prompt).toBe(claude.prompt);
  });

  it('preserves an enforced connection policy while adding skill instructions', async () => {
    const agent = makeAgent({
      skills: {
        editorial_diagnostic: {
          name: 'Fiction manuscript diagnostic', purpose: 'Diagnose the manuscript.',
        },
      },
    });
    attachRuntimeConnectionPolicies(agent, {
      notion_personal: {
        allowedTools: ['API-post-page'],
        argumentConstraints: {
          'API-post-page': { 'parent.database_id': ['approved-database'] },
        },
      },
    });

    const prepared = await prepareAgentSkills(agent, bindings(installedSkill()));

    expect(runtimeConnectionPolicy(prepared, 'notion_personal')).toEqual({
      allowedTools: ['API-post-page'],
      argumentConstraints: {
        'API-post-page': { 'parent.database_id': ['approved-database'] },
      },
    });
  });
});
