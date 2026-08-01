import { watch, statSync, type FSWatcher } from 'fs';
import { join, basename } from 'path';
import { toErrorMessage } from '../util/errors.js';
import type { AgentConfig } from './config.js';
import { discoverAgents, isAgentFile } from './discovery.js';

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
  const regex = [...pattern].map((character) => {
    if (character === '*') return '.*';
    if (character === '?') return '.';
    return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
  }).join('');
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

type AgentFileWatchManagerOptions = {
  agentsDir: string;
  discoverAgents?: typeof discoverAgents;
  onChange: (agentId: string, filePath: string) => void;
  debounceMs?: number;
  definitionDebounceMs?: number;
  onReconcile?: (watchCount: number) => void;
};

const DEFAULT_DEFINITION_DEBOUNCE_MS = 250;

/** Keeps runtime file watches aligned with the latest agent definitions. */
export class AgentFileWatchManager {
  private readonly options: AgentFileWatchManagerOptions;
  private activeWatcher: FileWatcher | undefined;
  private definitionWatcher: FSWatcher | undefined;
  private definitionTimer: ReturnType<typeof setTimeout> | undefined;
  private reconciliation: Promise<void> = Promise.resolve();
  private isStopped = true;

  constructor(options: AgentFileWatchManagerOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    this.isStopped = false;
    try {
      this.definitionWatcher = watch(
        this.options.agentsDir,
        { recursive: false },
        (_event, filename) => {
          if (!filename || !isAgentFile(filename.toString())) return;
          this.scheduleReconciliation();
        },
      );
      this.definitionWatcher.on('error', (error) => {
        console.error(`[file-watch] Agent definition watcher failed: ${toErrorMessage(error)}`);
      });
    } catch (error) {
      console.warn(`[file-watch] Cannot watch agent definitions: ${toErrorMessage(error)}`);
    }

    await this.queueReconciliation();
    if (!this.isStopped) {
      // Close the startup snapshot window even when the operating system does
      // not deliver an edit event immediately after watcher registration.
      await this.queueReconciliation();
    }
  }

  stop(): void {
    this.isStopped = true;
    if (this.definitionTimer) clearTimeout(this.definitionTimer);
    this.definitionTimer = undefined;
    this.definitionWatcher?.close();
    this.definitionWatcher = undefined;
    this.activeWatcher?.stop();
    this.activeWatcher = undefined;
  }

  private scheduleReconciliation(): void {
    if (this.definitionTimer) clearTimeout(this.definitionTimer);
    this.definitionTimer = setTimeout(() => {
      this.definitionTimer = undefined;
      void this.queueReconciliation();
    }, this.options.definitionDebounceMs ?? DEFAULT_DEFINITION_DEBOUNCE_MS);
  }

  private queueReconciliation(): Promise<void> {
    const work = this.reconciliation.then(() => this.reconcile());
    this.reconciliation = work.catch((error) => {
      console.error(`[file-watch] Failed to reconcile watches: ${toErrorMessage(error)}`);
    });
    return work;
  }

  private async reconcile(): Promise<void> {
    const discover = this.options.discoverAgents ?? discoverAgents;
    const agents = await discover(this.options.agentsDir);
    if (this.isStopped) return;

    const watches = extractWatchConfigs(agents);
    const replacement = new FileWatcher({
      watches,
      onChange: this.options.onChange,
      debounceMs: this.options.debounceMs,
    });
    replacement.start();
    this.activeWatcher?.stop();
    this.activeWatcher = replacement;
    this.options.onReconcile?.(watches.length);
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
