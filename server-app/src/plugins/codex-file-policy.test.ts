import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { makeAgent } from '../test-factories.js';
import {
  buildCodexPermissionOverrides,
  resolveCodexCommand,
} from './codex-file-policy.js';

const execFileAsync = promisify(execFile);

describe('Codex exact file policy', () => {
  it('builds a default-deny profile with each reviewed access level', () => {
    const overrides = buildCodexPermissionOverrides(makeAgent({
      file_access: [
        { path: '/Users/test/Book/manuscript.md', kind: 'file', access: 'read_only' },
        { path: '/Users/test/Book/Output', kind: 'folder', access: 'read_write' },
      ],
    }));

    expect(overrides).toEqual([
      'default_permissions="agent-server"',
      'permissions.agent-server.filesystem={":minimal" = "read", "/Users/test/Book/manuscript.md" = "read", "/Users/test/Book/Output" = "write"}',
    ]);
  });

  it('requires an installed Codex executable', () => {
    expect(() => resolveCodexCommand()).toThrow(
      'Codex is not installed. Install Codex or choose another coding agent.',
    );
  });

  it('enforces reviewed read and write paths with the installed macOS sandbox', async () => {
    if (process.platform !== 'darwin') return;
    const root = await mkdtemp(join(tmpdir(), 'agent-server-codex-policy-'));
    const readOnly = join(root, 'read-only');
    const readWrite = join(root, 'read-write');
    const outside = join(root, 'outside');
    await Promise.all([readOnly, readWrite, outside].map((path) => mkdir(path)));
    await Promise.all([
      writeFile(join(readOnly, 'allowed.txt'), 'allowed'),
      writeFile(join(outside, 'blocked.txt'), 'blocked'),
    ]);

    try {
      const command = resolveCodexCommand(process.env.AGENT_SERVER_CODEX_PATH ?? 'codex');
      const overrides = buildCodexPermissionOverrides(makeAgent({
        file_access: [
          { path: readOnly, kind: 'folder', access: 'read_only' },
          { path: readWrite, kind: 'folder', access: 'read_write' },
        ],
      }));
      const configArgs = overrides.flatMap((override) => ['--config', override]);
      const script = [
        `test -r ${JSON.stringify(join(readOnly, 'allowed.txt'))} && echo selected-read-allowed`,
        `test ! -r ${JSON.stringify(join(outside, 'blocked.txt'))} && echo outside-read-denied`,
        `touch ${JSON.stringify(join(readOnly, 'blocked-write.txt'))} 2>/dev/null || echo read-only-write-denied`,
        `touch ${JSON.stringify(join(readWrite, 'allowed-write.txt'))} && echo selected-write-allowed`,
      ].join('; ');

      const result = await execFileAsync(command.executable, [
        ...command.arguments,
        'sandbox',
        '--permission-profile', 'agent-server',
        ...configArgs,
        '--', '/bin/zsh', '-c', script,
      ], { timeout: 10_000 });

      expect(result.stdout).toContain('selected-read-allowed');
      expect(result.stdout).toContain('outside-read-denied');
      expect(result.stdout).toContain('read-only-write-denied');
      expect(result.stdout).toContain('selected-write-allowed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
