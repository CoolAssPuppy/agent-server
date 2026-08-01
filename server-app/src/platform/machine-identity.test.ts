import { randomUUID } from 'crypto';
import { lstatSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { createTempDir } from '../test-factories.js';
import { loadOrCreateMachineId } from './machine-identity.js';

const workspaces: string[] = [];

function createWorkspace(label: string): string {
  const workspace = createTempDir(`machine-identity-${label}`);
  workspaces.push(workspace);
  return workspace;
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe('loadOrCreateMachineId', () => {
  it('creates one owner-only UUID in the Agent Server workspace', () => {
    const workspace = createWorkspace('create');

    const machineId = loadOrCreateMachineId(workspace);

    expect(machineId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(readFileSync(join(workspace, 'machine-id'), 'utf8')).toBe(`${machineId}\n`);
    expect(statSync(join(workspace, 'machine-id')).mode & 0o777).toBe(0o600);
  });

  it('returns the same identity across restarts', () => {
    const workspace = createWorkspace('stable');

    const first = loadOrCreateMachineId(workspace);
    const second = loadOrCreateMachineId(workspace);

    expect(second).toBe(first);
  });

  it('keeps identities scoped to their Agent Server workspace', () => {
    const firstWorkspace = createWorkspace('first');
    const secondWorkspace = createWorkspace('second');

    expect(loadOrCreateMachineId(firstWorkspace)).not.toBe(loadOrCreateMachineId(secondWorkspace));
  });

  it('preserves an existing valid identity and tightens its permissions', () => {
    const workspace = createWorkspace('existing');
    const machineId = randomUUID();
    const path = join(workspace, 'machine-id');
    writeFileSync(path, `${machineId}\n`, { mode: 0o644 });

    expect(loadOrCreateMachineId(workspace)).toBe(machineId);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('refuses to replace a corrupt identity', () => {
    const workspace = createWorkspace('corrupt');
    const path = join(workspace, 'machine-id');
    writeFileSync(path, 'not-a-machine-id\n');

    expect(() => loadOrCreateMachineId(workspace)).toThrow('invalid machine identity');
    expect(readFileSync(path, 'utf8')).toBe('not-a-machine-id\n');
  });

  it('refuses a symbolic link instead of following it', () => {
    const workspace = createWorkspace('symlink');
    const target = join(workspace, 'target');
    writeFileSync(target, `${randomUUID()}\n`);
    symlinkSync(target, join(workspace, 'machine-id'));

    expect(() => loadOrCreateMachineId(workspace)).toThrow('must be a regular file');
    expect(lstatSync(join(workspace, 'machine-id')).isSymbolicLink()).toBe(true);
  });

  it('creates a missing workspace before persisting identity', () => {
    const parent = createWorkspace('parent');
    const workspace = join(parent, 'nested', 'workspace');

    const machineId = loadOrCreateMachineId(workspace);

    expect(readFileSync(join(workspace, 'machine-id'), 'utf8')).toBe(`${machineId}\n`);
  });
});
