export function matchesPattern(toolName, pattern) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(toolName);
}
function matchesAnyPattern(toolName, patterns) {
    return patterns.some((p) => matchesPattern(toolName, p));
}
export function isToolAllowed(toolName, permissions) {
    if (matchesAnyPattern(toolName, permissions.deny))
        return false;
    if (matchesAnyPattern(toolName, permissions.allow))
        return true;
    return false;
}
export function buildCanUseTool(permissions) {
    return async (toolName) => {
        if (isToolAllowed(toolName, permissions)) {
            return { behavior: 'allow' };
        }
        return { behavior: 'deny', message: `Tool "${toolName}" is not permitted by agent permissions` };
    };
}
//# sourceMappingURL=permissions.js.map