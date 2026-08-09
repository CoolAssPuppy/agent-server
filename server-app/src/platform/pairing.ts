import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { hostname } from 'os';
import { join } from 'path';

import { toErrorMessage } from '../util/errors.js';

/**
 * Exchanging a pairing code for a credential of this machine's own.
 *
 * Until now the only way to connect to Panel was an organization API key
 * pasted into an environment variable. That works, and it is why nothing has
 * ever been paired, but it cannot say which machine is speaking. Panel could
 * therefore never address a job to one Mac rather than another, and its own
 * pairing screen handed out codes that nothing could redeem.
 *
 * A pairing code is proof enough on its own: single use, short lived, and
 * bound to one organization. It is exchanged for a credential that names this
 * machine, and Panel keeps only a hash of it.
 */

const CREDENTIAL_FILE = 'panel-credential.json';
const PROTOCOL_VERSION = 2;

export type PairingRecord = {
  credential: string;
  orgId: string;
  machineId: string;
  displayName: string;
  pairedAt: string;
  heartbeatIntervalSeconds: number;
};

export type PairingResult =
  | { ok: true; record: PairingRecord }
  | { ok: false; error: string };

function credentialPath(workspaceDir: string): string {
  return join(workspaceDir, CREDENTIAL_FILE);
}

/**
 * The credential this machine holds, or undefined when it has never paired.
 *
 * A file that cannot be read or parsed is reported as absent rather than
 * thrown: an unpaired daemon and a daemon with a corrupt credential should
 * both fall back to the API key and keep working.
 */
export function loadPairing(workspaceDir: string): PairingRecord | undefined {
  const path = credentialPath(workspaceDir);
  if (!existsSync(path)) return undefined;

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<PairingRecord>;
    if (!parsed.credential || !parsed.orgId || !parsed.machineId) return undefined;

    return {
      credential: parsed.credential,
      orgId: parsed.orgId,
      machineId: parsed.machineId,
      displayName: parsed.displayName ?? hostname(),
      pairedAt: parsed.pairedAt ?? new Date().toISOString(),
      heartbeatIntervalSeconds: parsed.heartbeatIntervalSeconds ?? 60,
    };
  } catch {
    return undefined;
  }
}

/**
 * Writes the credential with owner-only permissions, through a temporary file,
 * so a crash mid-write cannot leave a half-written credential behind.
 */
export function savePairing(workspaceDir: string, record: PairingRecord): void {
  mkdirSync(workspaceDir, { recursive: true, mode: 0o700 });

  const path = credentialPath(workspaceDir);
  const temporary = `${path}.${process.pid}.tmp`;

  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

/** Forgets the credential. Panel is told separately, by unpairing there. */
export function clearPairing(workspaceDir: string): void {
  const path = credentialPath(workspaceDir);
  if (existsSync(path)) unlinkSync(path);
}

/** Codes are shown in groups and typed by hand, so spacing and case are noise. */
export function normalizePairingCode(raw: string): string {
  return raw.trim().replace(/[\s-]/g, '').toUpperCase();
}

/**
 * Redeems a code with Panel.
 *
 * Never throws. This is called from a text field with somebody watching, so
 * every failure has to come back as a sentence that says what to do next.
 */
export async function redeemPairingCode(options: {
  code: string;
  panelUrl: string;
  machineId: string;
  serverVersion: string;
  displayName?: string;
  fetch?: typeof globalThis.fetch;
}): Promise<PairingResult> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const code = normalizePairingCode(options.code);

  if (code.length < 6) {
    return { ok: false, error: 'That code is too short. It should be 8 characters.' };
  }

  const displayName = options.displayName?.trim() || hostname();

  let response: Response;
  try {
    response = await fetchFn(`${options.panelUrl}/api/machines/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocol_version: PROTOCOL_VERSION,
        pairing_code: code,
        machine_id: options.machineId,
        display_name: displayName,
        server_version: options.serverVersion,
      }),
    });
  } catch (err) {
    return { ok: false, error: `Could not reach Agent Panel: ${toErrorMessage(err)}` };
  }

  if (response.status === 404 || response.status === 410) {
    return {
      ok: false,
      error: 'That code is not valid any more. Codes work once and expire, so generate a new one.',
    };
  }

  if (!response.ok) {
    // Panel writes these for a person to read, so its wording beats ours.
    let detail = `Agent Panel answered ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // Keep the status.
    }
    return { ok: false, error: detail };
  }

  let body: {
    credential?: string;
    org_id?: string;
    machine_id?: string;
    heartbeat_interval_seconds?: number;
  };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return { ok: false, error: 'Agent Panel sent something this version could not read.' };
  }

  if (!body.credential || !body.org_id) {
    return { ok: false, error: 'Agent Panel did not return a credential.' };
  }

  return {
    ok: true,
    record: {
      credential: body.credential,
      orgId: body.org_id,
      machineId: body.machine_id ?? options.machineId,
      displayName,
      pairedAt: new Date().toISOString(),
      heartbeatIntervalSeconds: body.heartbeat_interval_seconds ?? 60,
    },
  };
}
