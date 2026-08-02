import { getNextRun } from '../agents/scheduler.js';
import {
  AssistantHomePresentationSchema,
  type AssistantAttention,
  type AssistantHealth,
  type AssistantHomeAction,
  type AssistantHomeInput,
  type AssistantHomePresentation,
  type AssistantSchedule,
  type ReadinessPresentation,
  type RecentOutcome,
} from './assistant-home-models.js';
import { createPermissionStatements } from './assistant-permissions.js';
import { evidenceStatement } from './assistant-presentation-support.js';
import { createReadinessPresentation } from './assistant-readiness-presentation.js';
import { createRunReview } from './run-review.js';

export {
  AssistantHealthSchema,
  AssistantHomeActionSchema,
  AssistantHomePresentationSchema,
  PermissionStatementSchema,
  ReadinessCheckSchema,
  ReadinessPresentationSchema,
} from './assistant-home-models.js';
export type {
  AssistantConnectionFact,
  AssistantHealth,
  AssistantHomeAction,
  AssistantHomeFacts,
  AssistantHomeInput,
  AssistantHomePresentation,
  AssistantPathFact,
  PermissionStatement,
  ReadinessCheck,
  ReadinessPresentation,
} from './assistant-home-models.js';

function createSchedule(input: AssistantHomeInput): AssistantSchedule {
  if (input.agent.schedule) {
    let nextRunAt: string | undefined;
    try {
      nextRunAt = getNextRun(input.agent, input.now)?.toISOString();
    } catch {
      // Readiness carries the invalid schedule and repair action.
    }
    return {
      kind: 'scheduled',
      summary: evidenceStatement(
        'Runs automatically on its saved schedule.',
        'agent.schedule',
        'agent.timezone',
      ),
      ...(nextRunAt ? { nextRunAt } : {}),
    };
  }
  if ((input.agent.watch?.length ?? 0) > 0) {
    return {
      kind: 'watching',
      summary: evidenceStatement('Runs when its watched files change.', 'agent.watch'),
    };
  }
  return {
    kind: 'on_demand',
    summary: evidenceStatement('Runs when you ask.', 'agent.schedule', 'agent.watch'),
  };
}

function currentAttention(input: AssistantHomeInput): AssistantAttention | undefined {
  const interaction = input.pendingInteractions
    .filter((candidate) => (
      candidate.agentId === input.agent.id
      && candidate.status === 'pending'
      && candidate.expiresAt > input.now
    ))
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0];
  if (!interaction) return undefined;
  const hasOptions = (interaction.request.options?.length ?? 0) > 0;
  return {
    summary: evidenceStatement(interaction.request.message, 'interaction.request.message'),
    action: {
      kind: 'resolve_attention',
      label: hasOptions ? 'Choose' : interaction.request.freeText ? 'Answer' : 'Review',
      targetReference: `interaction:${interaction.id}`,
    },
    expiresAt: interaction.expiresAt.toISOString(),
  };
}

function recentOutcomes(input: AssistantHomeInput): RecentOutcome[] {
  return [...input.runs]
    .filter((run) => run.agentId === input.agent.id)
    .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime())
    .slice(0, 5)
    .map((run) => {
      const review = createRunReview({ run });
      return {
        runId: run.runId,
        outcome: review.outcome,
        headline: review.headline,
        occurredAt: (run.completedAt ?? run.startedAt).toISOString(),
        reviewReference: `/runs/${run.runId}/review`,
      };
    });
}

function createHealth(input: AssistantHomeInput, readiness: ReadinessPresentation): AssistantHealth {
  const isWorking = input.runs.some((run) => (
    run.agentId === input.agent.id && run.status === 'running'
  ));
  if (isWorking) {
    return {
      state: 'working',
      summary: evidenceStatement('Working now.', 'run.status'),
      reasonReferences: ['run.status'],
    };
  }
  if (readiness.state === 'blocked' || readiness.state === 'needs_setup') {
    return {
      state: 'needs_attention',
      summary: evidenceStatement(readiness.summary.text, 'readiness.state'),
      reasonReferences: ['readiness.state'],
    };
  }
  if (!input.agent.enabled) {
    return {
      state: 'paused',
      summary: evidenceStatement('Paused.', 'agent.enabled'),
      reasonReferences: ['agent.enabled'],
    };
  }
  if (readiness.state !== 'ready') {
    return {
      state: 'needs_attention',
      summary: evidenceStatement(readiness.summary.text, 'readiness.state'),
      reasonReferences: ['readiness.state'],
    };
  }
  return {
    state: 'healthy',
    summary: evidenceStatement('Ready and available.', 'agent.enabled', 'readiness.state'),
    reasonReferences: ['agent.enabled', 'readiness.state'],
  };
}

function primaryAction(
  input: AssistantHomeInput,
  readiness: ReadinessPresentation,
  attention: AssistantAttention | undefined,
): AssistantHomeAction {
  if (attention) return attention.action;
  const active = input.runs.find((run) => (
    run.agentId === input.agent.id && run.status === 'running'
  ));
  if (active) {
    return { kind: 'view_activity', label: 'View activity', targetReference: `run:${active.runId}` };
  }
  if (!input.agent.enabled || readiness.state !== 'ready') {
    return {
      kind: 'edit',
      label: input.agent.enabled ? 'Finish setup' : 'Review assistant',
      targetReference: `assistant:${input.agent.id}:edit`,
    };
  }
  return { kind: 'run', label: 'Run now', targetReference: `assistant:${input.agent.id}` };
}

function secondaryActions(input: AssistantHomeInput): AssistantHomeAction[] {
  return [
    ...(input.facts.canEnforceSafeTest ? [{
      kind: 'safe_test' as const,
      label: 'Run safe test',
      targetReference: `assistant:${input.agent.id}:safe-test`,
    }] : []),
    ...(input.agent.enabled ? [{
      kind: 'pause' as const,
      label: 'Pause',
      targetReference: `assistant:${input.agent.id}:pause`,
    }] : []),
    { kind: 'edit', label: 'Edit', targetReference: `assistant:${input.agent.id}:edit` },
    { kind: 'advanced', label: 'Advanced details', targetReference: `/agents/${input.agent.id}` },
  ];
}

/** Build one read-only, evidence-backed consumer projection for a local assistant. */
export function createAssistantHomePresentation(input: AssistantHomeInput): AssistantHomePresentation {
  const readiness = createReadinessPresentation(input);
  const attention = currentAttention(input);
  const output = input.agent.output?.primary;
  return AssistantHomePresentationSchema.parse({
    assistant: {
      installationId: `${input.machineId}:${input.agent.id}`,
      machineId: input.machineId,
      localAgentId: input.agent.id,
      displayName: input.agent.name,
    },
    purpose: evidenceStatement(
      input.agent.description?.trim() || 'No description has been added yet.',
      input.agent.description?.trim() ? 'agent.description' : 'agent.description.missing',
    ),
    health: createHealth(input, readiness),
    readiness,
    schedule: createSchedule(input),
    permissions: createPermissionStatements(input.agent),
    connections: input.facts.connections.map((connection) => ({
      id: connection.id,
      label: connection.label,
      state: connection.status,
      explanation: evidenceStatement(
        connection.status === 'ready' ? `${connection.label} is ready.`
          : connection.status === 'needs_setup' ? `${connection.label} needs setup.`
            : connection.status === 'unavailable' ? `${connection.label} is unavailable.`
              : `${connection.label} could not be checked.`,
        connection.sourceReference,
      ),
    })),
    ...(output ? {
      destination: evidenceStatement(
        `Results go to ${output.description}.`,
        'agent.output.primary.description',
      ),
    } : {}),
    recentOutcomes: recentOutcomes(input),
    ...(attention ? { attention } : {}),
    primaryAction: primaryAction(input, readiness, attention),
    secondaryActions: secondaryActions(input),
    advancedReference: `/agents/${input.agent.id}`,
  });
}
