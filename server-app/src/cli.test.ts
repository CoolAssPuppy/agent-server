import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from './platform/config.js';
import { createCli, type CliDependencies } from './cli.js';
import { makeRecordingAnalytics } from './test-factories.js';

function createHarness(overrides: Partial<CliDependencies> = {}) {
  const config = loadConfig({
    AGENT_SERVER_API_KEY: 'local-test-key-with-32-characters',
  });
  const server = {
    ready: Promise.resolve(),
    stop: vi.fn().mockResolvedValue(undefined),
  };
  const analytics = makeRecordingAnalytics();
  const dependencies: CliDependencies = {
    analytics,
    now: vi.fn().mockReturnValue(0),
    baseDir: '/tmp/agent-server-test',
    argv: ['node', '/opt/bin/agent-server'],
    env: {},
    output: { log: vi.fn(), error: vi.fn() },
    initAgentServer: vi.fn(),
    loadEnvFile: vi.fn().mockReturnValue({ AGENT_SERVER_API_KEY: 'reloaded-key' }),
    loadConfig: vi.fn().mockReturnValue(config),
    startFileLogger: vi.fn().mockResolvedValue(undefined),
    startServer: vi.fn().mockReturnValue(server),
    runSingleAgent: vi.fn().mockResolvedValue(undefined),
    listAgents: vi.fn().mockResolvedValue(undefined),
    createPanelClient: vi.fn().mockReturnValue(null),
    runCleanupCommand: vi.fn().mockResolvedValue(0),
    installLaunchAgent: vi.fn().mockReturnValue('/tmp/agent-server.plist'),
    uninstallLaunchAgent: vi.fn(),
    onSignal: vi.fn(),
    exit: vi.fn(),
    setExitCode: vi.fn(),
    ...overrides,
  };
  return { config, dependencies, server, analytics };
}

async function parse(dependencies: CliDependencies, args: string[]): Promise<void> {
  await createCli(dependencies).parseAsync(['node', 'agent-server', ...args]);
}

describe('createCli', () => {
  it('wires start without spawning a real daemon', async () => {
    const { config, dependencies, server } = createHarness();

    await parse(dependencies, ['start']);

    expect(dependencies.initAgentServer).toHaveBeenCalledWith(dependencies.baseDir);
    expect(dependencies.loadEnvFile).toHaveBeenCalledWith(dependencies.baseDir, dependencies.env);
    expect(dependencies.env).toMatchObject({ AGENT_SERVER_API_KEY: 'reloaded-key' });
    expect(dependencies.startFileLogger).toHaveBeenCalledWith(config.logsDir);
    expect(dependencies.startServer).toHaveBeenCalledWith(config, {
      anthropicApiKey: undefined,
      analytics: dependencies.analytics,
    });
    expect(dependencies.onSignal).toHaveBeenCalledTimes(2);
    expect(server.stop).not.toHaveBeenCalled();
  });

  it('stops once when repeated shutdown signals arrive', async () => {
    const signalHandlers = new Map<string, () => void>();
    const { dependencies, server } = createHarness({
      onSignal: vi.fn((signal: string, listener: () => void) => {
        signalHandlers.set(signal, listener);
      }),
    });
    await parse(dependencies, ['start']);

    signalHandlers.get('SIGINT')?.();
    signalHandlers.get('SIGTERM')?.();

    await vi.waitFor(() => expect(dependencies.exit).toHaveBeenCalledWith(0));
    expect(server.stop).toHaveBeenCalledOnce();
  });

  it('reports a failed signal shutdown with a nonzero exit', async () => {
    const signalHandlers = new Map<string, () => void>();
    const server = {
      ready: Promise.resolve(),
      stop: vi.fn().mockRejectedValue(new Error('cleanup failed')),
    };
    const { dependencies } = createHarness({
      startServer: vi.fn().mockReturnValue(server),
      onSignal: vi.fn((signal: string, listener: () => void) => {
        signalHandlers.set(signal, listener);
      }),
    });
    await parse(dependencies, ['start']);

    signalHandlers.get('SIGTERM')?.();

    await vi.waitFor(() => expect(dependencies.exit).toHaveBeenCalledWith(1));
    expect(dependencies.output.error).toHaveBeenCalledWith(
      '[shutdown] error: cleanup failed',
    );
  });

  it('stops and surfaces a startup readiness failure', async () => {
    const startupError = new Error('startup failed');
    const server = {
      ready: Promise.reject(startupError),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const { dependencies } = createHarness({
      startServer: vi.fn().mockReturnValue(server),
    });

    await expect(parse(dependencies, ['start'])).rejects.toThrow('startup failed');
    expect(server.stop).toHaveBeenCalledOnce();
  });

  it('preserves the startup error when startup cleanup also fails', async () => {
    const server = {
      ready: Promise.reject(new Error('startup failed')),
      stop: vi.fn().mockRejectedValue(new Error('cleanup failed')),
    };
    const { dependencies } = createHarness({
      startServer: vi.fn().mockReturnValue(server),
    });

    await expect(parse(dependencies, ['start'])).rejects.toThrow('startup failed');
    expect(dependencies.output.error).toHaveBeenCalledWith(
      '[startup] cleanup error: cleanup failed',
    );
  });

  it('passes run arguments and optional context to the runtime', async () => {
    const { config, dependencies } = createHarness();

    await parse(dependencies, ['run', 'daily-report', '--with', 'Use the latest figures']);

    expect(dependencies.runSingleAgent).toHaveBeenCalledWith(config, 'daily-report', {
      promptSuffix: 'Use the latest figures',
    });
  });

  it('wires list and init to their production operations', async () => {
    const listHarness = createHarness();
    await parse(listHarness.dependencies, ['list']);
    expect(listHarness.dependencies.listAgents).toHaveBeenCalledWith(listHarness.config);

    const initHarness = createHarness();
    await parse(initHarness.dependencies, ['init']);
    expect(initHarness.dependencies.initAgentServer).toHaveBeenCalledWith(
      initHarness.dependencies.baseDir,
      { verbose: true },
    );
  });

  it('wires cleanup and preserves its nonzero exit status', async () => {
    const { dependencies } = createHarness({
      runCleanupCommand: vi.fn().mockResolvedValue(1),
    });

    await parse(dependencies, ['cleanup']);

    expect(dependencies.createPanelClient).toHaveBeenCalledOnce();
    expect(dependencies.runCleanupCommand).toHaveBeenCalledWith(null, dependencies.output);
    expect(dependencies.setExitCode).toHaveBeenCalledWith(1);
  });

  it('wires install using the executable path and configured log directory', async () => {
    const { config, dependencies } = createHarness();

    await parse(dependencies, ['install']);

    expect(dependencies.installLaunchAgent).toHaveBeenCalledWith({
      cliPath: '/opt/bin/agent-server',
      logsDir: config.logsDir,
    });
    expect(dependencies.output.log).toHaveBeenCalledWith(
      'LaunchAgent installed: /tmp/agent-server.plist',
    );
  });

  it('wires uninstall without touching the real LaunchAgent', async () => {
    const { dependencies } = createHarness();

    await parse(dependencies, ['uninstall']);

    expect(dependencies.uninstallLaunchAgent).toHaveBeenCalledOnce();
    expect(dependencies.output.log).toHaveBeenCalledWith('LaunchAgent removed.');
  });
});

describe('CLI analytics', () => {
  it('names the invoked verb on every command', async () => {
    for (const command of ['list', 'init', 'cleanup', 'install', 'uninstall'] as const) {
      const { dependencies, analytics } = createHarness();

      await parse(dependencies, [command]);

      expect(analytics.captured[0]).toEqual({
        event: 'cli_command_invoked',
        properties: { command },
      });
    }
  });

  it('records a started server with its configured surfaces but no secrets', async () => {
    const { dependencies, analytics } = createHarness();

    await parse(dependencies, ['start']);

    const started = analytics.captured.find(({ event }) => event === 'server_started');
    expect(started?.properties).toEqual({
      port: 47821,
      catch_up: false,
      panel_enabled: false,
      slack_configured: false,
      telegram_configured: false,
    });
  });

  it('records a stopped server with the signal and uptime', async () => {
    const signalHandlers = new Map<string, () => void>();
    const elapsed = [0, 5_000];
    const { dependencies, analytics } = createHarness({
      now: vi.fn(() => elapsed.shift() ?? 5_000),
      onSignal: vi.fn((signal: string, listener: () => void) => {
        signalHandlers.set(signal, listener);
      }),
    });
    await parse(dependencies, ['start']);

    signalHandlers.get('SIGTERM')?.();

    await vi.waitFor(() => expect(dependencies.exit).toHaveBeenCalledWith(0));
    expect(analytics.captured.at(-1)).toEqual({
      event: 'server_stopped',
      properties: { signal: 'SIGTERM', exit_code: 0, uptime_seconds: 5 },
    });
  });

  it('classifies a startup failure without repeating its message', async () => {
    const { dependencies, analytics } = createHarness({
      startServer: vi.fn().mockReturnValue({
        ready: Promise.reject(
          Object.assign(new Error('listen EADDRINUSE: address already in use'), {
            code: 'EADDRINUSE',
          }),
        ),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
    });

    await expect(parse(dependencies, ['start'])).rejects.toThrow('EADDRINUSE');

    expect(analytics.captured).toContainEqual({
      event: 'server_start_failed',
      properties: { reason: 'eaddrinuse' },
    });
    expect(analytics.captured).toContainEqual({
      event: 'cli_command_failed',
      properties: { command: 'start', reason: 'eaddrinuse' },
    });
  });

  it('marks the workspace and LaunchAgent transitions', async () => {
    const initHarness = createHarness();
    await parse(initHarness.dependencies, ['init']);
    expect(initHarness.analytics.names()).toContain('workspace_initialized');

    const installHarness = createHarness();
    await parse(installHarness.dependencies, ['install']);
    expect(installHarness.analytics.captured).toContainEqual({
      event: 'launch_agent_changed',
      properties: { action: 'installed' },
    });

    const uninstallHarness = createHarness();
    await parse(uninstallHarness.dependencies, ['uninstall']);
    expect(uninstallHarness.analytics.captured).toContainEqual({
      event: 'launch_agent_changed',
      properties: { action: 'removed' },
    });
  });
});
