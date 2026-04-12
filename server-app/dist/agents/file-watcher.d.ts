import type { AgentConfig } from './config.js';
export type FileWatchConfig = {
    path: string;
    agentId: string;
    glob?: string;
};
type FileWatcherOptions = {
    watches: FileWatchConfig[];
    onChange: (agentId: string, filePath: string) => void;
    debounceMs?: number;
};
export declare class FileWatcher {
    private readonly options;
    private readonly debounceMs;
    private readonly watchers;
    private readonly timers;
    constructor(options: FileWatcherOptions);
    start(): void;
    stop(): void;
    private watchPath;
    private debouncedNotify;
}
export declare function expandHome(path: string): string;
export declare function extractWatchConfigs(agents: AgentConfig[]): FileWatchConfig[];
export {};
//# sourceMappingURL=file-watcher.d.ts.map