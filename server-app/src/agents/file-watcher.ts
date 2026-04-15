import { watch, statSync, type FSWatcher } from 'fs';
import { join, basename } from 'path';
import type { AgentConfig } from './config.js';

export type FileWatchConfig = {
  path: string;
  agentId: string;
  glob?: string;
};

type FileWatcherOptions = {
  watches: FileWatchConfig[];
  onChange: (agentId: string, filePath: string) => void;
  debounceMs?: number;
};

const DEFAULT_DEBOUNCE_MS = 500;

function compileGlob(pattern: string): RegExp {
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${regex}$`);
}

export class FileWatcher {
  private readonly options: FileWatcherOptions;
  private readonly debounceMs: number;
  private readonly watchers: FSWatcher[] = [];
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: FileWatcherOptions) {
    this.options = options;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  start(): void {
    for (const config of this.options.watches) {
      this.watchPath(config);
    }
  }

  stop(): void {
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers.length = 0;

    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private watchPath(config: FileWatchConfig): void {
    let isDirectory = false;
    try {
      isDirectory = statSync(config.path).isDirectory();
    } catch {
      console.warn(`[file-watch] Skipping unreadable watch path: ${config.path}`);
      return;
    }

    const globPattern = config.glob && isDirectory ? compileGlob(config.glob) : null;

    const fsWatcher = watch(config.path, { recursive: false }, (_event, filename) => {
      if (!filename) return;

      const fullPath = isDirectory ? join(config.path, filename) : config.path;

      if (globPattern && !globPattern.test(basename(fullPath))) return;

      this.debouncedNotify(config.agentId, fullPath);
    });

    fsWatcher.on('error', (err) => {
      console.error(`[file-watch] Watcher error for ${config.path}: ${err}`);
      // Prevent file-descriptor leaks when the underlying watch fails
      // (device files, permission-denied paths, unmount). The closed
      // watcher still lives in `this.watchers` and will be a no-op on
      // `stop()`, which is safe.
      try { fsWatcher.close(); } catch { /* already closed */ }
    });

    this.watchers.push(fsWatcher);
  }

  private debouncedNotify(agentId: string, filePath: string): void {
    const key = `${agentId}:${filePath}`;
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.timers.delete(key);
      this.options.onChange(agentId, filePath);
    }, this.debounceMs);

    this.timers.set(key, timer);
  }
}

export function expandHome(path: string): string {
  return path.replace(/^~/, process.env.HOME ?? '');
}

export function extractWatchConfigs(agents: AgentConfig[]): FileWatchConfig[] {
  const configs: FileWatchConfig[] = [];

  for (const agent of agents) {
    if (!agent.enabled || !agent.watch) continue;

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
