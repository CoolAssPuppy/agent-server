export type InitOptions = {
    /**
     * When true, prints a "Next steps" block after scaffolding. Used by the
     * `agent-server init` CLI command. The `start` command also calls init to
     * be self-healing on first launch, but passes verbose=false so the startup
     * output stays quiet.
     */
    verbose?: boolean;
};
export declare function initAgentServer(baseDir: string, options?: InitOptions): void;
//# sourceMappingURL=init.d.ts.map