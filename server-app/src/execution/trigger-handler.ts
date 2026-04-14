import type { EventEmitter } from 'events';
import type { AgentConfig } from '../agents/config.js';
import { discoverAgents } from '../agents/discovery.js';
import type { RunResult } from './runner.js';
import type { RunTriggerEvent } from '../reporting/sse-client.js';

export type TriggerKind = 'manual';

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
};

type TerminalStatus = 'completed' | 'failed' | 'canceled';

function coercePromptSuffix(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input === 'string') return input;
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
        const message = err instanceof Error ? err.message : String(err);
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
    await this.postAck(event.trigger_id);

    const agent = await this.resolveAgent(event.task_slug);
    if (!agent) {
      await this.postComplete(event.trigger_id, {
        status: 'failed',
        error_message: 'task_slug not found',
      });
      return;
    }

    const triggerId = event.trigger_id;
    const promptSuffix = coercePromptSuffix(event.input);

    try {
      const result = await this.options.invokeRun({
        agent,
        trigger: 'manual',
        promptSuffix,
        onRunStart: async (runId) => {
          await this.postRunning(triggerId, runId);
        },
      });
      await this.postComplete(triggerId, resultToTerminal(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[trigger-handler] invokeRun threw: ${message}`);
      await this.postComplete(triggerId, { status: 'failed', error_message: message });
    }
  }

  private async resolveAgent(slug: string): Promise<AgentConfig | undefined> {
    try {
      const agents = await discoverAgents(this.options.agentsDir);
      return agents.find((a) => a.id === slug);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[trigger-handler] Failed to discover agents: ${message}`);
      return undefined;
    }
  }

  private async postAck(triggerId: string): Promise<void> {
    await this.post(`/api/run-triggers/${encodeURIComponent(triggerId)}/ack`, {});
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

  private async post(path: string, body: unknown): Promise<void> {
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[trigger-handler] POST ${path} failed: ${message}`);
    }
  }
}
