import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
function lockPath(lockDir, agentId) {
    return join(lockDir, `${agentId}.lock`);
}
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function readLockPid(path) {
    try {
        const content = readFileSync(path, 'utf-8').trim();
        const pid = Number(content);
        return Number.isFinite(pid) ? pid : null;
    }
    catch {
        return null;
    }
}
export function acquireLock(lockDir, agentId) {
    mkdirSync(lockDir, { recursive: true });
    const path = lockPath(lockDir, agentId);
    if (existsSync(path)) {
        const pid = readLockPid(path);
        if (pid !== null && isProcessAlive(pid)) {
            return false;
        }
        unlinkSync(path);
    }
    writeFileSync(path, String(process.pid), 'utf-8');
    return true;
}
export function releaseLock(lockDir, agentId) {
    const path = lockPath(lockDir, agentId);
    try {
        unlinkSync(path);
    }
    catch {
        // Lock file already gone
    }
}
export function isLocked(lockDir, agentId) {
    const path = lockPath(lockDir, agentId);
    if (!existsSync(path))
        return false;
    const pid = readLockPid(path);
    if (pid === null || !isProcessAlive(pid)) {
        try {
            unlinkSync(path);
        }
        catch { /* already gone */ }
        return false;
    }
    return true;
}
//# sourceMappingURL=lockfile.js.map