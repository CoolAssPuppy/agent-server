import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../', import.meta.url);

async function readRepositoryFile(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, repositoryRoot), 'utf8');
}

describe('macOS build inputs', () => {
  it('uses an independently authored local design compatibility package', async () => {
    const project = await readRepositoryFile('macos-app/project.yml');
    const packageManifest = await readRepositoryFile('macos-app/Vendor/NerdsUI/Package.swift');
    const readme = await readRepositoryFile('macos-app/Vendor/NerdsUI/README.md');
    const sourceFiles = await readdir(
      new URL('macos-app/Vendor/NerdsUI/Sources/NerdsUI/', repositoryRoot),
      { recursive: true },
    );

    expect(project).toContain('path: Vendor/NerdsUI');
    expect(project).not.toContain('../../../../nerdsui');
    expect(packageManifest).toContain('name: "NerdsUI"');
    expect(readme).toContain('implemented from Agent Server public call sites');
    expect(sourceFiles.filter((file) => file.endsWith('.swift')).sort()).toEqual([
      'Color+Hex.swift',
      'DesignTokens.swift',
      'Theme.swift',
    ]);
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
});
