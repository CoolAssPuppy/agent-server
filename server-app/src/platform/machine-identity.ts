import { randomUUID } from 'crypto';
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

const MACHINE_ID_FILE = 'machine-id';
const MACHINE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Return the stable identity owned by one Agent Server workspace, creating it
 * once when needed. Invalid or redirected identity files are never replaced.
 */
export function loadOrCreateMachineId(workspaceDir: string): string {
  mkdirSync(workspaceDir, { recursive: true, mode: 0o700 });
  const identityPath = join(workspaceDir, MACHINE_ID_FILE);

  if (pathExists(identityPath)) {
    return readMachineId(identityPath);
  }

  createMachineId(identityPath);
  return readMachineId(identityPath);
}

function createMachineId(identityPath: string): void {
  const machineId = randomUUID();
  const temporaryPath = `${identityPath}.${process.pid}.${randomUUID()}.tmp`;

  try {
    writeFileSync(temporaryPath, `${machineId}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    try {
      linkSync(temporaryPath, identityPath);
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
    }
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function readMachineId(identityPath: string): string {
  const identityFile = lstatSync(identityPath);
  if (!identityFile.isFile() || identityFile.isSymbolicLink()) {
    throw new Error('The machine identity must be a regular file');
  }

  const machineId = readFileSync(identityPath, 'utf8').trim();
  if (!MACHINE_ID_PATTERN.test(machineId)) {
    throw new Error('Agent Server found an invalid machine identity');
  }

  chmodSync(identityPath, 0o600);
  return machineId;
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isFileExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
