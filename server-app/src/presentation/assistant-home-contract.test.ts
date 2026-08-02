import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeAgent, makeStoredRun } from '../test-factories.js';
import { createAssistantHomePresentation } from './assistant-home.js';

describe('shared Assistant home contract fixture', () => {
  it('matches the frozen cross-client consumer meaning', () => {
    const agent = makeAgent({
      id: 'weekly-report',
      name: 'Weekly Report',
      description: 'Prepares the weekly report from local notes.',
      schedule: undefined,
      working_directory: '/Users/example/Reports',
      permissions: { allow: ['Read', 'Write'], deny: ['Bash'] },
      output: {
        primary: { description: 'Weekly report', tool: 'Write', required: true },
      },
    });
    const presentation = createAssistantHomePresentation({
      machineId: '1d2f8f5e-9ea8-4fce-89b1-1c7c2f5ecf99',
      agent,
      runs: [makeStoredRun({
        runId: 'waiting-run',
        agentId: agent.id,
        agentName: agent.name,
        status: 'running',
        startedAt: new Date('2026-08-02T09:30:00.000Z'),
      })],
      pendingInteractions: [{
        id: 'interaction-1',
        runId: 'waiting-run',
        agentId: agent.id,
        replyAgentId: agent.id,
        request: {
          message: 'Choose where to save the report.',
          options: [{ label: 'Team page', value: 'team-page' }],
          freeText: false,
        },
        channel: 'console',
        createdAt: new Date('2026-08-02T09:45:00.000Z'),
        expiresAt: new Date('2026-08-02T10:30:00.000Z'),
        status: 'pending',
      }],
      now: new Date('2026-08-02T10:00:00.000Z'),
      facts: {
        engine: { runtimeAvailable: true, authentication: 'unknown' },
        paths: [{
          path: '/Users/example/Reports',
          exists: true,
          readable: true,
          writable: true,
        }],
        connections: [{
          id: 'reports',
          label: 'Team reports',
          status: 'needs_setup',
          sourceReference: 'agent.connection_bindings.reports',
        }],
        destination: { configured: true, verified: 'unknown' },
        canEnforceSafeTest: false,
      },
    });
    const fixture = JSON.parse(readFileSync(resolve(
      '..', 'docs/v2/fixtures/assistant-home-local.json',
    ), 'utf8')) as unknown;

    expect(presentation).toEqual(fixture);
  });
});
