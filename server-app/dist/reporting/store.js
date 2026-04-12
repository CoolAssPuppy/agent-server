const DEFAULT_MAX_RUNS = 200;
const MAX_PROGRESS_MESSAGES_PER_RUN = 500;
const MAX_LIST_ITEMS = 256;
const MAX_TEXT_LENGTH = 4_000;
function truncate(value, maxLength = MAX_TEXT_LENGTH) {
    if (value.length <= maxLength)
        return value;
    return `${value.slice(0, maxLength)}…`;
}
function trimArray(values) {
    return values.slice(0, MAX_LIST_ITEMS).map((v) => truncate(v));
}
function normalizeStoredRun(run) {
    return {
        ...run,
        summary: run.summary ? truncate(run.summary, 8_000) : undefined,
        error: run.error ? truncate(run.error, 2_000) : undefined,
        toolsUsed: trimArray(run.toolsUsed),
        filesRead: trimArray(run.filesRead),
        filesWritten: trimArray(run.filesWritten),
        commandsRun: trimArray(run.commandsRun),
        progressMessages: run.progressMessages.slice(-MAX_PROGRESS_MESSAGES_PER_RUN).map((v) => truncate(v, 1_000)),
    };
}
export class RunStore {
    runs = new Map();
    maxRuns;
    constructor(maxRuns = DEFAULT_MAX_RUNS) {
        this.maxRuns = maxRuns;
    }
    add(run) {
        this.runs.set(run.runId, normalizeStoredRun({ ...run }));
        this.evictOldest();
    }
    get(runId) {
        const run = this.runs.get(runId);
        return run ? { ...run } : undefined;
    }
    list() {
        return [...this.runs.values()]
            .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    }
    listByAgent(agentId) {
        return [...this.runs.values()]
            .filter((r) => r.agentId === agentId)
            .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    }
    update(runId, updates) {
        const run = this.runs.get(runId);
        if (!run)
            return;
        this.runs.set(runId, normalizeStoredRun({ ...run, ...updates }));
    }
    addProgress(runId, message) {
        const run = this.runs.get(runId);
        if (!run)
            return;
        const nextMessages = [...run.progressMessages, truncate(message, 1_000)];
        this.runs.set(runId, {
            ...run,
            progressMessages: nextMessages.slice(-MAX_PROGRESS_MESSAGES_PER_RUN),
        });
    }
    evictOldest() {
        if (this.runs.size <= this.maxRuns)
            return;
        const sorted = [...this.runs.entries()]
            .sort(([, a], [, b]) => a.startedAt.getTime() - b.startedAt.getTime());
        const toRemove = sorted.slice(0, this.runs.size - this.maxRuns);
        for (const [key] of toRemove) {
            this.runs.delete(key);
        }
    }
}
//# sourceMappingURL=store.js.map