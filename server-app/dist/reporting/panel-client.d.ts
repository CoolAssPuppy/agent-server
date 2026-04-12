type PanelClientConfig = {
    panelUrl: string;
    panelApiKey: string;
    fetch?: typeof globalThis.fetch;
};
export declare class PanelClient {
    private readonly panelUrl;
    private readonly panelApiKey;
    private readonly fetchFn;
    constructor(config: PanelClientConfig);
    failOrphanedRuns(serverId?: string): Promise<number>;
    markStaleRuns(): Promise<void>;
}
export declare function createPanelClient(config: {
    panelUrl?: string;
    panelApiKey?: string;
}): PanelClient | null;
export {};
//# sourceMappingURL=panel-client.d.ts.map