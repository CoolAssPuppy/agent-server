import { describe, expect, it } from 'vitest';
import { makeAgent } from '../test-factories.js';
import { applyRuntimeAssignment } from './runtime-assignment-resolution.js';

describe('runtime assignment resolution', () => {
  it('keeps legacy frontmatter while an agent has no local assignment', () => {
    const agent = makeAgent({ executor: 'claude-code', model: 'legacy-model' });

    expect(applyRuntimeAssignment(agent, undefined)).toBe(agent);
  });

  it('overlays local runtime selection without mutating the shareable agent', () => {
    const agent = makeAgent({
      executor: 'claude-code',
      model: 'legacy-model',
      provider: { base_url: 'http://localhost:11434/v1' },
    });

    const resolved = applyRuntimeAssignment(agent, {
      agent_id: agent.id,
      executor: 'codex',
      revision: 1,
      updated_at: '2026-08-06T12:00:00.000Z',
    });

    expect(resolved).toEqual(expect.objectContaining({
      executor: 'codex',
      model: undefined,
      provider: undefined,
    }));
    expect(agent).toEqual(expect.objectContaining({
      executor: 'claude-code',
      model: 'legacy-model',
      provider: { base_url: 'http://localhost:11434/v1' },
    }));
  });
});
