import type { AgentConfig } from '../agents/config.js';
import { getNextRun } from '../agents/scheduler.js';
import type { PendingInteraction } from '../interaction/store.js';
import type { StoredRun } from '../reporting/store.js';
import type {
  ReadinessCheck,
  ReadinessPresentation,
} from './assistant-home-models.js';
import {
  ActivityPresentationSchema,
  TodayPresentationSchema,
  type ActivityItem,
  type ActivityPresentation,
  type AssistantPresentationIdentity,
  type PresentationAction,
  type PresentationStatement,
  type TodayItem,
  type TodayPresentation,
  type TodaySection,
} from './models.js';
import { createRunReview } from './run-review.js';

export type TodayActivityInput = {
  machineId: string;
  agents: readonly AgentConfig[];
  runs: readonly StoredRun[];
  pendingInteractions: readonly PendingInteraction[];
  now: Date;
  recentSince: Date;
  upcomingUntil: Date;
  readinessByAgent?: ReadonlyMap<string, ReadinessPresentation>;
};

type AgentLookup = ReadonlyMap<string, AgentConfig>;
type InteractionLookup = ReadonlyMap<string, PendingInteraction>;

const TODAY_SECTION_ORDER: readonly TodayItem['section'][] = [
  'needs_you',
  'working',
  'finished',
  'problems',
  'upcoming',
];

function statement(text: string, ...evidenceReferences: string[]): PresentationStatement {
  return { text, evidenceReferences };
}

function agentLookup(agents: readonly AgentConfig[]): AgentLookup {
  return new Map(agents.map((agent) => [agent.id, agent]));
}

function currentInteractionLookup(
  interactions: readonly PendingInteraction[],
  now: Date,
): InteractionLookup {
  const byRun = new Map<string, PendingInteraction>();
  [...interactions]
    .filter((interaction) => interaction.status === 'pending' && interaction.expiresAt > now)
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    .forEach((interaction) => byRun.set(interaction.runId, interaction));
  return byRun;
}

function assistantIdentity(
  machineId: string,
  agentId: string,
  fallbackName: string,
  agents: AgentLookup,
): AssistantPresentationIdentity {
  return {
    installationId: `${machineId}:${agentId}`,
    machineId,
    localAgentId: agentId,
    displayName: agents.get(agentId)?.name ?? fallbackName,
  };
}

function interactionMeaning(interaction: PendingInteraction): {
  headlineSuffix: string;
  actionLabel: string;
} {
  if ((interaction.request.options?.length ?? 0) > 0) {
    return { headlineSuffix: 'needs your choice', actionLabel: 'Choose' };
  }
  if (interaction.request.freeText) {
    return { headlineSuffix: 'needs your answer', actionLabel: 'Answer' };
  }
  return { headlineSuffix: 'needs your review', actionLabel: 'Review' };
}

function interactionTodayItem(
  input: TodayActivityInput,
  interaction: PendingInteraction,
  agents: AgentLookup,
  run?: StoredRun,
): TodayItem {
  const assistant = assistantIdentity(
    input.machineId,
    interaction.agentId,
    run?.agentName ?? interaction.agentId,
    agents,
  );
  const meaning = interactionMeaning(interaction);

  return {
    id: `run:${interaction.runId}`,
    section: 'needs_you',
    assistant,
    headline: statement(
      `${assistant.displayName} ${meaning.headlineSuffix}`,
      'interaction.request',
      'interaction.agentId',
    ),
    explanation: statement(
      interaction.request.message,
      'interaction.request.message',
    ),
    occurredAt: interaction.createdAt.toISOString(),
    expiresAt: interaction.expiresAt.toISOString(),
    primaryAction: {
      kind: 'respond',
      label: meaning.actionLabel,
      targetReference: `interaction:${interaction.id}`,
    },
    secondaryDisclosure: run ? {
      kind: 'view_activity',
      label: 'View activity',
      targetReference: `run:${run.runId}`,
    } : undefined,
    sourceReferences: ['interaction.id', 'interaction.runId', 'interaction.request'],
  };
}

function requiredOutput(agent: AgentConfig | undefined): { label: string } | undefined {
  const primary = agent?.output?.primary;
  return primary?.required === true ? { label: primary.description } : undefined;
}

function actionForRun(run: StoredRun, section: TodayItem['section']): PresentationAction {
  if (section === 'working') {
    return {
      kind: 'view_activity',
      label: 'View activity',
      targetReference: `run:${run.runId}`,
    };
  }
  return {
    kind: 'review',
    label: section === 'problems' ? 'Review problem' : 'Review result',
    targetReference: `run:${run.runId}`,
  };
}

function terminalSection(run: StoredRun): 'finished' | 'problems' {
  if (run.status === 'completed') return 'finished';
  if (run.status === 'skipped' && run.code === 'already_completed_today') return 'finished';
  if (run.status === 'failed' && (run.code === 'user_canceled' || run.code === 'run_canceled')) {
    return 'finished';
  }
  return 'problems';
}

function runTodayItem(
  input: TodayActivityInput,
  run: StoredRun,
  agents: AgentLookup,
): TodayItem | undefined {
  const agent = agents.get(run.agentId);
  const review = createRunReview({ run, requiredOutput: requiredOutput(agent) });
  const assistant = assistantIdentity(input.machineId, run.agentId, run.agentName, agents);
  if (run.status === 'running') {
    return {
      id: `run:${run.runId}`,
      section: 'working',
      assistant,
      headline: review.headline,
      explanation: review.summary,
      occurredAt: run.startedAt.toISOString(),
      primaryAction: actionForRun(run, 'working'),
      sourceReferences: ['run.runId', 'run.status', 'run.startedAt'],
    };
  }

  const occurredAt = run.completedAt ?? run.startedAt;
  if (occurredAt < input.recentSince || occurredAt > input.now) return undefined;
  const section = terminalSection(run);
  return {
    id: `run:${run.runId}`,
    section,
    assistant,
    headline: review.headline,
    explanation: review.summary,
    occurredAt: occurredAt.toISOString(),
    primaryAction: actionForRun(run, section),
    sourceReferences: ['run.runId', 'run.status', 'run.startedAt'],
  };
}

function scheduledTodayItem(
  input: TodayActivityInput,
  agent: AgentConfig,
): TodayItem | undefined {
  if (!agent.enabled || !agent.schedule) return undefined;
  let scheduledAt: Date | undefined;
  try {
    scheduledAt = getNextRun(agent, input.now);
  } catch {
    return undefined;
  }
  if (!scheduledAt || scheduledAt > input.upcomingUntil) return undefined;

  return {
    id: `schedule:${agent.id}`,
    section: 'upcoming',
    assistant: assistantIdentity(input.machineId, agent.id, agent.name, new Map([[agent.id, agent]])),
    headline: statement(`${agent.name} runs next`, 'agent.name', 'agent.schedule'),
    explanation: statement('Scheduled to run next.', 'agent.schedule'),
    scheduledAt: scheduledAt.toISOString(),
    primaryAction: {
      kind: 'view_assistant',
      label: 'View assistant',
      targetReference: `assistant:${agent.id}`,
    },
    sourceReferences: ['agent.id', 'agent.schedule'],
  };
}

const READINESS_ATTENTION_PRIORITY: readonly ReadinessCheck['kind'][] = [
  'connection',
  'file',
  'schedule',
  'permission',
];

function readinessBlocker(
  readiness: ReadinessPresentation | undefined,
): ReadinessCheck | undefined {
  if (!readiness) return undefined;
  for (const kind of READINESS_ATTENTION_PRIORITY) {
    const blocker = readiness.checks.find((check) => (
      check.kind === kind && (check.state === 'action_required' || check.state === 'fail')
    ));
    if (blocker) return blocker;
  }
  return undefined;
}

function readinessTodayItem(
  input: TodayActivityInput,
  agent: AgentConfig,
  agents: AgentLookup,
): TodayItem | undefined {
  const blocker = readinessBlocker(input.readinessByAgent?.get(agent.id));
  if (!blocker) return undefined;

  return {
    id: `readiness:${agent.id}`,
    section: 'needs_you',
    assistant: assistantIdentity(input.machineId, agent.id, agent.name, agents),
    headline: statement(`${agent.name} needs setup`, 'assistant.readiness'),
    explanation: blocker.explanation,
    primaryAction: {
      kind: 'view_assistant',
      label: 'Review assistant',
      targetReference: `assistant:${agent.id}`,
    },
    sourceReferences: ['assistant.readiness', blocker.evidenceSource],
  };
}

function todaySortTime(item: TodayItem): number {
  const timestamp = item.expiresAt ?? item.scheduledAt ?? item.occurredAt;
  return timestamp ? Date.parse(timestamp) : 0;
}

function sortTodayItems(items: readonly TodayItem[], section: TodayItem['section']): TodayItem[] {
  const ascending = section === 'needs_you' || section === 'upcoming';
  return [...items].sort((left, right) => {
    const difference = todaySortTime(left) - todaySortTime(right);
    if (difference !== 0) return ascending ? difference : -difference;
    return left.id.localeCompare(right.id);
  });
}

function todaySections(items: readonly TodayItem[]): TodaySection[] {
  return TODAY_SECTION_ORDER.flatMap((kind) => {
    const sectionItems = sortTodayItems(
      items.filter((item) => item.section === kind),
      kind,
    );
    return sectionItems.length > 0 ? [{ kind, items: sectionItems }] : [];
  });
}

/** Build a machine-local Today surface without writing or resolving source state. */
export function createTodayPresentation(input: TodayActivityInput): TodayPresentation {
  const agents = agentLookup(input.agents);
  const interactions = currentInteractionLookup(input.pendingInteractions, input.now);
  const items: TodayItem[] = [];
  const representedInteractionRuns = new Set<string>();

  [...input.runs]
    .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime())
    .forEach((run) => {
      const interaction = interactions.get(run.runId);
      if (interaction) {
        items.push(interactionTodayItem(input, interaction, agents, run));
        representedInteractionRuns.add(run.runId);
        return;
      }
      const item = runTodayItem(input, run, agents);
      if (item) items.push(item);
    });

  interactions.forEach((interaction, runId) => {
    if (!representedInteractionRuns.has(runId)) {
      items.push(interactionTodayItem(input, interaction, agents));
    }
  });

  const workingAgentIds = new Set(
    input.runs.filter((run) => run.status === 'running').map((run) => run.agentId),
  );
  const attentionAgentIds = new Set(
    [...interactions.values()].map((interaction) => interaction.agentId),
  );
  input.agents.forEach((agent) => {
    if (workingAgentIds.has(agent.id) || attentionAgentIds.has(agent.id)) return;
    const item = readinessTodayItem(input, agent, agents);
    if (!item) return;
    items.push(item);
    attentionAgentIds.add(agent.id);
  });
  input.agents.forEach((agent) => {
    if (workingAgentIds.has(agent.id) || attentionAgentIds.has(agent.id)) return;
    const item = scheduledTodayItem(input, agent);
    if (item) items.push(item);
  });

  const sections = todaySections(items);
  const hasAttention = sections.some(
    (section) => section.kind === 'needs_you' || section.kind === 'problems',
  );
  return TodayPresentationSchema.parse({
    sections,
    ...(!hasAttention ? {
      allClear: statement(
        'Nothing needs your attention right now.',
        'today.sections',
      ),
    } : {}),
  });
}

function activityState(
  run: StoredRun,
  interaction: PendingInteraction | undefined,
): ActivityItem['state'] {
  if (interaction) return 'needs_you';
  if (run.status === 'running') return 'working';
  if (run.status === 'completed') return 'finished';
  if (run.status === 'skipped' && run.code === 'already_completed_today') return 'finished';
  if (run.status === 'failed' && (run.code === 'user_canceled' || run.code === 'run_canceled')) {
    return 'finished';
  }
  return 'problem';
}

function runActivityItem(
  input: TodayActivityInput,
  run: StoredRun,
  agents: AgentLookup,
  interaction?: PendingInteraction,
): ActivityItem {
  const agent = agents.get(run.agentId);
  const review = createRunReview({ run, requiredOutput: requiredOutput(agent) });
  const assistant = assistantIdentity(input.machineId, run.agentId, run.agentName, agents);
  const interactionPresentation = interaction
    ? interactionTodayItem(input, interaction, agents, run)
    : undefined;

  return {
    id: `run:${run.runId}`,
    assistant,
    ...(run.conversationId ? { conversationId: run.conversationId } : {}),
    state: activityState(run, interaction),
    headline: interactionPresentation?.headline ?? review.headline,
    outcomeSummary: interactionPresentation?.explanation ?? review.summary,
    startedAt: run.startedAt.toISOString(),
    ...(run.completedAt ? { endedAt: run.completedAt.toISOString() } : {}),
    ...(review.outputs[0] ? { primaryOutput: review.outputs[0] } : {}),
    reviewReference: `/runs/${encodeURIComponent(run.runId)}/review`,
    sourceReferences: ['run.runId', 'run.status', 'run.startedAt'],
  };
}

function orphanInteractionActivityItem(
  input: TodayActivityInput,
  interaction: PendingInteraction,
  agents: AgentLookup,
): ActivityItem {
  const todayItem = interactionTodayItem(input, interaction, agents);
  return {
    id: `run:${interaction.runId}`,
    assistant: todayItem.assistant,
    state: 'needs_you',
    headline: todayItem.headline,
    outcomeSummary: todayItem.explanation,
    startedAt: interaction.createdAt.toISOString(),
    reviewReference: `/runs/${encodeURIComponent(interaction.runId)}/review`,
    sourceReferences: ['interaction.id', 'interaction.runId', 'interaction.createdAt'],
  };
}

/** Build a machine-local, outcome-led Activity feed with one item per run. */
export function createActivityPresentation(input: TodayActivityInput): ActivityPresentation {
  const agents = agentLookup(input.agents);
  const interactions = currentInteractionLookup(input.pendingInteractions, input.now);
  const representedRunIds = new Set<string>();
  const items = [...input.runs].map((run) => {
    representedRunIds.add(run.runId);
    return runActivityItem(input, run, agents, interactions.get(run.runId));
  });
  interactions.forEach((interaction, runId) => {
    if (!representedRunIds.has(runId)) {
      items.push(orphanInteractionActivityItem(input, interaction, agents));
    }
  });
  items.sort((left, right) => {
    const timeDifference = Date.parse(right.startedAt) - Date.parse(left.startedAt);
    return timeDifference || left.id.localeCompare(right.id);
  });
  return ActivityPresentationSchema.parse({ items });
}
