import { watch, statSync } from 'fs';
import { join, basename } from 'path';
const DEFAULT_DEBOUNCE_MS = 500;
function compileGlob(pattern) {
    const regex = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${regex}$`);
}
export class FileWatcher {
    options;
    debounceMs;
    watchers = [];
    timers = new Map();
    constructor(options) {
        this.options = options;
        this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    }
    start() {
        for (const config of this.options.watches) {
            this.watchPath(config);
        }
    }
    stop() {
        for (const w of this.watchers) {
            w.close();
        }
        this.watchers.length = 0;
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
    }
    watchPath(config) {
        let isDirectory = false;
        try {
            isDirectory = statSync(config.path).isDirectory();
        }
        catch {
            console.warn(`[file-watch] Skipping unreadable watch path: ${config.path}`);
            return;
        }
        const globPattern = config.glob && isDirectory ? compileGlob(config.glob) : null;
        const fsWatcher = watch(config.path, { recursive: false }, (_event, filename) => {
            if (!filename)
                return;
            const fullPath = isDirectory ? join(config.path, filename) : config.path;
            if (globPattern && !globPattern.test(basename(fullPath)))
                return;
            this.debouncedNotify(config.agentId, fullPath);
        });
        fsWatcher.on('error', (err) => {
            console.error(`[file-watch] Watcher error for ${config.path}: ${err}`);
        });
        this.watchers.push(fsWatcher);
    }
    debouncedNotify(agentId, filePath) {
        const key = `${agentId}:${filePath}`;
        const existing = this.timers.get(key);
        if (existing)
            clearTimeout(existing);
        const timer = setTimeout(() => {
            this.timers.delete(key);
            this.options.onChange(agentId, filePath);
        }, this.debounceMs);
        this.timers.set(key, timer);
    }
}
export function expandHome(path) {
    return path.replace(/^~/, process.env.HOME ?? '');
}
export function extractWatchConfigs(agents) {
    const configs = [];
    for (const agent of agents) {
        if (!agent.enabled || !agent.watch)
            continue;
        for (const w of agent.watch) {
            configs.push({
                path: expandHome(w.path),
                agentId: agent.id,
                glob: w.glob,
            });
        }
    }
    return configs;
}
//# sourceMappingURL=file-watcher.js.map