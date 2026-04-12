import type { ServerConfig } from '../platform/config.js';
type RunOptions = {
    promptSuffix?: string;
};
export declare function runDueAgents(config: ServerConfig): Promise<void>;
export declare function runSingleAgent(config: ServerConfig, agentId: string, options?: RunOptions): Promise<void>;
export declare function listAgents(config: ServerConfig): Promise<void>;
export declare function startDaemon(config: ServerConfig): {
    stop: () => void;
};
export {};
//# sourceMappingURL=daemon.d.ts.map