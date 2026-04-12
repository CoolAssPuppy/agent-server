import type { ServerConfig } from '../platform/config.js';
import type { Reporter } from '../execution/runner.js';
type CreateReporterOptions = {
    serverId?: string;
    conversationId?: string;
};
export declare function createReporter(config: ServerConfig, runId: string, agentName: string, options?: CreateReporterOptions): Reporter;
export {};
//# sourceMappingURL=reporter-factory.d.ts.map