import { describe, it, expect } from 'vitest';
import { join } from 'path';
import {
  discoverClaudeExecutable,
  discoverCodexExecutable,
  discoverRuntimePaths,
  type RuntimeProbe,
} from './runtime-discovery.js';

const HOME = '/Users/tester';

function makeProbe(overrides: Partial<RuntimeProbe> = {}): RuntimeProbe {
  return {
    isExecutable: () => false,
    which: () => undefined,
    home: HOME,
    env: {},
    ...overrides,
  };
}

describe('discoverClaudeExecutable', () => {
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

  it('returns undefined (bundled) when nothing is installed', () => {
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

  it('forces bundled when AGENT_SERVER_USE_INSTALLED_CLAUDE is false', () => {
    const local = join(HOME, '.claude', 'local', 'claude');
    const probe = makeProbe({
      isExecutable: (p) => p === local,
      env: { AGENT_SERVER_USE_INSTALLED_CLAUDE: 'false' },
    });
    expect(discoverClaudeExecutable(probe)).toBeUndefined();
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
  it('resolves the PATH binary', () => {
    const onPath = '/opt/homebrew/bin/codex';
    const probe = makeProbe({
      isExecutable: (p) => p === onPath,
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
      env: { AGENT_SERVER_CODEX_PATH: custom },
    });
    expect(discoverCodexExecutable(probe)).toBe(custom);
  });

  it('forces bundled when AGENT_SERVER_USE_INSTALLED_CODEX is false', () => {
    const onPath = '/opt/homebrew/bin/codex';
    const probe = makeProbe({
      isExecutable: (p) => p === onPath,
      which: () => onPath,
      env: { AGENT_SERVER_USE_INSTALLED_CODEX: 'false' },
    });
    expect(discoverCodexExecutable(probe)).toBeUndefined();
  });
});

describe('discoverRuntimePaths', () => {
  it('resolves both runtimes from a single probe', () => {
    const claude = join(HOME, '.claude', 'local', 'claude');
    const codex = '/opt/homebrew/bin/codex';
    const probe = makeProbe({
      isExecutable: (p) => p === claude || p === codex,
      which: (cmd) => (cmd === 'codex' ? codex : undefined),
    });
    expect(discoverRuntimePaths(probe)).toEqual({
      claudeExecutablePath: claude,
      codexExecutablePath: codex,
    });
  });

  it('returns an all-undefined object when nothing is installed', () => {
    expect(discoverRuntimePaths(makeProbe())).toEqual({
      claudeExecutablePath: undefined,
      codexExecutablePath: undefined,
    });
  });
});
