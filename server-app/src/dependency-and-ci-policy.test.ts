import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const repositoryRoot = new URL('../../', import.meta.url);

const PackageManifestSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

const LockfileSchema = z.object({
  packages: z.record(z.string(), z.unknown()),
});

const WorkspaceSettingsSchema = z.object({
  minimumReleaseAge: z.number(),
  minimumReleaseAgeStrict: z.boolean(),
});

async function readRepositoryFile(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, repositoryRoot), 'utf8');
}

function versionFromLockfileKey(packageName: string, key: string): string | null {
  const prefix = `${packageName}@`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

function isAtLeast(version: string, minimum: readonly [number, number, number]): boolean {
  const parts = version.split('.').map(Number);
  if (parts.length < 3 || parts.some((part) => !Number.isInteger(part))) return false;

  return minimum.every((minimumPart, index) => {
    const priorPartsMatch = minimum.slice(0, index).every((part, priorIndex) => parts[priorIndex] === part);
    return !priorPartsMatch || (parts[index] ?? -1) >= minimumPart;
  });
}

describe('production dependency policy', () => {
  it('keeps vulnerable web-server versions out of the resolved graph', async () => {
    const manifest = PackageManifestSchema.parse(
      JSON.parse(await readRepositoryFile('server-app/package.json')),
    );
    const lockfile = LockfileSchema.parse(parse(await readRepositoryFile('pnpm-lock.yaml')));
    const packageKeys = Object.keys(lockfile.packages);
    const wsVersions = packageKeys.flatMap((key) => {
      const version = versionFromLockfileKey('ws', key);
      return version ? [version] : [];
    });
    const honoVersions = packageKeys.flatMap((key) => {
      const version = versionFromLockfileKey('hono', key);
      return version ? [version] : [];
    });

    expect(manifest.dependencies?.ws).toBeUndefined();
    expect(manifest.devDependencies?.['@types/ws']).toBeUndefined();
    expect(wsVersions.length).toBeGreaterThan(0);
    expect(wsVersions.every((version) => isAtLeast(version, [8, 21, 0]))).toBe(true);
    expect(honoVersions.length).toBeGreaterThan(0);
    expect(honoVersions.every((version) => isAtLeast(version, [4, 12, 25]))).toBe(true);
  });

  it('enforces the seven-day package quarantine through pnpm workspace settings', async () => {
    const settings = WorkspaceSettingsSchema.parse(
      parse(await readRepositoryFile('pnpm-workspace.yaml')),
    );

    expect(settings.minimumReleaseAge).toBe(10_080);
    expect(settings.minimumReleaseAgeStrict).toBe(true);
  });
});

describe('continuous integration policy', () => {
  it('audits production dependencies and validates every shipped runtime', async () => {
    const workflow = await readRepositoryFile('.github/workflows/ci.yml');
    const actionReferences = [...workflow.matchAll(/uses: [^@\s]+@([^\s]+)/g)].map((match) => match[1]);

    expect(workflow).toContain("- 'server-app/**'");
    expect(workflow).toContain("- 'macos-app/**'");
    expect(workflow).toContain("- 'scripts/**'");
    expect(workflow).toContain("- 'dist/appcast.xml'");
    expect(workflow).toContain('run: pnpm run audit:prod');
    expect(workflow).toContain('run: swift test --package-path macos-app/AgentServerSwiftTests');
    expect(workflow).toContain('run: swift test --package-path macos-app/AgentServerDesignSystem');
    expect(workflow).toContain('CODE_SIGNING_ALLOWED=NO');
    expect(workflow).toContain('CODE_SIGNING_REQUIRED=NO');
    expect(actionReferences.length).toBeGreaterThan(0);
    expect(actionReferences.every((reference) => /^[a-f0-9]{40}$/.test(reference))).toBe(true);
  });
});
