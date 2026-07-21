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
  packageManager: z.string(),
});

const MacOSProjectSchema = z.object({
  targets: z.object({
    AgentServer: z.object({
      settings: z.object({
        base: z.object({
          MARKETING_VERSION: z.union([z.string(), z.number()]),
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

function pnpmVersion(packageManager: string): string {
  const match = packageManager.match(/^pnpm@(\d+(?:\.\d+)*)/);
  if (!match?.[1]) throw new Error(`Unsupported package manager: ${packageManager}`);
  return match[1];
}

describe('release documentation policy', () => {
  it('documents runtime and production bundle requirements from repository manifests', async () => {
    const manifest = RootManifestSchema.parse(
      JSON.parse(await readRepositoryFile('package.json')),
    );
    const project = MacOSProjectSchema.parse(
      parse(await readRepositoryFile('macos-app/project.yml')),
    );
    const readme = await readRepositoryFile('README.md');
    const nodeMinimum = minimumVersion(manifest.engines.node);
    const pnpmMinimum = minimumVersion(manifest.engines.pnpm);
    const configuredPnpmVersion = pnpmVersion(manifest.packageManager);
    const bundleScript = project.targets.AgentServer.preBuildScripts
      .map(({ script }) => script)
      .find((script) => script.includes('pnpm --filter @agent-server/core deploy'));

    expect(configuredPnpmVersion.startsWith(`${pnpmMinimum}.`)).toBe(true);
    expect(bundleScript).toBeDefined();
    expect(bundleScript).toContain('pnpm-lock.yaml');
    expect(bundleScript).toContain('pnpm --filter @agent-server/core deploy --prod --legacy');
    expect(readme).toContain(`Node.js ${nodeMinimum}+`);
    expect(readme).toContain(`pnpm ${pnpmMinimum}+`);
    expect(readme).toContain('pnpm-lock.yaml');
    expect(readme).toContain('pnpm --filter @agent-server/core deploy --prod --legacy');
    expect(readme).not.toContain('Node.js 20+');
    expect(readme).not.toContain('package-lock.json');
    expect(readme).not.toMatch(/# \d+ tests\b/);
    expect(readme).not.toContain('No third-party dependencies');
  });

  it('keeps one current R2 and DMG release guide', async () => {
    const project = MacOSProjectSchema.parse(
      parse(await readRepositoryFile('macos-app/project.yml')),
    );
    const releaseGuide = await readRepositoryFile('docs/SPARKLE.md');
    const macOSGuide = await readRepositoryFile('macos-app/SPARKLE.md');
    const readme = await readRepositoryFile('README.md');
    const buildDmg = await readRepositoryFile('scripts/build-dmg.sh');
    const currentVersion = String(
      project.targets.AgentServer.settings.base.MARKETING_VERSION,
    );

    expect(releaseGuide).toContain('Cloudflare R2');
    expect(releaseGuide).toContain('AgentServer-<version>.dmg');
    expect(releaseGuide).toContain('apps/agent-server/appcast.xml');
    expect(releaseGuide).toContain(`./scripts/release.sh ${currentVersion}`);
    expect(releaseGuide).not.toContain('Supabase');
    expect(releaseGuide).not.toMatch(/\.zip\b/i);
    expect(macOSGuide).toContain('../docs/SPARKLE.md');
    expect(macOSGuide.trim().split('\n').length).toBeLessThanOrEqual(8);
    expect(readme).toContain('[Sparkle release guide](docs/SPARKLE.md)');
    expect(readme).toContain(`./scripts/release.sh ${currentVersion}`);
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
