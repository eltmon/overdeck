/**
 * Shared machine identity (PAN-2609 / PAN-3762).
 *
 * One stable identifier per machine, stored at `${OVERDECK_HOME}/environment-id.json`.
 * The file is created once, atomically (temp file in the same directory, then
 * rename), with mode 0600, and never rewritten. A corrupt or unparseable file is
 * never replaced: a new id would orphan every vault record the machine owns, so
 * reads fail loudly naming the file and recovery is an explicit operator action.
 *
 * This module imports only Node built-ins and `./paths.js` so the standalone
 * `pan vault` CLI can load it without the dashboard or Effect runtime layers.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { getOverdeckHome } from './paths.js';

export const ENVIRONMENT_ID_FILENAME = 'environment-id.json';

export interface EnvironmentIdentity {
  v: 1;
  /** Lowercase UUID v4. Never changes once minted. */
  environmentId: string;
  /** `os.hostname()` at creation. User-facing; may be renamed. */
  label: string;
  /** ISO-8601 UTC timestamp of creation. */
  createdAt: string;
}

const UUID_V4_LOWERCASE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Absolute path of the identity file under the current OVERDECK_HOME. */
export function environmentIdentityPath(): string {
  return join(getOverdeckHome(), ENVIRONMENT_ID_FILENAME);
}

function isEnvironmentIdentity(value: unknown): value is EnvironmentIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.v === 1 &&
    typeof record.environmentId === 'string' &&
    UUID_V4_LOWERCASE.test(record.environmentId) &&
    typeof record.label === 'string' &&
    typeof record.createdAt === 'string'
  );
}

/**
 * Read the machine identity. Returns `null` when the file does not exist.
 * Throws an Error naming the file path when it exists but is unreadable,
 * unparseable, or has the wrong shape. Never writes.
 */
export async function readEnvironmentIdentity(): Promise<EnvironmentIdentity | null> {
  const path = environmentIdentityPath();
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Cannot read environment identity file ${path}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Environment identity file ${path} is not valid JSON: ${(error as Error).message}. ` +
        'It is never replaced automatically; recovery is an explicit operator action.',
    );
  }
  if (!isEnvironmentIdentity(parsed)) {
    throw new Error(
      `Environment identity file ${path} has an unexpected shape. ` +
        'It is never replaced automatically; recovery is an explicit operator action.',
    );
  }
  return parsed;
}

/**
 * Read the machine identity, creating it when absent. A corrupt existing file
 * propagates the read error; nothing is re-minted.
 */
export async function ensureEnvironmentIdentity(): Promise<EnvironmentIdentity> {
  const existing = await readEnvironmentIdentity();
  if (existing) return existing;

  const identity: EnvironmentIdentity = {
    v: 1,
    environmentId: randomUUID(),
    label: hostname(),
    createdAt: new Date().toISOString(),
  };
  const home = getOverdeckHome();
  const target = join(home, ENVIRONMENT_ID_FILENAME);
  const temp = join(home, `${ENVIRONMENT_ID_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(home, { recursive: true });
  try {
    await writeFile(temp, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  return identity;
}
