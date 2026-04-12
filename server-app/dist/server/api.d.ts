import { Hono } from 'hono';
import type { AgentConfig } from '../agents/config.js';
import type { RunStore } from '../reporting/store.js';
type ApiDependencies = {
    getAgents: () => Promise<AgentConfig[]>;
    store: RunStore;
    triggerRun: (agentId: string, promptSuffix?: string) => Promise<string>;
    cancelRun?: (runId: string) => boolean;
    cleanupFn?: () => Promise<number>;
    apiKey?: string;
    startedAt?: string;
    host?: string;
};
export declare function createApi(deps: ApiDependencies): Hono;
export {};
//# sourceMappingURL=api.d.ts.map