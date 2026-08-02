import { describe, expect, it } from 'vitest';
import { makeAgent, makeStoredRun } from '../test-factories.js';
import {
  AssistantHomePresentationSchema,
  createAssistantHomePresentation,
  type AssistantHomeFacts,
} from './assistant-home.js';

const MACHINE_ID = '1d2f8f5e-9ea8-4fce-89b1-1c7c2f5ecf99';
const NOW = new Date('2026-08-02T10:00:00.000Z');

function makeFacts(overrides: Partial<AssistantHomeFacts> = {}): AssistantHomeFacts {
  return {
    engine: { runtimeAvailable: true, authentication: 'verified' },
    paths: [],
    connections: [],
    canEnforceSafeTest: false,
    ...overrides,
  };
}

describe('Assistant home presentation', () => {
  it('tells one ready assistant story from deterministic local facts', () => {
    const agent = makeAgent({
      id: 'weekly-report',
      name: 'Weekly Report',
      description: 'Prepares the team report from local notes.',
      schedule: '0 9 * * 1',
      timezone: 'UTC',
      working_directory: '/Users/person/Documents/Reports',
      file_access: [
        { path: '/Users/person/Documents/Reports', kind: 'folder', access: 'read_write' },
        { path: '/Users/person/Documents/Manuscript.docx', kind: 'file', access: 'read_only' },
      ],
      permissions: { allow: ['Read', 'Glob', 'Grep', 'Write', 'Edit'], deny: ['Bash'] },
      output: {
        primary: {
          description: 'Updated weekly report',
          tool: 'Write',
          target: '/Users/person/Documents/Reports/weekly.md',
          required: true,
        },
      },
    });
    const presentation = createAssistantHomePresentation({
      machineId: MACHINE_ID,
      agent,
      runs: [makeStoredRun({
        runId: 'run-7',
        agentId: agent.id,
        agentName: agent.name,
        status: 'completed',
        summary: 'Updated the weekly report.',
        completedAt: new Date('2026-08-02T09:05:00.000Z'),
      })],
      pendingInteractions: [],
      now: NOW,
      facts: makeFacts({
        paths: [
          { path: '/Users/person/Documents/Reports', exists: true, readable: true, writable: true },
          { path: '/Users/person/Documents/Manuscript.docx', exists: true, readable: true, writable: false },
        ],
        destination: { configured: true, verified: true },
      }),
    });

    expect(AssistantHomePresentationSchema.parse(presentation)).toEqual(presentation);
    expect(presentation).toMatchObject({
      assistant: {
        installationId: `${MACHINE_ID}:weekly-report`,
        localAgentId: 'weekly-report',
        displayName: 'Weekly Report',
      },
      purpose: { text: 'Prepares the team report from local notes.' },
      health: { state: 'healthy' },
      readiness: { state: 'ready', summary: { text: 'Ready to run.' } },
      schedule: { kind: 'scheduled', nextRunAt: '2026-08-03T09:00:00.000Z' },
      destination: { text: 'Results go to Updated weekly report.' },
      primaryAction: { kind: 'run', label: 'Run now', targetReference: 'assistant:weekly-report' },
      advancedReference: '/agents/weekly-report',
    });
    expect(presentation.permissions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        effect: 'can',
        action: 'edit',
        targetLabel: 'Reports',
        exactScopeReference: '/Users/person/Documents/Reports',
        sourceRuleReference: 'agent.file_access[0]',
      }),
      expect.objectContaining({
        effect: 'can',
        action: 'read',
        targetLabel: 'Manuscript.docx',
        sourceRuleReference: 'agent.file_access[1]',
      }),
      expect.objectContaining({
        effect: 'cannot',
        action: 'execute',
        sourceRuleReference: 'agent.permissions.deny',
      }),
    ]));
    expect(presentation.recentOutcomes[0]).toMatchObject({
      runId: 'run-7',
      outcome: 'succeeded',
      reviewReference: '/runs/run-7/review',
    });
  });

  it('keeps unknown engine sign-in and destination checks unavailable', () => {
    const agent = makeAgent({
      id: 'publisher',
      schedule: undefined,
      output: { primary: { description: 'Published update', tool: 'mcp__site__publish' } },
    });
    const presentation = createAssistantHomePresentation({
      machineId: MACHINE_ID,
      agent,
      runs: [],
      pendingInteractions: [],
      now: NOW,
      facts: makeFacts({
        engine: { runtimeAvailable: true, authentication: 'unknown' },
        destination: { configured: true, verified: 'unknown' },
      }),
    });

    expect(presentation.readiness.state).toBe('unavailable');
    expect(presentation.readiness.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'engine', state: 'unknown' }),
      expect.objectContaining({ kind: 'destination', state: 'unknown' }),
    ]));
    expect(presentation.health.state).toBe('needs_attention');
    expect(presentation.primaryAction).toMatchObject({ kind: 'edit', label: 'Finish setup' });
    expect(presentation.secondaryActions.map(({ kind }) => kind)).not.toContain('safe_test');
  });

  it('reports deterministic blockers and makes the current request primary', () => {
    const agent = makeAgent({
      id: 'continuity-review',
      name: 'Continuity Review',
      working_directory: '/missing/manuscript',
      connection_bindings: { notes: '11111111-1111-4111-8111-111111111111' },
      mcp_servers: { notes: { command: 'notes-mcp' } },
    });
    const presentation = createAssistantHomePresentation({
      machineId: MACHINE_ID,
      agent,
      runs: [makeStoredRun({
        runId: 'waiting-run',
        agentId: agent.id,
        agentName: agent.name,
        status: 'running',
      })],
      pendingInteractions: [{
        id: 'interaction-1',
        runId: 'waiting-run',
        agentId: agent.id,
        replyAgentId: agent.id,
        request: { message: 'Choose the manuscript folder.', options: [], freeText: true },
        channel: 'console',
        createdAt: new Date('2026-08-02T09:50:00.000Z'),
        expiresAt: new Date('2026-08-02T10:30:00.000Z'),
        status: 'pending',
      }],
      now: NOW,
      facts: makeFacts({
        paths: [{ path: '/missing/manuscript', exists: false, readable: false, writable: false }],
        connections: [{
          id: '11111111-1111-4111-8111-111111111111',
          label: 'Notes',
          status: 'needs_setup',
          sourceReference: 'agent.connection_bindings.notes',
        }],
      }),
    });

    expect(presentation.health.state).toBe('working');
    expect(presentation.readiness.state).toBe('blocked');
    expect(presentation.readiness.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'file', state: 'fail' }),
      expect.objectContaining({ kind: 'connection', state: 'action_required' }),
    ]));
    expect(presentation.attention).toMatchObject({
      summary: { text: 'Choose the manuscript folder.' },
      action: { kind: 'resolve_attention', targetReference: 'interaction:interaction-1' },
    });
    expect(presentation.primaryAction.kind).toBe('resolve_attention');
  });

  it('does not infer connection actions or command-specific send and publish permissions', () => {
    const agent = makeAgent({
      tools: ['Bash', 'mcp__gmail__send_message', 'mcp__github__push'],
      mcp_servers: { gmail: { command: 'gmail-mcp' } },
    });
    const presentation = createAssistantHomePresentation({
      machineId: MACHINE_ID,
      agent,
      runs: [],
      pendingInteractions: [],
      now: NOW,
      facts: makeFacts({
        connections: [{
          id: 'gmail',
          label: 'Gmail',
          status: 'ready',
          sourceReference: 'agent.mcp_servers.gmail',
        }],
      }),
    });

    expect(presentation.permissions.some(({ action }) => action === 'send')).toBe(false);
    expect(presentation.permissions.some(({ action }) => action === 'publish')).toBe(false);
    expect(presentation.permissions).toContainEqual(expect.objectContaining({
      effect: 'can',
      action: 'execute',
      sourceRuleReference: 'agent.tools',
    }));
    expect(presentation.connections[0]).toMatchObject({ label: 'Gmail', state: 'ready' });
  });

  it('intersects file grants with the effective tool allowlist', () => {
    const agent = makeAgent({
      file_access: [{ path: '/Users/person/Book', kind: 'folder', access: 'read_write' }],
      permissions: { allow: ['Read'], deny: ['Write', 'Edit', 'Bash'] },
    });
    const presentation = createAssistantHomePresentation({
      machineId: MACHINE_ID,
      agent,
      runs: [],
      pendingInteractions: [],
      now: NOW,
      facts: makeFacts({
        paths: [{ path: '/Users/person/Book', exists: true, readable: true, writable: true }],
      }),
    });

    expect(presentation.permissions).toEqual(expect.arrayContaining([
      expect.objectContaining({ effect: 'can', action: 'read', targetLabel: 'Book' }),
      expect.objectContaining({
        effect: 'cannot',
        action: 'edit',
        targetLabel: 'Book',
        sourceRuleReference: 'agent.permissions.deny',
      }),
    ]));
  });

  it('attributes a closed allowlist instead of inventing a deny rule', () => {
    const presentation = createAssistantHomePresentation({
      machineId: MACHINE_ID,
      agent: makeAgent({ permissions: { allow: ['Read'], deny: [] } }),
      runs: [],
      pendingInteractions: [],
      now: NOW,
      facts: makeFacts(),
    });

    expect(presentation.permissions).toContainEqual(expect.objectContaining({
      effect: 'cannot',
      action: 'execute',
      sourceRuleReference: 'agent.permissions.allow',
    }));
  });

  it('keeps historical outcomes unchanged after the current output contract is edited', () => {
    const run = makeStoredRun({
      runId: 'historical-run',
      status: 'completed',
      summary: 'Prepared the earlier report.',
    });
    const createPresentation = (agent: ReturnType<typeof makeAgent>) => (
      createAssistantHomePresentation({
        machineId: MACHINE_ID,
        agent,
        runs: [run],
        pendingInteractions: [],
        now: NOW,
        facts: makeFacts(),
      })
    );

    const beforeEdit = createPresentation(makeAgent({ output: undefined }));
    const afterEdit = createPresentation(makeAgent({
      output: {
        primary: {
          description: 'Newly edited private report',
          tool: 'Write',
          required: true,
        },
      },
    }));

    expect(afterEdit.recentOutcomes).toEqual(beforeEdit.recentOutcomes);
    expect(JSON.stringify(afterEdit.recentOutcomes)).not.toContain('Newly edited private report');
    expect(JSON.stringify(afterEdit.recentOutcomes)).not.toContain('agent.output.primary');
  });
});
