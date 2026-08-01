import { accessSync, constants, readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';

/**
 * Injectable probes so binary discovery is a pure function of its inputs and
 * fully unit-testable — no real filesystem or subprocess needed in tests.
 */
export type RuntimeProbe = {
  /** True if the path exists and is executable by the current user. */
  isExecutable: (path: string) => boolean;
  /** Resolve a command on PATH (like `which`); undefined if not found. */
  which: (command: string) => string | undefined;
  /** Find commands installed by supported user-local Node managers. */
  userLocalCommands: (command: string) => string[];
  /** True when the executable can start and report its version. */
  isRunnable: (path: string) => boolean;
  /** The user's home directory. */
  home: string;
  /** Environment, for explicit path overrides and the optional Kimi toggle. */
  env: Record<string, string | undefined>;
};

export type RuntimePaths = {
  /** Resolved path to the user's Claude executable, or undefined when unavailable. */
  claudeExecutablePath?: string;
  /** Resolved path to the user's Codex executable, or undefined when unavailable. */
  codexExecutablePath?: string;
  /** Resolved path to the user's installed Kimi Code executable. */
  kimiExecutablePath?: string;
};

/** The default probe backed by the real filesystem, PATH, and environment. */
export function createDefaultProbe(
  env: Record<string, string | undefined> = process.env,
): RuntimeProbe {
  return {
    isExecutable: (path) => {
      try {
        accessSync(path, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    which: (command) => {
      try {
        const resolved = execFileSync('which', [command], { encoding: 'utf8' }).trim();
        return resolved.length > 0 ? resolved : undefined;
      } catch {
        return undefined;
      }
    },
    userLocalCommands: (command) => findUserLocalCommands(homedir(), command),
    isRunnable: (path) => {
      try {
        execFileSync(path, ['--version'], { stdio: 'ignore', timeout: 5_000 });
        return true;
      } catch {
        return false;
      }
    },
    home: homedir(),
    env,
  };
}

/**
 * Find the user's installed Claude executable, so runs use the binary (and
 * subscription login) they already have rather than the SDK's bundled one.
 * Resolution order: explicit override > known user-local installer paths >
 * PATH. Returns undefined when Claude Code is unavailable.
 */
export function discoverClaudeExecutable(probe: RuntimeProbe): string | undefined {
  const explicit = probe.env.AGENT_SERVER_CLAUDE_PATH;
  if (explicit) return probe.isExecutable(explicit) ? explicit : undefined;

  const localInstalls = [
    join(probe.home, '.local', 'bin', 'claude'),
    join(probe.home, '.claude', 'local', 'claude'),
  ];
  const localInstall = localInstalls.find(probe.isExecutable);
  if (localInstall) return localInstall;

  const onPath = probe.which('claude');
  return onPath && probe.isExecutable(onPath) ? onPath : undefined;
}

/**
 * Find the user's installed Codex executable. Resolution order: explicit
 * override > supported user-local Node installs > PATH. Candidates must start
 * successfully, which prevents a stale wrapper from hiding a working install.
 */
export function discoverCodexExecutable(probe: RuntimeProbe): string | undefined {
  const explicit = probe.env.AGENT_SERVER_CODEX_PATH;
  if (explicit) {
    return probe.isExecutable(explicit) && probe.isRunnable(explicit) ? explicit : undefined;
  }

  const localInstall = probe.userLocalCommands('codex')
    .find((path) => probe.isExecutable(path) && probe.isRunnable(path));
  if (localInstall) return localInstall;

  const onPath = probe.which('codex');
  return onPath && probe.isExecutable(onPath) && probe.isRunnable(onPath) ? onPath : undefined;
}

/**
 * Find the user's installed Kimi Code executable. Kimi Code has no bundled
 * fallback, so an undefined result means the runtime is unavailable.
 */
export function discoverKimiExecutable(probe: RuntimeProbe): string | undefined {
  if (probe.env.AGENT_SERVER_USE_INSTALLED_KIMI === 'false') return undefined;

  const explicit = probe.env.AGENT_SERVER_KIMI_PATH;
  if (explicit) return probe.isExecutable(explicit) ? explicit : undefined;

  const localInstall = join(probe.home, '.kimi-code', 'bin', 'kimi');
  if (probe.isExecutable(localInstall)) return localInstall;

  const onPath = probe.which('kimi');
  return onPath && probe.isExecutable(onPath) ? onPath : undefined;
}

/** Resolve all runtime paths at once (called once at server startup). */
export function discoverRuntimePaths(
  probe: RuntimeProbe = createDefaultProbe(),
): RuntimePaths {
  return {
    claudeExecutablePath: discoverClaudeExecutable(probe),
    codexExecutablePath: discoverCodexExecutable(probe),
    kimiExecutablePath: discoverKimiExecutable(probe),
  };
}

function findUserLocalCommands(home: string, command: string): string[] {
  const directCandidates = [
    join(home, '.local', 'bin', command),
    join(home, '.volta', 'bin', command),
  ];
  const nvmRoot = join(home, '.nvm', 'versions', 'node');
  let nvmCandidates: string[] = [];
  try {
    nvmCandidates = readdirSync(nvmRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      .map((version) => join(nvmRoot, version, 'bin', command));
  } catch {
    // The user may not use nvm.
  }
  return [...directCandidates, ...nvmCandidates];
}
