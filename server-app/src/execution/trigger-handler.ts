import type { EventEmitter } from 'events';
import type { AgentConfig } from '../agents/config.js';
import { discoverAgents } from '../agents/discovery.js';
import type { RunResult } from './runner.js';
import type { RunTriggerEvent } from '../reporting/realtime-client.js';
import { canRunFromInbound } from './inbound-policy.js';
import { toErrorMessage } from '../util/errors.js';

export type TriggerKind = 'manual' | 'inbound';

export type InvokeRunOptions = {
  agent: AgentConfig;
  trigger: TriggerKind;
  promptSuffix?: string;
  onRunStart: (runId: string) => Promise<void> | void;
};

export type InvokeRun = (options: InvokeRunOptions) => Promise<RunResult>;

type TriggerHandlerOptions = {
  agentsDir: string;
  panelUrl: string;
  panelApiKey: string;
  sseEvents: EventEmitter;
  invokeRun: InvokeRun;
  fetch?: typeof globalThis.fetch;
  /** Reported when claiming, so Panel records which device took the trigger. */
  machineId?: string;
};

type TerminalStatus = 'completed' | 'failed' | 'canceled';

/** Field order for a rendered inbound trigger. Anything else follows, sorted. */
const INBOUND_FIELD_ORDER = [
  'source',
  'event_type',
  'subject_kind',
  'subject_id',
  'subject_title',
  'subject_url',
  'actor',
  'assignee',
  'occurred_at',
  'excerpt',
];

function labelFor(key: string): string {
  return key.replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase());
}

/**
 * An inbound trigger arrives as a small object of scalars. Rendering it as
 * labeled lines rather than JSON spends the prompt budget on the values instead
 * of on braces and quotes, and reads better inside the untrusted-context
 * wrapper the runner puts around it.
 */
function renderInboundInput(input: Record<string, unknown>): string {
  const keys = Object.keys(input).filter((key) => key !== 'trigger');
  const ordered = [
    ...INBOUND_FIELD_ORDER.filter((key) => keys.includes(key)),
    ...keys.filter((key) => !INBOUND_FIELD_ORDER.includes(key)).sort(),
  ];

  return ordered
    .filter((key) => input[key] !== null && input[key] !== undefined && input[key] !== '')
    .map((key) => `${labelFor(key)}: ${String(input[key])}`)
    .join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Which provider raised an inbound trigger. An input that does not say is
 * reported as `unknown`, which no write policy covers, so the refusal in
 * `inbound-policy.ts` declines it rather than guessing at a safe answer.
 */
function inboundSourceOf(input: unknown): string {
  if (isRecord(input) && typeof input.source === 'string' && input.source.length > 0) {
    return input.source;
  }
  return 'unknown';
}

function coercePromptSuffix(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input === 'string') return input;
  if (isRecord(input) && input.trigger === 'inbound') {
    const rendered = renderInboundInput(input);
    return rendered.length > 0 ? rendered : undefined;
  }
  try {
    return JSON.stringify(input);
  } catch {
    return undefined;
  }
}

function resultToTerminal(result: RunResult): { status: TerminalStatus; error_message?: string } {
  if (result.status === 'completed') {
    return { status: 'completed' };
  }
  if (result.status === 'failed') {
    return {
      status: 'failed',
      error_message: result.error ?? 'run failed without an error message',
    };
  }
  return {
    status: 'failed',
    error_message: 'run skipped because the agent was already running',
  };
}

export class TriggerHandler {
  private readonly options: TriggerHandlerOptions;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly listener: (event: RunTriggerEvent) => void;
  private started = false;
  private stopped = false;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(options: TriggerHandlerOptions) {
    this.options = options;
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.listener = (event) => {
      if (this.stopped) return;
      const task = this.handleEvent(event).catch((err) => {
        const message = toErrorMessage(err);
        console.error(`[trigger-handler] Unhandled error: ${message}`);
      });
      this.inFlight.add(task);
      void task.finally(() => this.inFlight.delete(task));
    };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.options.sseEvents.on('run_trigger', this.listener);
  }

  stop(): void {
    this.stopped = true;
    this.options.sseEvents.off('run_trigger', this.listener);
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.inFlight]);
  }

  private async handleEvent(event: RunTriggerEvent): Promise<void> {
    // The acknowledgement is the claim. Panel decides it in one conditional
    // update, so losing here means another device is already running this and
    // there is nothing left to do.
    const claimed = await this.postAck(event.trigger_id);
    if (!claimed) return;

    const agent = await this.resolveAgent(event.task_slug);
    if (!agent) {
      await this.postComplete(event.trigger_id, {
        status: 'failed',
        error_message: 'task_slug not found',
      });
      return;
    }

    const kind: TriggerKind = event.trigger_kind === 'inbound' ? 'inbound' : 'manual';

    if (kind === 'inbound') {
      const source = inboundSourceOf(event.input);
      const verdict = canRunFromInbound(agent, source);
      if (!verdict.allowed) {
        console.warn(`[trigger-handler] Refused inbound run of ${agent.id}: ${verdict.reason}`);
        await this.postComplete(event.trigger_id, {
          status: 'failed',
          error_message: verdict.reason,
        });
        return;
      }
    }

    const triggerId = event.trigger_id;
    const promptSuffix = coercePromptSuffix(event.input);

    try {
      const result = await this.options.invokeRun({
        agent,
        trigger: kind,
        promptSuffix,
        onRunStart: async (runId) => {
          await this.postRunning(triggerId, runId);
        },
      });
      await this.postComplete(triggerId, resultToTerminal(result));
    } catch (err) {
      const message = toErrorMessage(err);
      console.error(`[trigger-handler] invokeRun threw: ${message}`);
      await this.postComplete(triggerId, { status: 'failed', error_message: message });
    }
  }

  private async resolveAgent(slug: string): Promise<AgentConfig | undefined> {
    try {
      const agents = await discoverAgents(this.options.agentsDir);
      return agents.find((a) => a.id === slug);
    } catch (err) {
      const message = toErrorMessage(err);
      console.error(`[trigger-handler] Failed to discover agents: ${message}`);
      return undefined;
    }
  }

  /**
   * Returns whether this daemon now holds the trigger.
   *
   * A transport failure answers true. Panel is the authority on the claim, and
   * refusing to run because the acknowledgement did not come back would turn
   * every blip into a silently dropped trigger. Running twice needs two live
   * machines and a lost response in the same moment; the run lock in
   * `execution/runner.ts` catches that case locally.
   */
  private async postAck(triggerId: string): Promise<boolean> {
    const body = this.options.machineId ? { machine_id: this.options.machineId } : {};
    const response = await this.post(
      `/api/run-triggers/${encodeURIComponent(triggerId)}/ack`,
      body,
    );

    // No response at all is a network failure. Panel might well have accepted
    // the claim, and refusing to run on a dropped reply would turn every blip
    // into a silently skipped trigger, so this fails open. Running twice needs
    // two live machines and a lost reply in the same moment, and the lock in
    // `execution/runner.ts` catches that locally.
    if (!response) return true;

    // A refusal is an answer, not a failure. Panel saying the trigger does not
    // exist, belongs to another organization, or is addressed elsewhere is the
    // one case where we definitely know not to run, so fail closed here.
    if (response.status >= 400 && response.status < 500) {
      console.warn(`[trigger-handler] Panel refused the claim for ${triggerId} (${response.status})`);
      return false;
    }

    if (!response.ok) return true;

    try {
      const parsed = (await response.json()) as { claimed?: unknown };
      // An older Panel does not report a claim. Its acknowledgement means the
      // same thing this one's does when it wins, so absence reads as yes.
      return parsed?.claimed !== false;
    } catch {
      return true;
    }
  }

  private async postRunning(triggerId: string, taskRunId: string): Promise<void> {
    await this.post(
      `/api/run-triggers/${encodeURIComponent(triggerId)}/running`,
      { task_run_id: taskRunId },
    );
  }

  private async postComplete(
    triggerId: string,
    body: { status: TerminalStatus; error_message?: string },
  ): Promise<void> {
    await this.post(`/api/run-triggers/${encodeURIComponent(triggerId)}/complete`, body);
  }

  private async post(path: string, body: unknown): Promise<Response | undefined> {
    const url = `${this.options.panelUrl}${path}`;
    try {
      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.options.panelApiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        console.error(`[trigger-handler] POST ${path} -> ${response.status}`);
      }
      // Returned either way. A refused request and an unreachable Panel are
      // different answers, and the caller is the only one that can tell which
      // of them matters.
      return response;
    } catch (err) {
      const message = toErrorMessage(err);
      console.error(`[trigger-handler] POST ${path} failed: ${message}`);
      return undefined;
    }
  }
}
