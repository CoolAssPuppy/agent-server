export type ProgressEvent = {
    type: 'run_started' | 'run_progress' | 'run_completed' | 'run_failed';
    runId: string;
    agentId: string;
    timestamp: string;
    message?: string;
    error?: string;
    summary?: string;
    metadata?: Record<string, unknown>;
};
type ProgressListener = (event: ProgressEvent) => void;
export declare class ProgressBroadcaster {
    private listeners;
    subscribe(listener: ProgressListener): void;
    unsubscribe(listener: ProgressListener): void;
    emit(event: ProgressEvent): void;
}
export {};
//# sourceMappingURL=websocket.d.ts.map