import { describe, it, expect } from 'vitest';
import { join } from 'path';
import {
  discoverClaudeExecutable,
  discoverCodexExecutable,
  discoverKimiExecutable,
  discoverRuntimePaths,
  type RuntimeProbe,
} from './runtime-discovery.js';

const HOME = '/Users/tester';

type TestRuntimeProbe = RuntimeProbe & {
  isRunnable: (path: string) => boolean;
  userLocalCommands: (command: string) => string[];
};

function makeProbe(overrides: Partial<TestRuntimeProbe> = {}): TestRuntimeProbe {
  return {
    isExecutable: () => false,
    isRunnable: () => false,
    userLocalCommands: () => [],
    which: () => undefined,
    home: HOME,
    env: {},
    ...overrides,
  };
}

describe('discoverClaudeExecutable', () => {
  it('finds the native installer in ~/.local/bin without an interactive shell PATH', () => {
    const nativeInstall = join(HOME, '.local', 'bin', 'claude');
    const probe = makeProbe({
      isExecutable: (path) => path === nativeInstall,
    });

    expect(discoverClaudeExecutable(probe)).toBe(nativeInstall);
  });

  it('prefers the ~/.claude/local/claude install when present', () => {
    const local = join(HOME, '.claude', 'local', 'claude');
    const probe = makeProbe({
      isExecutable: (p) => p === local,
      which: () => '/usr/local/bin/claude',
    });
    expect(discoverClaudeExecutable(probe)).toBe(local);
  });

  it('falls back to the PATH binary when no local install exists', () => {
    const onPath = '/opt/homebrew/bin/claude';
    const probe = makeProbe({
      isExecutable: (p) => p === onPath,
      which: (cmd) => (cmd === 'claude' ? onPath : undefined),
    });
    expect(discoverClaudeExecutable(probe)).toBe(onPath);
  });

  it('reports Claude unavailable when nothing is installed', () => {
    expect(discoverClaudeExecutable(makeProbe())).toBeUndefined();
  });

  it('honors an explicit AGENT_SERVER_CLAUDE_PATH override', () => {
    const custom = '/custom/claude';
    const probe = makeProbe({
      isExecutable: (p) => p === custom,
      env: { AGENT_SERVER_CLAUDE_PATH: custom },
    });
    expect(discoverClaudeExecutable(probe)).toBe(custom);
  });

  it('ignores an explicit override that is not executable', () => {
    const probe = makeProbe({
      isExecutable: () => false,
      env: { AGENT_SERVER_CLAUDE_PATH: '/nope/claude' },
    });
    expect(discoverClaudeExecutable(probe)).toBeUndefined();
  });

  it('ignores the obsolete bundled-runtime opt-out', () => {
    const local = join(HOME, '.claude', 'local', 'claude');
    const probe = makeProbe({
      isExecutable: (p) => p === local,
      env: { AGENT_SERVER_USE_INSTALLED_CLAUDE: 'false' },
    });
    expect(discoverClaudeExecutable(probe)).toBe(local);
  });

  it('does not use a PATH result that is not executable', () => {
    const probe = makeProbe({
      isExecutable: () => false,
      which: () => '/broken/claude',
    });
    expect(discoverClaudeExecutable(probe)).toBeUndefined();
  });
});

describe('discoverCodexExecutable', () => {
  it('prefers a runnable user-local install over a broken PATH wrapper', () => {
    const local = join(HOME, '.nvm', 'versions', 'node', 'v24.18.0', 'bin', 'codex');
    const broken = '/opt/homebrew/bin/codex';
    const probe = makeProbe({
      isExecutable: (path) => path === local || path === broken,
      isRunnable: (path) => path === local,
      userLocalCommands: (command) => command === 'codex' ? [local] : [],
      which: (command) => command === 'codex' ? broken : undefined,
    });

    expect(discoverCodexExecutable(probe)).toBe(local);
  });

  it('resolves the PATH binary', () => {
    const onPath = '/opt/homebrew/bin/codex';
    const probe = makeProbe({
      isExecutable: (p) => p === onPath,
      isRunnable: (p) => p === onPath,
      which: (cmd) => (cmd === 'codex' ? onPath : undefined),
    });
    expect(discoverCodexExecutable(probe)).toBe(onPath);
  });

  it('returns undefined when codex is not installed', () => {
    expect(discoverCodexExecutable(makeProbe())).toBeUndefined();
  });

  it('honors an explicit AGENT_SERVER_CODEX_PATH override', () => {
    const custom = '/custom/codex';
    const probe = makeProbe({
      isExecutable: (p) => p === custom,
      isRunnable: (p) => p === custom,
      env: { AGENT_SERVER_CODEX_PATH: custom },
    });
    expect(discoverCodexExecutable(probe)).toBe(custom);
  });

  it('ignores the obsolete bundled-runtime opt-out', () => {
    const onPath = '/opt/homebrew/bin/codex';
    const probe = makeProbe({
      isExecutable: (p) => p === onPath,
      isRunnable: (p) => p === onPath,
      which: () => onPath,
      env: { AGENT_SERVER_USE_INSTALLED_CODEX: 'false' },
    });
    expect(discoverCodexExecutable(probe)).toBe(onPath);
  });
});

describe('discoverKimiExecutable', () => {
  it('prefers the standard Kimi Code installation', () => {
    const local = join(HOME, '.kimi-code', 'bin', 'kimi');
    const onPath = '/opt/homebrew/bin/kimi';
    const probe = makeProbe({
      isExecutable: (path) => path === local || path === onPath,
      which: (command) => command === 'kimi' ? onPath : undefined,
    });

    expect(discoverKimiExecutable(probe)).toBe(local);
  });

  it('falls back to an executable on PATH', () => {
    const onPath = '/opt/homebrew/bin/kimi';
    const probe = makeProbe({
      isExecutable: (path) => path === onPath,
      which: (command) => command === 'kimi' ? onPath : undefined,
    });

    expect(discoverKimiExecutable(probe)).toBe(onPath);
  });

  it('honors an executable path override', () => {
    const explicit = '/Applications/Kimi Code.app/Contents/MacOS/kimi';
    const probe = makeProbe({
      env: { AGENT_SERVER_KIMI_PATH: explicit },
      isExecutable: (path) => path === explicit,
    });

    expect(discoverKimiExecutable(probe)).toBe(explicit);
  });

  it('returns unavailable for an invalid path override without falling back', () => {
    const local = join(HOME, '.kimi-code', 'bin', 'kimi');
    const probe = makeProbe({
      env: { AGENT_SERVER_KIMI_PATH: '/missing/kimi' },
      isExecutable: (path) => path === local,
    });

    expect(discoverKimiExecutable(probe)).toBeUndefined();
  });

  it('can be disabled even when Kimi Code is installed', () => {
    const local = join(HOME, '.kimi-code', 'bin', 'kimi');
    const probe = makeProbe({
      env: { AGENT_SERVER_USE_INSTALLED_KIMI: 'false' },
      isExecutable: (path) => path === local,
    });

    expect(discoverKimiExecutable(probe)).toBeUndefined();
  });
});

describe('discoverRuntimePaths', () => {
  it('resolves all runtimes from a single probe', () => {
    const claude = join(HOME, '.claude', 'local', 'claude');
    const codex = '/opt/homebrew/bin/codex';
    const kimi = join(HOME, '.kimi-code', 'bin', 'kimi');
    const probe = makeProbe({
      isExecutable: (p) => p === claude || p === codex || p === kimi,
      isRunnable: (p) => p === codex,
      which: (cmd) => (cmd === 'codex' ? codex : undefined),
    });
    expect(discoverRuntimePaths(probe)).toEqual({
      claudeExecutablePath: claude,
      codexExecutablePath: codex,
      kimiExecutablePath: kimi,
    });
  });

  it('returns an all-undefined object when nothing is installed', () => {
    expect(discoverRuntimePaths(makeProbe())).toEqual({
      claudeExecutablePath: undefined,
      codexExecutablePath: undefined,
      kimiExecutablePath: undefined,
    });
  });
});
