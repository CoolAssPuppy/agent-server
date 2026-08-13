/**
 * The shape of every event the server broadcasts about a run.
 *
 * It lives here rather than beside the broadcaster because the broadcaster
 * sanitizes each event before sending it, and the sanitizer has to be able to
 * name what it is sanitizing. Holding the shared type apart from both keeps
 * that from being a cycle.
 */
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
