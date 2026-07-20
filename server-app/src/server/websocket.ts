import { sanitizeProgressEvent } from './security-utils.js';

export type ProgressEvent = {
  type: 'run_started' | 'run_progress' | 'run_completed' | 'run_failed' | 'run_skipped' | 'mcp_status';
  runId: string;
  agentId: string;
  timestamp: string;
  message?: string;
  error?: string;
  summary?: string;
  /**
   * Discriminator for failure reasons. Populated on `run_failed` when the
   * runner can attribute the failure to a known cause (e.g. `run_timeout`).
   * Clients use this to route the event to a category-specific notification.
   */
  code?: string;
  /**
   * MCP server names reporting `needs-auth` status. Only present on
   * `mcp_status` events.
   */
  mcp_needs_auth_servers?: string[];
  metadata?: Record<string, unknown>;
};

type ProgressListener = (event: ProgressEvent) => void;

export class ProgressBroadcaster {
  private listeners = new Set<ProgressListener>();

  subscribe(listener: ProgressListener): void {
    this.listeners.add(listener);
  }

  unsubscribe(listener: ProgressListener): void {
    this.listeners.delete(listener);
  }

  emit(event: ProgressEvent): void {
    const safeEvent = sanitizeProgressEvent(event);
    for (const listener of this.listeners) {
      try {
        listener(safeEvent);
      } catch (err) {
        console.error('[websocket] Listener error:', err);
      }
    }
  }
}
