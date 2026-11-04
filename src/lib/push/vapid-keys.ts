/**
 * PAN-2354: the machine's VAPID key pair (RFC 8292), stored at
 * `<OVERDECK_HOME>/push/vapid.json` with mode 0600 in a 0700 directory.
 *
 * The key is created once and never overwritten: every browser subscription is
 * bound to the public key, so regenerating it would silently orphan them all.
 * Creation follows `environment-identity.ts` — write a temp file, `link()` it
 * into place, and treat `EEXIST` as "another caller won" and re-read. A
 * malformed file throws `VapidKeysUnreadableError` and is left untouched.
 */
import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import webpush from 'web-push';
import { getOverdeckHome } from '../paths.js';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  createdAt: string;
}

export class VapidKeysUnreadableError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`VAPID key file ${path} is unreadable (${detail}); it is never replaced automatically`);
    this.name = 'VapidKeysUnreadableError';
  }
}

const VAPID_FILENAME = 'vapid.json';

export function pushDir(): string {
  return join(getOverdeckHome(), 'push');
}

export function vapidKeysPath(): string {
  return join(pushDir(), VAPID_FILENAME);
}

export async function readVapidKeys(): Promise<VapidKeys | null> {
  const path = vapidKeysPath();
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new VapidKeysUnreadableError(path, 'not valid JSON');
  }
  const record = parsed as Partial<VapidKeys> | null;
  if (
    record === null
    || typeof record !== 'object'
    || typeof record.publicKey !== 'string'
    || record.publicKey === ''
    || typeof record.privateKey !== 'string'
    || record.privateKey === ''
  ) {
    throw new VapidKeysUnreadableError(path, 'missing publicKey or privateKey');
  }
  return {
    publicKey: record.publicKey,
    privateKey: record.privateKey,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
  };
}

export async function ensureVapidKeys(): Promise<VapidKeys> {
  const existing = await readVapidKeys();
  if (existing) return existing;

  const generated = webpush.generateVAPIDKeys();
  const keys: VapidKeys = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    createdAt: new Date().toISOString(),
  };
  const dir = pushDir();
  const target = vapidKeysPath();
  const temp = join(dir, `${VAPID_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temp, `${JSON.stringify(keys, null, 2)}\n`, { mode: 0o600 });
    // link() fails with EEXIST when another caller created the key between our
    // read and now; rename() would silently replace it.
    await link(temp, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      const raced = await readVapidKeys();
      if (raced) return raced;
    }
    throw error;
  } finally {
    await unlink(temp).catch(() => undefined);
  }
  return keys;
}
