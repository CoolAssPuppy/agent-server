type PlistOptions = {
    cliPath: string;
    logsDir?: string;
};
type InstallOptions = {
    cliPath: string;
    targetDir?: string;
    logsDir?: string;
};
export declare function generatePlist(options: PlistOptions): string;
export declare function installLaunchAgent(options: InstallOptions): string;
export declare function uninstallLaunchAgent(targetDir?: string): void;
export {};
//# sourceMappingURL=launchd.d.ts.map