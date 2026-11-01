/**
 * Local sign-in state at `${OVERDECK_HOME}/account.json` (PRD PAN-4330 W-2, D-6).
 *
 * Holds the device token minted by the overdeck.ai account service, written
 * atomically (temp file in the same directory, then rename) with mode 0600.
 * A corrupt or unreadable file is never silently replaced: reading it throws,
 * naming the file and telling the operator to delete it to sign out locally.
 *
 * This module imports only Node built-ins and `../paths.js` so the standalone
 * `pan account` CLI can load it without the dashboard or Effect runtime layers.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getOverdeckHome } from '../paths.js';

export const ACCOUNT_FILENAME = 'account.json';

export interface AccountRecord {
  v: 1;
  baseUrl: string;
  accessToken: string;
  deviceId: string;
  label: string;
  githubLogin: string | null;
  githubId: number | null;
  signedInAt: string;
}

const DEVICE_TOKEN_RE = /^odd_[0-9a-f]{64}$/;

/** Absolute path of the account file under the current OVERDECK_HOME. */
export function accountPath(): string {
  return join(getOverdeckHome(), ACCOUNT_FILENAME);
}

function isAccountRecord(value: unknown): value is AccountRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.v === 1 &&
    typeof record.baseUrl === 'string' &&
    typeof record.accessToken === 'string' &&
    DEVICE_TOKEN_RE.test(record.accessToken) &&
    typeof record.deviceId === 'string' &&
    typeof record.label === 'string' &&
    (record.githubLogin === null || typeof record.githubLogin === 'string') &&
    (record.githubId === null || typeof record.githubId === 'number') &&
    typeof record.signedInAt === 'string'
  );
}

/**
 * Read the local account record. Returns `null` when the file does not exist.
 * Throws an Error naming the file path when it exists but is unreadable,
 * unparseable, or has the wrong shape.
 */
export async function readAccount(): Promise<AccountRecord | null> {
  const path = accountPath();
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Cannot read ${path}: ${(error as Error).message}. Delete it to sign out locally.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Cannot read ${path}: ${(error as Error).message}. Delete it to sign out locally.`);
  }
  if (!isAccountRecord(parsed)) {
    throw new Error(`Cannot read ${path}: unexpected shape. Delete it to sign out locally.`);
  }
  return parsed;
}

/** Writes the account record atomically: temp file in the same directory, then rename, mode 0600. */
export async function writeAccount(record: AccountRecord): Promise<void> {
  const home = getOverdeckHome();
  const target = accountPath();
  const temp = join(home, `${ACCOUNT_FILENAME}.${randomUUID()}.tmp`);
  await mkdir(home, { recursive: true });
  try {
    await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/** Deletes the local account record. Returns `false` when no file exists. */
export async function removeAccount(): Promise<boolean> {
  try {
    await unlink(accountPath());
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
