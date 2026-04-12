import type { Permissions } from '../agents/config.js';
export declare function matchesPattern(toolName: string, pattern: string): boolean;
export declare function isToolAllowed(toolName: string, permissions: Permissions): boolean;
type PermissionResult = {
    behavior: 'allow';
} | {
    behavior: 'deny';
    message: string;
};
type CanUseToolFn = (toolName: string, input: Record<string, unknown>, options: {
    signal: AbortSignal;
    toolUseID: string;
}) => Promise<PermissionResult>;
export declare function buildCanUseTool(permissions: Permissions): CanUseToolFn;
export {};
//# sourceMappingURL=permissions.d.ts.map