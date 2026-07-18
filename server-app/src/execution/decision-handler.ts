import { EventEmitter } from 'events';
import { mkdirSync, appendFileSync } from 'fs';
import { dirname } from 'path';
import type { DecisionInput } from '../interaction/schema.js';
import { toErrorMessage } from '../util/errors.js';

/**
 * Resolution payload shape shipped by the Panel over SSE when a decision is resolved.
 * Matches `DecisionResolvedEvent.resolution` in realtime-client.ts.
 */
export type DecisionResolutionPayload = {
  action_id: string;
  input?: string;
};

type DecisionResolvedEvent = {
  id: number;
  type: 'decision_resolved';
  decision_id: string;
  task_run_id: string;
  resolution: DecisionResolutionPayload;
};

/**
 * Structural interface of the SSE event bus. The RealtimeClient exposes
 * `.events` which implements this (plus more). We inject this shape to
 * decouple from the concrete RealtimeClient module so this code is testable and
 * does not depend on the realtime-client module being present at unit-test time.
 */
export interface SseEventBus extends EventEmitter {
  on(event: 'decision_resolved', listener: (e: DecisionResolvedEvent) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

const DEFAULT_GRACE_MS = 2 * 60 * 1000;
// Fallback timeout when no due_at is provided. 24h keeps the runner
// effectively paused for MVP; documented in Chunk 9 spec.
const DEFAULT_NO_DUE_AT_TIMEOUT_MS = 24 * 60 * 60 * 1000;

type AwaitResolutionOptions = {
  decisionId: string;
  eventBus: SseEventBus;
  /** Overrides computed timeout. Test hook. */
  timeoutMs?: number;
  /** ISO-8601 due_at from the decision. Timeout = dueAt + 2min. */
  dueAt?: string;
  now?: () => number;
};

export function awaitResolution(
  options: AwaitResolutionOptions,
): Promise<DecisionResolutionPayload> {
  const now = options.now ?? (() => Date.now());
  const timeoutMs = computeTimeoutMs(options, now);

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const listener = (event: DecisionResolvedEvent): void => {
      if (event.decision_id !== options.decisionId) return;
      cleanup();
      resolve(event.resolution);
    };

    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      options.eventBus.off('decision_resolved', listener);
    };

    timer = setTimeout(() => {
      cleanup();
      reject(new Error('Decision timed out'));
    }, timeoutMs);

    options.eventBus.on('decision_resolved', listener);
  });
}

function computeTimeoutMs(options: AwaitResolutionOptions, now: () => number): number {
  if (typeof options.timeoutMs === 'number') return options.timeoutMs;
  if (options.dueAt) {
    const due = Date.parse(options.dueAt);
    if (!Number.isNaN(due)) {
      return Math.max(1, due - now() + DEFAULT_GRACE_MS);
    }
  }
  return DEFAULT_NO_DUE_AT_TIMEOUT_MS;
}

export function formatResolution(
  resolution: DecisionResolutionPayload,
  decision: DecisionInput,
): string {
  if (decision.type === 'approve') {
    if (resolution.action_id === 'approve') {
      return `User approved: ${decision.approve_label ?? 'Approve'}.`;
    }
    return `User declined: ${decision.decline_label ?? 'Decline'}.`;
  }

  if (decision.type === 'pick') {
    if (resolution.action_id === 'none') {
      return 'User chose none of the provided options.';
    }
    const picked = decision.options.find((o) => o.id === resolution.action_id);
    return `User picked: ${picked?.label ?? resolution.action_id}.`;
  }

  // answer
  return `User answered: ${resolution.input ?? ''}`;
}

type PostDecisionOptions = {
  runId: string;
  decision: DecisionInput;
  panelUrl: string;
  panelApiKey: string;
  fetch?: typeof globalThis.fetch;
};

/**
 * POSTs the decision to the panel and returns the decision_id issued by the
 * panel. Throws on non-ok responses so the runner can fail the run cleanly.
 */
export async function postDecision(options: PostDecisionOptions): Promise<string> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const url = `${options.panelUrl}/api/runs/${options.runId}/status`;

  const response = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.panelApiKey}`,
    },
    body: JSON.stringify({
      state: 'input_required',
      decision: options.decision,
    }),
  });

  if (!response.ok) {
    let detail = '';
    try {
      detail = await response.text();
    } catch {
      // ignore
    }
    throw new Error(
      `Failed to post decision: panel returned ${response.status}${detail ? `: ${detail}` : ''}`,
    );
  }

  const body = (await response.json()) as { decision_id?: string };
  if (!body.decision_id) {
    throw new Error('Panel did not return decision_id');
  }
  return body.decision_id;
}

type PersistOptions = {
  runId: string;
  conversationDir: string;
  role: 'user' | 'assistant';
  content: string;
};

/**
 * Appends a conversation entry to `~/.agent-server/runs/{run_id}.jsonl` for
 * restart resilience. Each entry is a single JSON line.
 */
export function persistConversationEntry(options: PersistOptions): void {
  const path = `${options.conversationDir.replace(/\/$/, '')}/${options.runId}.jsonl`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(
      path,
      `${JSON.stringify({ role: options.role, content: options.content, at: new Date().toISOString() })}\n`,
      'utf-8',
    );
  } catch (err) {
    const message = toErrorMessage(err);
    console.error(`[decision-handler] Failed to persist conversation: ${message}`);
  }
}

/**
 * Context required to execute a decision pause/resume cycle from the runner.
 * Absence of this context disables decision handling (backwards compatible).
 */
export type DecisionContext = {
  runId: string;
  panelUrl: string;
  panelApiKey: string;
  eventBus: SseEventBus;
  fetch?: typeof globalThis.fetch;
  conversationDir?: string;
  now?: () => number;
};

export type DecisionOutcome =
  | { status: 'resolved'; resumptionText: string }
  | { status: 'timeout' };

/**
 * Orchestrates a full pause/resume cycle for a single decision:
 *   POST decision -> await resolution -> persist + format for resumption.
 * On timeout, reports 'failed' to the panel and returns { status: 'timeout' }.
 */
export async function runDecisionCycle(
  decision: DecisionInput,
  context: DecisionContext,
): Promise<DecisionOutcome> {
  const decisionId = await postDecision({
    runId: context.runId,
    decision,
    panelUrl: context.panelUrl,
    panelApiKey: context.panelApiKey,
    fetch: context.fetch,
  });

  try {
    const resolution = await awaitResolution({
      decisionId,
      eventBus: context.eventBus,
      dueAt: decision.due_at,
      now: context.now,
    });

    const resumptionText = formatResolution(resolution, decision);

    if (context.conversationDir) {
      persistConversationEntry({
        runId: context.runId,
        conversationDir: context.conversationDir,
        role: 'user',
        content: resumptionText,
      });
    }

    return { status: 'resolved', resumptionText };
  } catch (err) {
    const message = toErrorMessage(err);
    if (message === 'Decision timed out') {
      // Do not POST failed state here. The caller (plugin) throws and the
      // runner reports the failure via reporter.fail(), which uses the unified
      // terminal-POST retry path. Posting here would cause a double-terminal.
      return { status: 'timeout' };
    }
    throw err;
  }
}
