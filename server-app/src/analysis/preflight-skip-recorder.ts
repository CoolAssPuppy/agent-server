import { randomUUID } from 'crypto';
import type { AgentConfig } from '../agents/config.js';
import type { RunStoreLike } from '../reporting/store.js';
import type { RunPreflightOutcome, RunTriggerSource } from './run-preflight.js';

type DeniedOutcome = Extract<RunPreflightOutcome, { allowed: false }>;
type AutomaticSource = Exclude<RunTriggerSource, 'manual' | 'safe_test'>;

const SOURCE_LABELS: Record<AutomaticSource, string> = {
  schedule: 'Scheduled',
  watcher: 'Watched-file',
  chain: 'Chained',
  interaction: 'Interaction',
  panel: 'Panel',
  channel: 'Message',
};

export class PreflightSkipRecorder {
  private readonly lastDenial = new Map<string, string>();

  constructor(
    private readonly store: RunStoreLike,
    private readonly options: {
      createRunId?: () => string;
      now?: () => Date;
    } = {},
  ) {}

  record(agent: AgentConfig, outcome: DeniedOutcome, source: AutomaticSource): string | undefined {
    const denialKey = `${outcome.contentHash}:${outcome.code}`;
    if (this.lastDenial.get(agent.id) === denialKey) return undefined;
    this.lastDenial.set(agent.id, denialKey);
    if (this.lastDenial.size > 500) {
      const oldest = this.lastDenial.keys().next().value;
      if (oldest) this.lastDenial.delete(oldest);
    }

    const runId = (this.options.createRunId ?? randomUUID)();
    const now = (this.options.now ?? (() => new Date()))();
    this.store.add({
      runId,
      agentId: agent.id,
      agentName: agent.name,
      status: 'skipped',
      code: `security_preflight_${outcome.code}`,
      startedAt: now,
      completedAt: now,
      summary: `${SOURCE_LABELS[source]} run skipped pending security review`,
      error: outcome.message,
      turnCount: 0,
      toolsUsed: [],
      filesRead: [],
      filesWritten: [],
      commandsRun: [],
      progressMessages: ['Security review required before automatic run.'],
      mode: 'normal',
    });
    return runId;
  }

  clear(agentId: string): void {
    this.lastDenial.delete(agentId);
  }
}
