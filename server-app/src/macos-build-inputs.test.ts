import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../', import.meta.url);

async function readRepositoryFile(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, repositoryRoot), 'utf8');
}

describe('macOS build inputs', () => {
  it('uses an independently authored Agent Server design-system package', async () => {
    const project = await readRepositoryFile('macos-app/project.yml');
    const packageManifest = await readRepositoryFile('macos-app/AgentServerDesignSystem/Package.swift');
    const readme = await readRepositoryFile('macos-app/AgentServerDesignSystem/README.md');
    const sourceFiles = await readdir(
      new URL('macos-app/AgentServerDesignSystem/Sources/AgentServerDesignSystem/', repositoryRoot),
      { recursive: true },
    );

    expect(project).toContain('path: AgentServerDesignSystem');
    expect(project).not.toContain('../../../../nerdsui');
    expect(project).not.toContain('NerdsUI');
    expect(packageManifest).toContain('name: "AgentServerDesignSystem"');
    expect(readme).toContain('implemented from Agent Server public call sites');
    expect(sourceFiles.filter((file) => file.endsWith('.swift')).sort()).toEqual([
      'Color+Hex.swift',
      'DesignTokens.swift',
      'Theme.swift',
    ]);
  });

  it('keeps the design-system theme contract limited to values the app reads', async () => {
    const theme = await readRepositoryFile(
      'macos-app/AgentServerDesignSystem/Sources/AgentServerDesignSystem/Theme.swift',
    );
    const palettes = await readRepositoryFile('macos-app/AgentServer/Theme/AgentServerPalettes.swift');

    for (const unusedProperty of ['displayName', 'cardForeground', 'accentForeground']) {
      expect(theme).not.toContain(unusedProperty);
      expect(palettes).not.toContain(unusedProperty);
    }
    expect(theme).not.toContain('var id:');
    expect(palettes).not.toContain('let id =');
  });

  it('uses a tracked plist template with an injected telemetry build setting', async () => {
    const project = await readRepositoryFile('macos-app/project.yml');
    const plist = await readRepositoryFile('macos-app/AgentServer/Info.plist');
    const gitignore = await readRepositoryFile('.gitignore');

    expect(project).toContain('POSTHOG_API_KEY: ""');
    expect(plist).toContain('<string>$(POSTHOG_API_KEY)</string>');
    expect(plist).not.toMatch(/<string>phc_[^<]+<\/string>/);
    expect(gitignore).not.toContain('macos-app/AgentServer/Info.plist');
  });

  it('injects the telemetry key into release archive builds without writing it to disk', async () => {
    const releaseScript = await readRepositoryFile('scripts/release.sh');

    expect(releaseScript).toContain('POSTHOG_PUBLIC_KEY=$(doppler secrets get POSTHOG_PUBLIC_KEY');
    expect(releaseScript.match(/POSTHOG_API_KEY="\$POSTHOG_PUBLIC_KEY"/g)).toHaveLength(2);
  });

  it('hands the daemon the app identity and never the opt-out preference', async () => {
    const telemetry = await readRepositoryFile('macos-app/AgentServer/Services/Telemetry.swift');
    const processManager = await readRepositoryFile(
      'macos-app/AgentServer/Services/ServerProcessManager.swift',
    );

    // The daemon is spawned once and can outlive many trips through Settings,
    // so the identity travels through the environment and the opt-out does not.
    expect(telemetry).toContain('AGENT_SERVER_ANALYTICS_KEY');
    expect(telemetry).toContain('AGENT_SERVER_ANALYTICS_DISTINCT_ID');
    expect(processManager).toContain('Telemetry.childProcessEnvironment()');

    const childEnvironment = telemetry.slice(
      telemetry.indexOf('static func childProcessEnvironment'),
      telemetry.indexOf('static func reason'),
    );
    expect(childEnvironment).not.toContain('AGENT_SERVER_ANALYTICS_OPT_OUT');
    expect(telemetry).toContain('private static func writeDaemonOptOut');
  });

  it('routes every analytics call site through the swappable destination array', async () => {
    const telemetry = await readRepositoryFile('macos-app/AgentServer/Services/Telemetry.swift');
    const captureSites = await readRepositoryFile(
      'macos-app/AgentServer/Services/StatusMonitor.swift',
    );

    expect(telemetry).toContain('protocol TelemetryDestination');
    expect(telemetry).toContain('private static var destinations: [TelemetryDestination]');
    // Only the facade knows a provider exists.
    expect(captureSites).not.toContain('import PostHog');
    expect(captureSites).not.toContain('PostHogSDK');
    // Event names come from the catalog, never a literal.
    expect(captureSites).not.toMatch(/Telemetry\.capture\("/);
  });

  it('fails the app build when the required EventKit helper is missing', async () => {
    const project = await readRepositoryFile('macos-app/project.yml');

    expect(project).toMatch(
      /if \[ ! -f "\$HELPER_SRC" \]; then\s+echo "error: agent-server-eventkit not built at \$HELPER_SRC"\s+exit 1\s+fi/,
    );
  });

  it('ships SDK adapters without bundled Claude or Codex platform runtimes', async () => {
    const project = await readRepositoryFile('macos-app/project.yml');
    const pruningScript = await readRepositoryFile('scripts/prune-bundled-runtimes.sh');

    expect(project).toContain('scripts/prune-bundled-runtimes.sh');
    expect(project).toContain('SLIM_RUNTIME_RECIPE_VERSION=');
    expect(pruningScript).toContain('@anthropic-ai/claude-agent-sdk-darwin-*');
    expect(pruningScript).toContain('@openai/codex-darwin-*');
    expect(pruningScript).not.toContain('@anthropic-ai/claude-agent-sdk"');
    expect(pruningScript).not.toContain('@openai/codex-sdk"');
  });
});
