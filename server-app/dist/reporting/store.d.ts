export type StoredRun = {
    runId: string;
    agentId: string;
    agentName: string;
    status: 'running' | 'completed' | 'failed' | 'skipped';
    startedAt: Date;
    completedAt?: Date;
    summary?: string;
    error?: string;
    turnCount: number;
    toolsUsed: string[];
    filesRead: string[];
    filesWritten: string[];
    commandsRun: string[];
    progressMessages: string[];
    conversationId?: string;
};
export declare class RunStore {
    private readonly runs;
    private readonly maxRuns;
    constructor(maxRuns?: number);
    add(run: StoredRun): void;
    get(runId: string): StoredRun | undefined;
    list(): StoredRun[];
    listByAgent(agentId: string): StoredRun[];
    update(runId: string, updates: Partial<StoredRun>): void;
    addProgress(runId: string, message: string): void;
    private evictOldest;
}
//# sourceMappingURL=store.d.ts.map