import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { PendingInteraction } from '../interaction/store.js';
import { makeAgent, makeStoredRun } from '../test-factories.js';
import type {
  ReadinessCheck,
  ReadinessPresentation,
} from './assistant-home-models.js';
import {
  createActivityPresentation,
  createTodayPresentation,
  type TodayActivityInput,
} from './today-activity.js';

const machineId = '1d2f8f5e-9ea8-4fce-89b1-1c7c2f5ecf99';
const now = new Date('2026-08-02T10:00:00.000Z');
const recentSince = new Date('2026-08-02T00:00:00.000Z');
const upcomingUntil = new Date('2026-08-03T00:00:00.000Z');

function makeInteraction(
  overrides: Partial<PendingInteraction> = {},
): PendingInteraction {
  return {
    id: 'interaction-1',
    runId: 'needs-run',
    agentId: 'needs-agent',
    replyAgentId: 'needs-agent',
    request: {
      message: 'Choose the report destination.',
      options: [
        { label: 'Team page', value: 'team' },
        { label: 'Private page', value: 'private' },
      ],
      freeText: false,
    },
    channel: 'console',
    createdAt: new Date('2026-08-02T09:30:00.000Z'),
    expiresAt: new Date('2026-08-02T10:30:00.000Z'),
    status: 'pending',
    ...overrides,
  };
}

function makeInput(overrides: Partial<TodayActivityInput> = {}): TodayActivityInput {
  return {
    machineId,
    agents: [],
    runs: [],
    pendingInteractions: [],
    now,
    recentSince,
    upcomingUntil,
    ...overrides,
  };
}

function makeReadiness(
  checks: readonly ReadinessCheck[],
): ReadinessPresentation {
  return {
    state: 'blocked',
    summary: {
      text: 'Resolve the blocked checks before running.',
      evidenceReferences: ['readiness.checks'],
    },
    checks: [...checks],
  };
}

function makeBlockingCheck(
  kind: ReadinessCheck['kind'],
  text: string,
): ReadinessCheck {
  return {
    kind,
    state: 'fail',
    explanation: { text, evidenceReferences: [`check.${kind}`] },
    evidenceSource: `check.${kind}`,
  };
}

describe('consumer Today presentation', () => {
  it('orders nonempty sections, assigns one action, and applies item priority', () => {
    const agents = [
      makeAgent({ id: 'needs-agent', name: 'Weekly Report', schedule: undefined }),
      makeAgent({ id: 'working-agent', name: 'Release Summary', schedule: '0 12 * * *', timezone: 'UTC' }),
      makeAgent({ id: 'finished-agent', name: 'Reading List', schedule: undefined }),
      makeAgent({ id: 'problem-agent', name: 'Continuity Review', schedule: undefined }),
      makeAgent({ id: 'upcoming-agent', name: 'Daily Brief', schedule: '0 11 * * *', timezone: 'UTC' }),
    ];
    const runs = [
      makeStoredRun({
        runId: 'needs-run',
        agentId: 'needs-agent',
        agentName: 'Weekly Report',
        status: 'failed',
        code: 'output_contract_unmet',
        completedAt: new Date('2026-08-02T09:31:00.000Z'),
      }),
      makeStoredRun({
        runId: 'working-run',
        agentId: 'working-agent',
        agentName: 'Release Summary',
        status: 'running',
        startedAt: new Date('2026-08-02T09:45:00.000Z'),
        completedAt: undefined,
      }),
      makeStoredRun({
        runId: 'finished-run',
        agentId: 'finished-agent',
        agentName: 'Reading List',
        status: 'completed',
        summary: 'Added 6 articles to the reading list.',
        startedAt: new Date('2026-08-02T08:00:00.000Z'),
        completedAt: new Date('2026-08-02T08:03:00.000Z'),
      }),
      makeStoredRun({
        runId: 'problem-run',
        agentId: 'problem-agent',
        agentName: 'Continuity Review',
        status: 'failed',
        error: 'Folder missing at /Users/person/Private/Manuscript',
        startedAt: new Date('2026-08-02T07:00:00.000Z'),
        completedAt: new Date('2026-08-02T07:01:00.000Z'),
      }),
    ];

    const today = createTodayPresentation(makeInput({
      agents,
      runs,
      pendingInteractions: [makeInteraction()],
    }));

    expect(today.sections.map((section) => section.kind)).toEqual([
      'needs_you',
      'working',
      'finished',
      'problems',
      'upcoming',
    ]);
    expect(today.sections.map((section) => section.items)).toEqual([
      [expect.objectContaining({ id: 'run:needs-run' })],
      [expect.objectContaining({ id: 'run:working-run' })],
      [expect.objectContaining({ id: 'run:finished-run' })],
      [expect.objectContaining({ id: 'run:problem-run' })],
      [expect.objectContaining({ id: 'schedule:upcoming-agent' })],
    ]);
    expect(today.sections.flatMap((section) => section.items)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          section: 'needs_you',
          headline: expect.objectContaining({ text: 'Weekly Report needs your choice' }),
          explanation: expect.objectContaining({ text: 'Choose the report destination.' }),
          expiresAt: '2026-08-02T10:30:00.000Z',
          primaryAction: {
            kind: 'respond',
            label: 'Choose',
            targetReference: 'interaction:interaction-1',
          },
        }),
        expect.objectContaining({
          section: 'working',
          primaryAction: {
            kind: 'view_activity',
            label: 'View activity',
            targetReference: 'run:working-run',
          },
        }),
        expect.objectContaining({
          section: 'upcoming',
          scheduledAt: '2026-08-02T11:00:00.000Z',
          explanation: expect.objectContaining({ text: 'Scheduled to run next.' }),
        }),
      ]),
    );

    const serialized = JSON.stringify(today);
    expect(serialized).not.toContain('output_contract_unmet');
    expect(serialized).not.toContain('0 11 * * *');
    expect(serialized).not.toContain('/Users/person');
    expect(today.allClear).toBeUndefined();
  });

  it('keeps old pending work visible, omits old outcomes, and provides a calm all-clear', () => {
    const oldCompleted = makeStoredRun({
      runId: 'old-run',
      status: 'completed',
      startedAt: new Date('2026-08-01T07:00:00.000Z'),
      completedAt: new Date('2026-08-01T07:01:00.000Z'),
    });
    const pending = makeInteraction({
      runId: 'old-run',
      createdAt: new Date('2026-08-01T07:01:00.000Z'),
      expiresAt: new Date('2026-08-02T12:00:00.000Z'),
      request: { message: 'Add a short note.', freeText: true },
    });

    const withPending = createTodayPresentation(makeInput({
      agents: [makeAgent({ id: 'needs-agent', name: 'Weekly Report', schedule: undefined })],
      runs: [oldCompleted],
      pendingInteractions: [pending],
    }));
    const allClear = createTodayPresentation(makeInput({
      agents: [makeAgent({ id: 'manual-agent', name: 'Manual Assistant', schedule: undefined })],
    }));

    expect(withPending.sections).toHaveLength(1);
    expect(withPending.sections[0]?.items[0]).toMatchObject({
      section: 'needs_you',
      headline: { text: 'Weekly Report needs your answer' },
      primaryAction: { kind: 'respond', label: 'Answer' },
    });
    expect(allClear.sections).toEqual([]);
    expect(allClear.allClear).toEqual({
      text: 'Nothing needs your attention right now.',
      evidenceReferences: ['today.sections'],
    });
  });

  it('omits disabled, invalid, out-of-window, and currently working schedules', () => {
    const today = createTodayPresentation(makeInput({
      agents: [
        makeAgent({ id: 'disabled', enabled: false, schedule: '0 11 * * *', timezone: 'UTC' }),
        makeAgent({ id: 'invalid', schedule: 'not a schedule', timezone: 'UTC' }),
        makeAgent({ id: 'later', schedule: '0 1 * * *', timezone: 'UTC' }),
        makeAgent({ id: 'working', schedule: '0 11 * * *', timezone: 'UTC' }),
      ],
      runs: [makeStoredRun({
        runId: 'working-run',
        agentId: 'working',
        status: 'running',
        completedAt: undefined,
      })],
    }));

    expect(today.sections.map((section) => section.kind)).toEqual(['working']);
  });

  it('shows one actionable readiness blocker per assistant in consumer priority order', () => {
    const agent = makeAgent({ id: 'setup-agent', name: 'Weekly Report', schedule: undefined });
    const readiness = makeReadiness([
      makeBlockingCheck('permission', 'The saved access rules need review.'),
      makeBlockingCheck('schedule', 'The automatic schedule is not valid.'),
      makeBlockingCheck('file', 'Reports is missing or does not allow the required access.'),
      makeBlockingCheck('connection', 'Notion needs setup.'),
    ]);

    const today = createTodayPresentation(makeInput({
      agents: [agent],
      readinessByAgent: new Map([[agent.id, readiness]]),
    }));

    expect(today.sections).toEqual([{
      kind: 'needs_you',
      items: [expect.objectContaining({
        id: 'readiness:setup-agent',
        section: 'needs_you',
        assistant: expect.objectContaining({
          localAgentId: 'setup-agent',
          displayName: 'Weekly Report',
        }),
        headline: {
          text: 'Weekly Report needs setup',
          evidenceReferences: ['assistant.readiness'],
        },
        explanation: {
          text: 'Notion needs setup.',
          evidenceReferences: ['check.connection'],
        },
        primaryAction: {
          kind: 'view_assistant',
          label: 'Review assistant',
          targetReference: 'assistant:setup-agent',
        },
        sourceReferences: ['assistant.readiness', 'check.connection'],
      })],
    }]);
  });

  it.each([
    ['connection', 'Notion needs setup.'],
    ['file', 'Reports is missing.'],
    ['schedule', 'The automatic schedule is not valid.'],
    ['permission', 'The saved access rules need review.'],
  ] as const)('shows an actionable %s blocker when no higher-priority blocker exists', (kind, text) => {
    const agent = makeAgent({ id: `${kind}-agent`, name: 'Weekly Report', schedule: undefined });

    const today = createTodayPresentation(makeInput({
      agents: [agent],
      readinessByAgent: new Map([[
        agent.id,
        makeReadiness([makeBlockingCheck(kind, text)]),
      ]]),
    }));

    expect(today.sections[0]?.items[0]).toMatchObject({
      section: 'needs_you',
      explanation: { text },
      primaryAction: {
        kind: 'view_assistant',
        targetReference: `assistant:${kind}-agent`,
      },
    });
  });

  it('does not duplicate readiness attention while an assistant is working or awaiting a reply', () => {
    const workingAgent = makeAgent({ id: 'working-agent', schedule: undefined });
    const waitingAgent = makeAgent({ id: 'needs-agent', schedule: undefined });
    const readiness = makeReadiness([
      makeBlockingCheck('connection', 'A connection needs setup.'),
    ]);

    const today = createTodayPresentation(makeInput({
      agents: [workingAgent, waitingAgent],
      runs: [makeStoredRun({
        runId: 'working-run',
        agentId: workingAgent.id,
        status: 'running',
        completedAt: undefined,
      })],
      pendingInteractions: [makeInteraction()],
      readinessByAgent: new Map([
        [workingAgent.id, readiness],
        [waitingAgent.id, readiness],
      ]),
    }));

    expect(today.sections.flatMap((section) => section.items)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'readiness:working-agent' }),
        expect.objectContaining({ id: 'readiness:needs-agent' }),
      ]),
    );
  });
});

describe('unified Activity presentation', () => {
  it('creates one ordered item per run and preserves distinct consumer outcomes', () => {
    const agents = [
      makeAgent({ id: 'needs-agent', name: 'Weekly Report', schedule: undefined }),
      makeAgent({ id: 'complete-agent', name: 'Reading List', output: {
        primary: {
          description: 'Reading list',
          tool: 'mcp__notion__create_page',
          required: true,
        },
      }, schedule: undefined }),
    ];
    const runs = [
      makeStoredRun({
        runId: 'needs-run',
        agentId: 'needs-agent',
        agentName: 'Weekly Report',
        status: 'failed',
        startedAt: new Date('2026-08-02T09:30:00.000Z'),
        completedAt: new Date('2026-08-02T09:31:00.000Z'),
      }),
      makeStoredRun({
        runId: 'working-run',
        agentId: 'working-agent',
        agentName: 'Release Summary',
        status: 'running',
        startedAt: new Date('2026-08-02T09:00:00.000Z'),
        completedAt: undefined,
      }),
      makeStoredRun({
        runId: 'completed-run',
        agentId: 'complete-agent',
        agentName: 'Reading List',
        status: 'completed',
        summary: 'Added 6 articles.',
        startedAt: new Date('2026-08-02T08:00:00.000Z'),
        completedAt: new Date('2026-08-02T08:02:00.000Z'),
        conversationId: 'conversation-1',
      }),
      makeStoredRun({
        runId: 'failed-run',
        agentId: 'failed-agent',
        agentName: 'Continuity Review',
        status: 'failed',
        startedAt: new Date('2026-08-02T07:00:00.000Z'),
        completedAt: new Date('2026-08-02T07:01:00.000Z'),
      }),
      makeStoredRun({
        runId: 'canceled-run',
        agentId: 'canceled-agent',
        agentName: 'Daily Brief',
        status: 'failed',
        code: 'user_canceled',
        startedAt: new Date('2026-08-02T06:00:00.000Z'),
        completedAt: new Date('2026-08-02T06:01:00.000Z'),
      }),
    ];

    const activity = createActivityPresentation(makeInput({
      agents,
      runs,
      pendingInteractions: [makeInteraction()],
    }));

    expect(activity.items.map((item) => [item.id, item.state])).toEqual([
      ['run:needs-run', 'needs_you'],
      ['run:working-run', 'working'],
      ['run:completed-run', 'finished'],
      ['run:failed-run', 'problem'],
      ['run:canceled-run', 'finished'],
    ]);
    expect(activity.items[0]).toMatchObject({
      headline: { text: 'Weekly Report needs your choice' },
      outcomeSummary: { text: 'Choose the report destination.' },
    });
    expect(activity.items[2]).toMatchObject({
      conversationId: 'conversation-1',
      reviewReference: '/runs/completed-run/review',
    });
    expect(activity.items[2]).not.toHaveProperty('primaryOutput');
    expect(activity.items[4]).toMatchObject({
      headline: { text: 'Daily Brief was canceled' },
      outcomeSummary: { text: 'The run was canceled. No further work was allowed.' },
    });
    expect(JSON.stringify(activity)).not.toContain('mcp__notion__create_page');
  });

  it('uses explicit local identity even when an assistant definition is gone', () => {
    const activity = createActivityPresentation(makeInput({
      runs: [makeStoredRun({
        runId: 'retained-run',
        agentId: 'removed-agent',
        agentName: 'Retained History',
      })],
    }));

    expect(activity.items[0]?.assistant).toEqual({
      installationId: `${machineId}:removed-agent`,
      machineId,
      localAgentId: 'removed-agent',
      displayName: 'Retained History',
    });
  });

  it('does not apply an edited current output contract to stored run history', () => {
    const agent = makeAgent({
      id: 'historical-agent',
      name: 'Historical Assistant',
      schedule: undefined,
      output: {
        primary: {
          description: 'Newly edited private report',
          tool: 'Write',
          required: true,
        },
      },
    });
    const input = makeInput({
      agents: [agent],
      runs: [
        makeStoredRun({
          runId: 'completed-history',
          agentId: agent.id,
          agentName: agent.name,
          status: 'completed',
          summary: 'Prepared the earlier report.',
          completedAt: new Date('2026-08-02T09:00:00.000Z'),
        }),
        makeStoredRun({
          runId: 'failed-history',
          agentId: agent.id,
          agentName: agent.name,
          status: 'failed',
          code: 'output_contract_unmet',
          completedAt: new Date('2026-08-02T08:00:00.000Z'),
        }),
      ],
    });

    const today = createTodayPresentation(input);
    const activity = createActivityPresentation(input);

    expect(activity.items.find(({ id }) => id === 'run:completed-history'))
      .not.toHaveProperty('primaryOutput');
    expect(today.sections.flatMap(({ items }) => items).find(({ id }) => id === 'run:failed-history'))
      .toMatchObject({
        explanation: {
          text: 'The run stopped because the required output was not produced.',
          evidenceReferences: ['run.code'],
        },
      });
    expect(JSON.stringify({ today, activity })).not.toContain('Newly edited private report');
    expect(JSON.stringify({ today, activity })).not.toContain('agent.output.primary');
  });
});

describe('shared Today and Activity contract fixture', () => {
  it('matches the frozen cross-client consumer meaning', () => {
    const agents = [
      makeAgent({ id: 'needs-agent', name: 'Weekly Report', schedule: undefined }),
      makeAgent({
        id: 'working-agent',
        name: 'Release Summary',
        schedule: '0 12 * * *',
        timezone: 'UTC',
      }),
      makeAgent({
        id: 'complete-agent',
        name: 'Reading List',
        schedule: undefined,
        output: {
          primary: {
            description: 'Reading list',
            tool: 'mcp__notion__create_page',
            required: true,
          },
        },
      }),
      makeAgent({ id: 'problem-agent', name: 'Continuity Review', schedule: undefined }),
      makeAgent({
        id: 'upcoming-agent',
        name: 'Daily Brief',
        schedule: '0 11 * * *',
        timezone: 'UTC',
      }),
    ];
    const runs = [
      makeStoredRun({
        runId: 'needs-run',
        agentId: 'needs-agent',
        agentName: 'Weekly Report',
        status: 'failed',
        startedAt: new Date('2026-08-02T09:30:00.000Z'),
        completedAt: new Date('2026-08-02T09:31:00.000Z'),
      }),
      makeStoredRun({
        runId: 'working-run',
        agentId: 'working-agent',
        agentName: 'Release Summary',
        status: 'running',
        startedAt: new Date('2026-08-02T09:00:00.000Z'),
        completedAt: undefined,
      }),
      makeStoredRun({
        runId: 'completed-run',
        agentId: 'complete-agent',
        agentName: 'Reading List',
        status: 'completed',
        summary: 'Added 6 articles.',
        startedAt: new Date('2026-08-02T08:00:00.000Z'),
        completedAt: new Date('2026-08-02T08:02:00.000Z'),
      }),
      makeStoredRun({
        runId: 'problem-run',
        agentId: 'problem-agent',
        agentName: 'Continuity Review',
        status: 'failed',
        startedAt: new Date('2026-08-02T07:00:00.000Z'),
        completedAt: new Date('2026-08-02T07:01:00.000Z'),
      }),
    ];
    const input = makeInput({
      agents,
      runs,
      pendingInteractions: [makeInteraction()],
    });
    const fixture = JSON.parse(readFileSync(resolve(
      '..',
      'docs/v2/fixtures/today-activity-local.json',
    ), 'utf8')) as unknown;

    expect({
      today: createTodayPresentation(input),
      activity: createActivityPresentation(input),
    }).toEqual(fixture);
  });
});
