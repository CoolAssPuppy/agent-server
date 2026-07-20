import { accessSync, constants } from 'fs';
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
  /** The user's home directory. */
  home: string;
  /** Environment, for opt-out flags and explicit path overrides. */
  env: Record<string, string | undefined>;
};

export type RuntimePaths = {
  /** Resolved path to the user's Claude executable, or undefined for bundled. */
  claudeExecutablePath?: string;
  /** Resolved path to the user's Codex executable, or undefined for bundled. */
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
    home: homedir(),
    env,
  };
}

/**
 * Find the user's installed Claude executable, so runs use the binary (and
 * subscription login) they already have rather than the SDK's bundled one.
 * Resolution order: opt-out flag > explicit override > `~/.claude/local/claude`
 * > PATH. Returns undefined to fall back to the bundled runtime.
 */
export function discoverClaudeExecutable(probe: RuntimeProbe): string | undefined {
  if (probe.env.AGENT_SERVER_USE_INSTALLED_CLAUDE === 'false') return undefined;

  const explicit = probe.env.AGENT_SERVER_CLAUDE_PATH;
  if (explicit) return probe.isExecutable(explicit) ? explicit : undefined;

  const localInstall = join(probe.home, '.claude', 'local', 'claude');
  if (probe.isExecutable(localInstall)) return localInstall;

  const onPath = probe.which('claude');
  return onPath && probe.isExecutable(onPath) ? onPath : undefined;
}

/**
 * Find the user's installed Codex executable. Resolution order: opt-out flag >
 * explicit override > PATH. Returns undefined to fall back to bundled.
 */
export function discoverCodexExecutable(probe: RuntimeProbe): string | undefined {
  if (probe.env.AGENT_SERVER_USE_INSTALLED_CODEX === 'false') return undefined;

  const explicit = probe.env.AGENT_SERVER_CODEX_PATH;
  if (explicit) return probe.isExecutable(explicit) ? explicit : undefined;

  const onPath = probe.which('codex');
  return onPath && probe.isExecutable(onPath) ? onPath : undefined;
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

/** Resolve both runtime paths at once (called once at server startup). */
export function discoverRuntimePaths(
  probe: RuntimeProbe = createDefaultProbe(),
): RuntimePaths {
  return {
    claudeExecutablePath: discoverClaudeExecutable(probe),
    codexExecutablePath: discoverCodexExecutable(probe),
    kimiExecutablePath: discoverKimiExecutable(probe),
  };
}
