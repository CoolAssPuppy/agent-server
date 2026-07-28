/**
 * Every product-analytics event the CLI sends, named once.
 *
 * Naming: `object_action`, snake_case, action in the past tense.
 *
 * Deliberately distinct from the A2A run reporting this codebase already calls
 * "telemetry" (`reporting/reporter.ts`). That reports individual agent runs to
 * Agent Panel. This reports anonymous product usage. They never share a payload.
 *
 * A frozen catalog rather than raw strings because a typo in a string literal
 * becomes a silent second event in the analytics backend that nobody notices
 * for months.
 *
 * The run events here are named apart from the macOS app's `run_started`,
 * `run_completed`, and `run_failed` on purpose. Those are inferred from a poll
 * loop that suppresses its first pass and misses any run that starts and ends
 * between two polls, so they measure what a user saw. These measure what the
 * daemon actually did, with the executor and the outcome code the app never
 * has. Two names, two questions, and a `source` property that separates them.
 */
export const ANALYTICS_EVENTS = {
  /** A CLI verb ran. Carries `command`; the single best signal of CLI vs GUI use. */
  cliCommandInvoked: 'cli_command_invoked',
  /** A CLI verb exited non-zero. Carries `command` and an error `reason` slug. */
  cliCommandFailed: 'cli_command_failed',

  /** The daemon finished booting and is accepting work. */
  serverStarted: 'server_started',
  /** The daemon shut down cleanly, with `uptime_seconds` and the triggering signal. */
  serverStopped: 'server_stopped',
  /** The daemon could not boot. Carries a `reason` slug, never the raw message. */
  serverStartFailed: 'server_start_failed',

  /** An agent definition failed to parse or validate during discovery. */
  agentDefinitionInvalid: 'agent_definition_invalid',
  /** An agent run was dispatched by the daemon, with its trigger and executor. */
  agentRunDispatched: 'agent_run_dispatched',
  /** A dispatched run reached a terminal state. Carries `status` and `executor`. */
  agentRunSettled: 'agent_run_settled',
  /** A run was refused before it started: lock held, concurrency cap, trigger depth. */
  agentRunRejected: 'agent_run_rejected',

  /** A configured executor runtime was resolved at startup, bundled or installed. */
  executorResolved: 'executor_resolved',
  /** A configured executor runtime could not be resolved and is unavailable. */
  executorUnavailable: 'executor_unavailable',

  /** A messaging channel connected. Carries `channel` (`slack`, `telegram`). */
  channelConnected: 'channel_connected',
  /** A messaging channel failed to connect or dropped. Carries `channel`, `reason`. */
  channelFailed: 'channel_failed',

  /** `agent-server init` created a fresh workspace. */
  workspaceInitialized: 'workspace_initialized',
  /** The macOS LaunchAgent was installed or removed. Carries `action`. */
  launchAgentChanged: 'launch_agent_changed',
} as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

/**
 * Property values allowed on an event. Ids, slugs, enum cases, counts, and
 * flags only. Never an agent name, a prompt, a file path, a URL, a token, or
 * anything else a user typed.
 */
export type AnalyticsProperties = Record<string, string | number | boolean>;
