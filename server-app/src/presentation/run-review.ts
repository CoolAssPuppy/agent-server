import { basename } from 'node:path';
import type { PendingInteraction } from '../interaction/store.js';
import type { StoredRun } from '../reporting/store.js';
import {
  RunReviewSchema,
  type HumanTimelineEntry,
  type PresentationStatement,
  type RunReview,
  type RunReviewWaiting,
} from './models.js';

type RequiredOutput = {
  label: string;
};

export type CreateRunReviewInput = {
  run: StoredRun;
  requiredOutput?: RequiredOutput;
  observedAccomplishments?: PresentationStatement[];
  pendingInteraction?: PendingInteraction;
  now?: Date;
};

type ReviewMeaning = Pick<
  RunReview,
  'outcome' | 'headline' | 'summary' | 'problems' | 'suggestions' | 'operationalCompleteness'
>;

function statement(text: string, ...evidenceReferences: string[]): PresentationStatement {
  return { text, evidenceReferences };
}

function safeFileLabel(path: string): string {
  const label = basename(path.trim());
  return label || 'a local file';
}

function currentPendingInteraction(
  run: StoredRun,
  interaction: PendingInteraction | undefined,
  now: Date,
): PendingInteraction | undefined {
  if (
    run.status !== 'running'
    || interaction?.status !== 'pending'
    || interaction.runId !== run.runId
    || interaction.agentId !== run.agentId
    || interaction.expiresAt <= now
  ) {
    return undefined;
  }
  return interaction;
}

function waitingActionLabel(interaction: PendingInteraction): string {
  if ((interaction.request.options?.length ?? 0) > 0) return 'Choose';
  if (interaction.request.freeText) return 'Answer';
  return 'Review';
}

function waitingPresentation(interaction: PendingInteraction): RunReviewWaiting {
  return {
    waitingFor: statement(
      interaction.request.message,
      'interaction.request.message',
    ),
    reason: statement(
      'The assistant needs your response before it can continue.',
      'interaction.status',
      'interaction.runId',
    ),
    userAction: {
      kind: 'respond',
      label: waitingActionLabel(interaction),
      targetReference: `interaction:${interaction.id}`,
    },
    expiresAt: interaction.expiresAt.toISOString(),
  };
}

function completedMeaning(
  run: StoredRun,
  requiredOutput: RequiredOutput | undefined,
): ReviewMeaning {
  return {
    outcome: 'succeeded',
    headline: statement(`${run.agentName} finished`, 'run.status'),
    summary: run.summary
      ? statement(run.summary, 'run.summary')
      : statement(
        'The run finished, but it did not provide a summary.',
        'run.status',
        'run.summary',
      ),
    problems: [],
    suggestions: [],
    operationalCompleteness: requiredOutput ? 'complete' : 'not_assessed',
  };
}

function failedMeaning(
  run: StoredRun,
  requiredOutput: RequiredOutput | undefined,
): ReviewMeaning {
  if (run.code === 'user_canceled' || run.code === 'run_canceled') {
    return {
      outcome: 'canceled',
      headline: statement(`${run.agentName} was canceled`, 'run.code'),
      summary: statement(
        'The run was canceled. No further work was allowed.',
        'run.code',
      ),
      problems: [],
      suggestions: [],
      operationalCompleteness: requiredOutput ? 'incomplete' : 'not_assessed',
    };
  }

  if (run.code === 'output_contract_unmet') {
    const label = requiredOutput?.label ?? 'output';
    return {
      outcome: 'partial',
      headline: statement(`${run.agentName} did not finish`, 'run.status', 'run.code'),
      summary: statement(
        `The run stopped because the required ${label} was not produced.`,
        'run.code',
        ...(requiredOutput ? ['agent.output.primary'] : []),
      ),
      problems: [statement(
        `The required ${label} was not produced.`,
        'run.code',
        ...(requiredOutput ? ['agent.output.primary'] : []),
      )],
      suggestions: [statement('Review the output settings before retrying.', 'run.code')],
      operationalCompleteness: 'incomplete',
    };
  }

  if (run.error && /\b(?:spawn\s+\S+\s+enoent|executable not found)\b/i.test(run.error)) {
    return {
      outcome: 'failed',
      headline: statement(`${run.agentName} could not start`, 'run.status', 'run.error'),
      summary: statement(
        'The AI engine could not start. Check that it is installed and signed in.',
        'run.error',
      ),
      problems: [statement('The AI engine is unavailable.', 'run.error')],
      suggestions: [statement('Open Connections to check the AI engine.', 'run.error')],
      operationalCompleteness: requiredOutput ? 'incomplete' : 'not_assessed',
    };
  }

  return {
    outcome: 'failed',
    headline: statement(`${run.agentName} needs attention`, 'run.status'),
    summary: statement('The run stopped before it finished.', 'run.status'),
    problems: [statement('This run needs attention.', 'run.status')],
    suggestions: [statement('Review the problem before retrying.', 'run.status')],
    operationalCompleteness: requiredOutput ? 'incomplete' : 'not_assessed',
  };
}

function skippedMeaning(run: StoredRun): ReviewMeaning {
  const summary = run.code === 'lock_contention'
    ? 'Another run was already in progress. Nothing changed.'
    : run.code === 'already_completed_today'
      ? 'This assistant had already finished today. Nothing changed.'
      : 'The run was skipped. Nothing changed.';

  return {
    outcome: 'skipped',
    headline: statement(`${run.agentName} did not run`, 'run.status', 'run.code'),
    summary: statement(summary, 'run.code'),
    problems: [],
    suggestions: [],
    operationalCompleteness: 'not_assessed',
  };
}

function meaningFor(
  run: StoredRun,
  requiredOutput: RequiredOutput | undefined,
  pendingInteraction: PendingInteraction | undefined,
): ReviewMeaning {
  if (run.status === 'completed') return completedMeaning(run, requiredOutput);
  if (run.status === 'failed') return failedMeaning(run, requiredOutput);
  if (run.status === 'skipped') return skippedMeaning(run);
  if (run.status === 'running') {
    if (pendingInteraction) {
      return {
        outcome: 'waiting',
        headline: statement(
          `${run.agentName} is waiting for your response`,
          'interaction.status',
          'interaction.request',
        ),
        summary: statement(
          'The assistant needs your response before it can continue.',
          'interaction.status',
          'interaction.runId',
        ),
        problems: [],
        suggestions: [],
        operationalCompleteness: 'not_assessed',
      };
    }
    return {
      outcome: 'working',
      headline: statement(`${run.agentName} is working`, 'run.status'),
      summary: statement('Work is in progress.', 'run.status'),
      problems: [],
      suggestions: [],
      operationalCompleteness: 'not_assessed',
    };
  }

  return {
    outcome: 'unknown',
    headline: statement(`${run.agentName} has an unknown outcome`, 'run.status'),
    summary: statement('The recorded run state is not recognized.', 'run.status'),
    problems: [statement('The run state could not be interpreted.', 'run.status')],
    suggestions: [statement('Open Technical details for the recorded state.', 'run.status')],
    operationalCompleteness: 'not_assessed',
  };
}

function timelineFor(
  run: StoredRun,
  outcome: RunReview['outcome'],
  pendingInteraction: PendingInteraction | undefined,
): HumanTimelineEntry[] {
  const terminalTimestamp = (run.completedAt ?? run.startedAt).toISOString();
  const entries: HumanTimelineEntry[] = [{
    kind: 'started',
    label: statement('Started', 'run.startedAt'),
    occurredAt: run.startedAt.toISOString(),
  }];

  run.filesRead.forEach((path, index) => entries.push({
    kind: 'read',
    label: statement(`Read ${safeFileLabel(path)}`, `run.filesRead[${index}]`),
  }));
  run.filesWritten.forEach((path, index) => entries.push({
    kind: 'changed',
    label: statement(`Updated ${safeFileLabel(path)}`, `run.filesWritten[${index}]`),
  }));
  if (run.toolsUsed.length > 0) {
    entries.push({
      kind: 'connected',
      label: statement('Used a configured tool', 'run.toolsUsed'),
    });
  }

  if (pendingInteraction) {
    entries.push({
      kind: 'waiting',
      label: statement(
        'Waiting for your response',
        'interaction.status',
        'interaction.request',
      ),
      occurredAt: pendingInteraction.createdAt.toISOString(),
    });
  }

  if (run.status !== 'running') {
    const terminal = outcome === 'canceled'
      ? { kind: 'finished' as const, label: statement('Canceled', 'run.code') }
      : outcome === 'failed' || outcome === 'partial'
        ? { kind: 'problem' as const, label: statement('Stopped with a problem', 'run.status') }
        : { kind: 'finished' as const, label: statement('Finished', 'run.status') };
    entries.push({
      ...terminal,
      occurredAt: terminalTimestamp,
    });
  }
  return entries;
}

/** Translate durable local run evidence into a consumer-facing review. */
export function createRunReview(input: CreateRunReviewInput): RunReview {
  const { run, requiredOutput } = input;
  const pendingInteraction = currentPendingInteraction(
    run,
    input.pendingInteraction,
    input.now ?? new Date(),
  );
  const meaning = meaningFor(run, requiredOutput, pendingInteraction);
  const changes = run.filesWritten.map((path, index) => statement(
    `Updated ${safeFileLabel(path)}`,
    `run.filesWritten[${index}]`,
  ));
  const outputs = requiredOutput && run.status === 'completed'
    ? [statement(
      `${requiredOutput.label} is ready`,
      'agent.output.primary',
      'run.status',
    )]
    : [];

  return RunReviewSchema.parse({
    ...meaning,
    accomplishments: input.observedAccomplishments ?? [],
    changes,
    outputs,
    timeline: timelineFor(run, meaning.outcome, pendingInteraction),
    ...(pendingInteraction ? { waiting: waitingPresentation(pendingInteraction) } : {}),
    technicalDetailsReference: `/runs/${encodeURIComponent(run.runId)}`,
  });
}
