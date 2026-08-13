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

/**
 * Every package an advisory has forced a floor onto, with the floor itself.
 * The audit only reports what is vulnerable today; this table is what stops a
 * resolved graph from sliding back under a floor once the advisory is old news.
 */
const ADVISORY_FLOORS: ReadonlyArray<readonly [string, readonly [number, number, number]]> = [
  // GHSA-96hv-2xvq-fx4p, reached through @hono/node-ws on the /ws endpoint.
  ['ws', [8, 21, 0]],
  // GHSA-88fw-hqm2-52qc plus the memo(), Language-middleware, and proxy-header
  // advisories, all fixed in 4.12.34.
  ['hono', [4, 12, 34]],
  // Path traversal in serve-static on Windows via an encoded backslash.
  ['@hono/node-server', [1, 19, 15]],
  // Host confusion in fast-uri, reached through ajv inside the MCP SDK.
  ['fast-uri', [3, 1, 5]],
  // SSRF and trust-boundary bypasses, reached through express-rate-limit.
  ['ip-address', [10, 3, 1]],
  // Response desynchronization and cache disclosure, via @slack/socket-mode.
  ['undici', [7, 29, 0]],
  // Express parser helpers the MCP SDK resolves.
  ['body-parser', [2, 3, 0]],
  ['qs', [6, 15, 2]],
];

describe('production dependency policy', () => {
  it('keeps vulnerable web-server versions out of the resolved graph', async () => {
    const manifest = PackageManifestSchema.parse(
      JSON.parse(await readRepositoryFile('server-app/package.json')),
    );

    expect(manifest.dependencies?.ws).toBeUndefined();
    expect(manifest.devDependencies?.['@types/ws']).toBeUndefined();
  });

  it.each(ADVISORY_FLOORS)('resolves every %s copy at or above its advisory floor', async (
    packageName,
    floor,
  ) => {
    const lockfile = LockfileSchema.parse(parse(await readRepositoryFile('pnpm-lock.yaml')));
    const versions = Object.keys(lockfile.packages).flatMap((key) => {
      const version = versionFromLockfileKey(packageName, key);
      return version ? [version] : [];
    });

    expect(versions.length).toBeGreaterThan(0);
    expect(versions.filter((version) => !isAtLeast(version, floor))).toEqual([]);
  });

  it('states every advisory floor as a range so patches are never pinned out', async () => {
    const settings = z
      .object({ overrides: z.record(z.string(), z.string()) })
      .parse(parse(await readRepositoryFile('pnpm-workspace.yaml')));

    // An exact override is a floor that stops rising. `hono: 4.12.30` was the
    // July remedy and by August it was holding the graph two patches below its
    // own fix, because nothing re-reads a pin once it is written.
    const exactPins = Object.entries(settings.overrides)
      .filter(([, range]) => /^\d+\.\d+\.\d+$/.test(range))
      .map(([name]) => name);

    expect(exactPins).toEqual([]);
    for (const [packageName] of ADVISORY_FLOORS) {
      expect(settings.overrides[packageName]).toBeDefined();
    }
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
