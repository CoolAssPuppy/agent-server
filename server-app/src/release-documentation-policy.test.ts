import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const repositoryRoot = new URL('../../', import.meta.url);

const RootManifestSchema = z.object({
  engines: z.object({
    node: z.string(),
    pnpm: z.string(),
  }),
});

const ServerManifestSchema = z.object({
  version: z.string(),
});

const MacOSProjectSchema = z.object({
  targets: z.object({
    AgentServer: z.object({
      settings: z.object({
        base: z.object({
          MARKETING_VERSION: z.string(),
        }),
      }),
      preBuildScripts: z.array(z.object({ script: z.string() })),
    }),
  }),
});

async function readRepositoryFile(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, repositoryRoot), 'utf8');
}

function minimumVersion(engineRequirement: string): string {
  const match = engineRequirement.match(/^>=(\d+(?:\.\d+)*)$/);
  if (!match?.[1]) throw new Error(`Unsupported engine requirement: ${engineRequirement}`);
  return match[1];
}

function scriptCommand(script: string, commandPrefix: string): string {
  const command = script
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith(commandPrefix));
  if (!command) throw new Error(`Command not found in project script: ${commandPrefix}`);
  return command;
}

describe('release documentation policy', () => {
  it('documents runtime and production bundle requirements from repository manifests', async () => {
    const manifest = RootManifestSchema.parse(
      JSON.parse(await readRepositoryFile('package.json')),
    );
    const serverManifest = ServerManifestSchema.parse(
      JSON.parse(await readRepositoryFile('server-app/package.json')),
    );
    const project = MacOSProjectSchema.parse(
      parse(await readRepositoryFile('macos-app/project.yml')),
    );
    const readme = await readRepositoryFile('README.md');
    const nodeMinimum = minimumVersion(manifest.engines.node);
    const pnpmMinimum = minimumVersion(manifest.engines.pnpm);
    const bundleScript = project.targets.AgentServer.preBuildScripts
      .map(({ script }) => script)
      .find((script) => script.includes('pnpm --filter @agent-server/core deploy'));
    if (!bundleScript) {
      throw new Error('Production bundle script not found in macos-app/project.yml');
    }
    const bundleCommand = scriptCommand(
      bundleScript,
      'pnpm --filter @agent-server/core deploy',
    );

    expect(serverManifest.version).toBe(
      project.targets.AgentServer.settings.base.MARKETING_VERSION,
    );
    expect(bundleScript).toContain('pnpm-lock.yaml');
    expect(readme).toContain(`Node.js ${nodeMinimum}+`);
    expect(readme).toContain(`pnpm ${pnpmMinimum}+`);
    expect(readme).toContain('pnpm-lock.yaml');
    expect(readme).toContain(bundleCommand);
    expect(readme).not.toContain('Node.js 20+');
    expect(readme).not.toContain('package-lock.json');
    expect(readme).not.toMatch(/# \d+ tests\b/);
    expect(readme).not.toContain('No third-party dependencies');
  });

  it('keeps one canonical R2 and DMG release guide', async () => {
    const releaseGuide = await readRepositoryFile('docs/SPARKLE.md');
    const macOSGuide = await readRepositoryFile('macos-app/SPARKLE.md');
    const readme = await readRepositoryFile('README.md');
    const buildDmg = await readRepositoryFile('scripts/build-dmg.sh');

    expect(releaseGuide).toContain('Cloudflare R2');
    expect(releaseGuide).toContain('AgentServer-<version>.dmg');
    expect(releaseGuide).toContain('apps/agent-server/appcast.xml');
    expect(releaseGuide).toContain('./scripts/release.sh <version> "<release notes HTML>"');
    expect(releaseGuide).toContain('immutable DMG');
    expect(releaseGuide).toContain('live appcast');
    expect(releaseGuide).not.toContain('Supabase');
    expect(releaseGuide).not.toMatch(/\.zip\b/i);
    expect(macOSGuide).toContain('../docs/SPARKLE.md');
    expect(macOSGuide).not.toContain('Cloudflare R2');
    expect(macOSGuide).not.toContain('./scripts/release.sh');
    expect(readme).toContain('[Sparkle release guide](docs/SPARKLE.md)');
    expect(readme).not.toContain('./scripts/release.sh');
    expect(buildDmg).toContain('docs/SPARKLE.md');
    expect(buildDmg).not.toContain('Supabase');
  });

  it('runs the Python release policy tests in CI', async () => {
    const workflow = await readRepositoryFile('.github/workflows/ci.yml');

    expect(workflow).toContain(
      "python3 -m unittest discover -s scripts/tests -p 'test_*.py'",
    );
  });
});
