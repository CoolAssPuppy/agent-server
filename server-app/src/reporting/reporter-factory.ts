import type { ServerConfig } from '../platform/config.js';
import type { AgentTelemetry } from '../agents/config.js';
import type { Reporter } from '../execution/runner.js';
import { TelemetryReporter } from './reporter.js';

const noopReporter: Reporter = {
  start: async () => {},
  progress: async () => {},
  complete: async () => {},
  fail: async () => {},
  cancel: async () => {},
  stop: () => {},
};

type CreateReporterOptions = {
  serverId?: string;
  conversationId?: string;
  /**
   * Per-agent telemetry overrides. Any field set here wins over the
   * equivalent server config value. The server config in turn wins over the
   * hard-coded defaults in `TelemetryReporter`.
   */
  agentTelemetry?: AgentTelemetry;
};

export function createReporter(
  config: ServerConfig,
  runId: string,
  agentName: string,
  options: CreateReporterOptions = {},
): Reporter {
  if (!config.panelUrl || !config.panelApiKey) {
    return noopReporter;
  }

  const at = options.agentTelemetry;

  return new TelemetryReporter({
    runId,
    agentName,
    endpoint: `${config.panelUrl}/api/runs/${runId}/status`,
    apiKey: config.panelApiKey,
    heartbeatMs: config.heartbeatMs,
    progressMode: at?.progress_mode ?? config.telemetryProgressMode,
    progressSampleMs: at?.progress_sample_ms ?? config.telemetryProgressSampleMs,
    maxProgressEntries: at?.progress_max_entries ?? config.telemetryProgressMaxEntries,
    includeProgressMetadata: at?.progress_include_metadata ?? config.telemetryProgressIncludeMetadata,
    serverId: options.serverId,
    conversationId: options.conversationId,
  });
}
