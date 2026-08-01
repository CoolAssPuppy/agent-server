import { describe, expect, it } from 'vitest';

import { computeAgentContentHash } from '../analysis/security-rules.js';
import { makeAgent } from '../test-factories.js';
import { buildV2AssistantSyncPayload } from './v2-assistant-sync.js';

const machineId = '1d2f8f5e-9ea8-4fce-89b1-1c7c2f5ecf99';
const now = new Date('2026-08-01T09:00:00.000Z');

describe('buildV2AssistantSyncPayload', () => {
  it('serializes operational identity and schedule data without local content', () => {
    const content = [
      'id: weekly-report',
      'name: Weekly Report',
      'description: Private description',
      'prompt: Read /Users/name/private and use secret-token.',
    ].join('\n');
    const payload = buildV2AssistantSyncPayload([
      {
        agent: makeAgent({
          id: 'weekly-report',
          name: 'Weekly Report',
          description: 'Private description',
          prompt: 'Read /Users/name/private and use secret-token.',
          working_directory: '/Users/name/private',
          schedule: undefined,
          timezone: undefined,
          enabled: true,
        }),
        content,
      },
      {
        agent: makeAgent({ id: 'paused-assistant', enabled: false }),
        content: 'id: paused-assistant\nenabled: false\n',
      },
    ], { machineId, now });

    expect(payload).toMatchObject({
      protocol_version: 2,
      machine_id: machineId,
      privacy_level: 'operational',
    });
    expect(payload.assistants).toHaveLength(2);
    expect(payload.assistants.find((assistant) => assistant.local_agent_id === 'paused-assistant'))
      .toMatchObject({ enabled: false });
    expect(payload.assistants.find((assistant) => assistant.local_agent_id === 'weekly-report'))
      .toEqual({
        protocol_version: 2,
        machine_id: machineId,
        local_agent_id: 'weekly-report',
        display_name: 'Weekly Report',
        enabled: true,
        definition_hash: computeAgentContentHash(content),
      });
    expect(JSON.stringify(payload)).not.toContain('Private description');
    expect(JSON.stringify(payload)).not.toContain('/Users/name/private');
    expect(JSON.stringify(payload)).not.toContain('secret-token');
  });

  it('hashes exact definition content instead of re-rendering parsed configuration', () => {
    const agent = makeAgent({ id: 'same-agent' });
    const first = buildV2AssistantSyncPayload(
      [{ agent, content: 'id: same-agent\nprompt: First\n' }],
      { machineId, now },
    );
    const second = buildV2AssistantSyncPayload(
      [{ agent, content: 'id: same-agent\nprompt: Second\n' }],
      { machineId, now },
    );

    expect(first.assistants[0].definition_hash).not.toBe(second.assistants[0].definition_hash);
  });

  it('includes only an explicit description after opt-in and never derives one from instructions', () => {
    const payload = buildV2AssistantSyncPayload([
      {
        agent: makeAgent({ id: 'explicit', description: '  Approved summary  ', prompt: 'Private prompt' }),
        content: 'explicit',
      },
      {
        agent: makeAgent({ id: 'prompt-only', description: undefined, prompt: 'Private first paragraph' }),
        content: 'prompt-only',
      },
    ], { machineId, now, includeDescriptions: true });

    expect(payload.assistants.find((assistant) => assistant.local_agent_id === 'explicit')?.description)
      .toBe('Approved summary');
    expect(payload.assistants.find((assistant) => assistant.local_agent_id === 'prompt-only')?.description)
      .toBeUndefined();
  });

  it('sorts by local identity and rejects duplicate identities', () => {
    const alpha = { agent: makeAgent({ id: 'alpha' }), content: 'alpha' };
    const beta = { agent: makeAgent({ id: 'beta' }), content: 'beta' };

    const payload = buildV2AssistantSyncPayload([beta, alpha], { machineId, now });
    expect(payload.assistants.map((assistant) => assistant.local_agent_id)).toEqual(['alpha', 'beta']);
    expect(() => buildV2AssistantSyncPayload([alpha, alpha], { machineId, now }))
      .toThrow('Duplicate local assistant identity');
  });

  it('projects a valid schedule and omits only the invalid next-run calculation', () => {
    const scheduled = buildV2AssistantSyncPayload([{
      agent: makeAgent({ id: 'scheduled', schedule: '0 9 * * *', timezone: 'UTC' }),
      content: 'scheduled',
    }], { machineId, now });
    const invalid = buildV2AssistantSyncPayload([{
      agent: makeAgent({ id: 'invalid', schedule: 'not a cron' }),
      content: 'invalid',
    }], { machineId, now });

    expect(scheduled.assistants[0]).toMatchObject({
      cron_expression: '0 9 * * *',
      timezone: 'UTC',
    });
    expect(scheduled.assistants[0].next_run_at).toBe('2026-08-02T09:00:00.000Z');
    expect(invalid.assistants[0].cron_expression).toBe('not a cron');
    expect(invalid.assistants[0].next_run_at).toBeUndefined();
  });
});
