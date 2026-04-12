import { TelemetryReporter } from './reporter.js';
const noopReporter = {
    start: async () => { },
    progress: async () => { },
    complete: async () => { },
    fail: async () => { },
    stop: () => { },
};
export function createReporter(config, runId, agentName, options = {}) {
    if (!config.panelUrl || !config.panelApiKey) {
        return noopReporter;
    }
    return new TelemetryReporter({
        runId,
        agentName,
        endpoint: `${config.panelUrl}/api/runs/${runId}/status`,
        apiKey: config.panelApiKey,
        heartbeatMs: config.heartbeatMs,
        serverId: options.serverId,
        conversationId: options.conversationId,
    });
}
//# sourceMappingURL=reporter-factory.js.map