import { describe, expect, it } from 'vitest';
import { makeAgent } from '../test-factories.js';
import {
  createAssistantHomePresentation,
  type AssistantHomeFacts,
} from './assistant-home.js';

const NOW = new Date('2026-08-02T10:00:00.000Z');
const MACHINE_ID = '1d2f8f5e-9ea8-4fce-89b1-1c7c2f5ecf99';

function facts(overrides: Partial<AssistantHomeFacts> = {}): AssistantHomeFacts {
  return {
    engine: { runtimeAvailable: true, authentication: 'verified' },
    paths: [],
    connections: [],
    canEnforceSafeTest: false,
    ...overrides,
  };
}

describe('Assistant home advanced details', () => {
  it('projects only existing bounded local configuration and presented connection IDs', () => {
    const presentation = createAssistantHomePresentation({
      machineId: MACHINE_ID,
      agent: makeAgent({
        schedule: '0 9 * * 1',
        executor: 'codex',
        model: 'gpt-5.6-codex',
        permission_mode: 'plan',
        permissions: {
          allow: [
            'Read',
            'mcp__notion__search',
            '/Users/person/Private',
            'Bash(/Users/person/Private/script.sh)',
          ],
          deny: ['Bash', 'Write'],
        },
        prompt: 'PRIVATE_INSTRUCTIONS credential-secret',
        working_directory: '/Users/person/Workspace',
        mcp_servers: {
          notion: {
            command: 'private-service',
            env: { NOTION_TOKEN: 'credential-secret' },
          },
        },
      }),
      runs: [],
      pendingInteractions: [],
      now: NOW,
      facts: facts({
        connections: [{
          id: 'notion-personal',
          label: 'Personal Notion',
          status: 'ready',
          sourceReference: 'agent.connection_bindings.notion',
        }],
      }),
    });

    expect(presentation.advanced).toEqual({
      scheduleExpression: '0 9 * * 1',
      executor: 'codex',
      model: 'gpt-5.6-codex',
      permissionMode: 'plan',
      permissionRules: {
        allow: [
          'Read',
          'mcp__notion__search',
          '/Users/person/Private',
          'Bash(/Users/person/Private/script.sh)',
        ],
        deny: ['Bash', 'Write'],
      },
      connectionIds: ['notion-personal'],
    });
    const serialized = JSON.stringify(presentation.advanced);
    expect(serialized).not.toContain('PRIVATE_INSTRUCTIONS');
    expect(serialized).not.toContain('credential-secret');
    expect(serialized).not.toContain('private-service');
    expect(serialized).not.toContain('/Users/person/Workspace');
  });

  it('uses the real executor default and omits configuration that is not saved', () => {
    const presentation = createAssistantHomePresentation({
      machineId: MACHINE_ID,
      agent: makeAgent({
        schedule: undefined,
        executor: undefined,
        model: undefined,
        permission_mode: undefined,
        permissions: undefined,
      }),
      runs: [],
      pendingInteractions: [],
      now: NOW,
      facts: facts(),
    });

    expect(presentation.advanced).toEqual({
      executor: 'claude-code',
      permissionRules: { allow: [], deny: [] },
      connectionIds: [],
    });
  });
});
