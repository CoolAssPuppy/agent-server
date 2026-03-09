import type { ServerConfig } from '../platform/config.js';
import type { Reporter } from '../execution/runner.js';
import { TelemetryReporter } from './reporter.js';

const noopReporter: Reporter = {
  start: async () => {},
  progress: async () => {},
  complete: async () => {},
  fail: async () => {},
  stop: () => {},
};

export function createReporter(config: ServerConfig, runId: string, agentName: string): Reporter {
  if (!config.panelUrl || !config.panelApiKey) {
    return noopReporter;
  }

  return new TelemetryReporter({
    runId,
    agentName,
    endpoint: `${config.panelUrl}/api/runs/${runId}/status`,
    apiKey: config.panelApiKey,
    heartbeatMs: config.heartbeatMs,
  });
}
