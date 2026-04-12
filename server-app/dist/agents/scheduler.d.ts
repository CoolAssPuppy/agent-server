import type { AgentConfig } from './config.js';
export declare function shouldRun(agent: AgentConfig, now: Date): boolean;
export declare function hasMissedRun(agent: AgentConfig, since: Date, now: Date): boolean;
export declare function getNextRun(agent: AgentConfig, now: Date): Date | undefined;
//# sourceMappingURL=scheduler.d.ts.map