import { describe, it, expect } from 'vitest';
import { createReporter } from './reporter-factory.js';
import { TelemetryReporter } from './reporter.js';
import type { ServerConfig } from '../platform/config.js';

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    agentsDir: '/tmp/agents',
    lockDir: '/tmp/locks',
    logsDir: '/tmp/logs',
    panelUrl: 'https://panel.example.com',
    panelApiKey: 'ap_live_test_key',
    checkIntervalMs: 60_000,
    heartbeatMs: 20_000,
    telemetryProgressMode: 'live',
    telemetryProgressSampleMs: 5_000,
    telemetryProgressMaxEntries: 50,
    telemetryProgressIncludeMetadata: false,
    port: 47821,
    host: '127.0.0.1',
    catchUp: false,
    maxConcurrentRuns: 8,
    maxWebSocketClients: 100,
    runTimeoutMs: 30 * 60 * 1000,
    ...overrides,
  };
}

/**
 * Read the resolved internal config of a TelemetryReporter so tests can
 * verify which precedence layer (agent > server > default) won.
 */
function readReporterConfig(reporter: ReturnType<typeof createReporter>): {
  progressMode: 'live' | 'batched';
  progressSampleMs: number;
  maxProgressEntries: number;
  includeProgressMetadata: boolean;
} {
  const inner = (reporter as unknown as { config: Record<string, unknown> }).config;
  return {
    progressMode: inner.progressMode as 'live' | 'batched',
    progressSampleMs: inner.progressSampleMs as number,
    maxProgressEntries: inner.maxProgressEntries as number,
    includeProgressMetadata: inner.includeProgressMetadata as boolean,
  };
}

describe('createReporter telemetry precedence', () => {
  it('returns a noop reporter when panel is not configured', () => {
    const config = makeConfig({ panelUrl: undefined, panelApiKey: undefined });
    const reporter = createReporter(config, 'run-1', 'Test');
    // Noop has no `config` field, so `readReporterConfig` would throw.
    expect(reporter).not.toBeInstanceOf(TelemetryReporter);
  });

  it('uses server config values when no agent override is provided', () => {
    const config = makeConfig({
      telemetryProgressMode: 'batched',
      telemetryProgressSampleMs: 7_000,
      telemetryProgressMaxEntries: 25,
      telemetryProgressIncludeMetadata: true,
    });
    const reporter = createReporter(config, 'run-1', 'Test');
    const resolved = readReporterConfig(reporter);
    expect(resolved.progressMode).toBe('batched');
    expect(resolved.progressSampleMs).toBe(7_000);
    expect(resolved.maxProgressEntries).toBe(25);
    expect(resolved.includeProgressMetadata).toBe(true);
  });

  it('agent telemetry overrides server config field by field', () => {
    const config = makeConfig({
      telemetryProgressMode: 'live',
      telemetryProgressSampleMs: 5_000,
      telemetryProgressMaxEntries: 50,
      telemetryProgressIncludeMetadata: false,
    });
    const reporter = createReporter(config, 'run-1', 'Test', {
      agentTelemetry: {
        progress_mode: 'batched',
        progress_sample_ms: 10_000,
      },
    });
    const resolved = readReporterConfig(reporter);
    // Agent-set fields win.
    expect(resolved.progressMode).toBe('batched');
    expect(resolved.progressSampleMs).toBe(10_000);
    // Unset fields fall through to server config.
    expect(resolved.maxProgressEntries).toBe(50);
    expect(resolved.includeProgressMetadata).toBe(false);
  });

  it('agent telemetry can fully override every field', () => {
    const config = makeConfig();
    const reporter = createReporter(config, 'run-1', 'Test', {
      agentTelemetry: {
        progress_mode: 'batched',
        progress_sample_ms: 30_000,
        progress_max_entries: 5,
        progress_include_metadata: true,
      },
    });
    const resolved = readReporterConfig(reporter);
    expect(resolved.progressMode).toBe('batched');
    expect(resolved.progressSampleMs).toBe(30_000);
    expect(resolved.maxProgressEntries).toBe(5);
    expect(resolved.includeProgressMetadata).toBe(true);
  });
});
