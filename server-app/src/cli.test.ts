import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from './platform/config.js';
import { createCli, type CliDependencies } from './cli.js';

function createHarness(overrides: Partial<CliDependencies> = {}) {
  const config = loadConfig({
    AGENT_SERVER_API_KEY: 'local-test-key-with-32-characters',
  });
  const server = {
    ready: Promise.resolve(),
    stop: vi.fn().mockResolvedValue(undefined),
  };
  const dependencies: CliDependencies = {
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
  return { config, dependencies, server };
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
    expect(dependencies.startServer).toHaveBeenCalledWith(config, { anthropicApiKey: undefined });
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

    await vi.waitFor(() => expect(server.stop).toHaveBeenCalledOnce());
    expect(dependencies.exit).toHaveBeenCalledWith(0);
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
