/**
 * PAN-5019 D-7: the per-phone notification preferences store at
 * `<OVERDECK_HOME>/push/phone-preferences.json`.
 *
 * Keyed by `clientId`, not the access-token record itself, so a re-pair (a new
 * token record, same `clientId`) keeps the phone's preferences. The phone is
 * the source of truth: a missing, corrupt or unreadable file reads as "no
 * prefs" — fail open, so notifications keep flowing (NFR-1) — with one
 * `console.warn` for a corrupt file, and the next write replaces it. Cached in
 * memory after the first read; every write updates the cache in place.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePhoneNotificationPreferences, type PhoneNotificationPreferences } from '@overdeck/contracts';
import { listActiveRecordsOfKind } from '../access-tokens.js';
import { pushDir } from './vapid-keys.js';

const PHONE_PREFERENCES_FILENAME = 'phone-preferences.json';

interface StoreFile {
  v: 1;
  phones: Record<string, unknown>;
}

let writeQueue: Promise<unknown> = Promise.resolve();
let cache: Map<string, PhoneNotificationPreferences> | null = null;

export function phonePreferencesPath(): string {
  return join(pushDir(), PHONE_PREFERENCES_FILENAME);
}

function activePhoneClientIds(): Set<string> {
  return new Set(listActiveRecordsOfKind('phone').flatMap((record) => (record.clientId ? [record.clientId] : [])));
}

async function readStore(): Promise<Map<string, PhoneNotificationPreferences>> {
  const path = phonePreferencesPath();
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
    console.warn(`[push] phone preferences file ${path} is unreadable; treating as empty:`, error instanceof Error ? error.message : error);
    return new Map();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn(`[push] phone preferences file ${path} is not valid JSON; treating as empty:`, error instanceof Error ? error.message : error);
    return new Map();
  }
  const phones = (parsed as Partial<StoreFile> | null)?.phones;
  if (phones === null || typeof phones !== 'object' || Array.isArray(phones)) {
    console.warn(`[push] phone preferences file ${path} has no phones map; treating as empty`);
    return new Map();
  }
  const map = new Map<string, PhoneNotificationPreferences>();
  for (const [clientId, value] of Object.entries(phones)) {
    const prefs = parsePhoneNotificationPreferences(value);
    if (prefs) map.set(clientId, prefs);
  }
  return map;
}

async function writeStore(map: ReadonlyMap<string, PhoneNotificationPreferences>): Promise<void> {
  const dir = pushDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, `${PHONE_PREFERENCES_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  const body: StoreFile = { v: 1, phones: Object.fromEntries(map) };
  try {
    await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, phonePreferencesPath());
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  cache = new Map(map);
}

/** Cached after the first read; a missing, corrupt or unreadable file reads as an empty map (D-7). */
export function loadPhoneNotificationPreferences(): Promise<ReadonlyMap<string, PhoneNotificationPreferences>> {
  if (cache) return Promise.resolve(cache);
  const run = writeQueue.then(() => readStore());
  return run.then((map) => {
    cache ??= map;
    return cache;
  });
}

/** Stores prefs for `clientId`, pruning clientIds with no active phone record; mode 0600; atomic. */
export function setPhoneNotificationPreferences(clientId: string, prefs: PhoneNotificationPreferences): Promise<void> {
  const run = writeQueue.then(async () => {
    const current = await readStore();
    current.set(clientId, prefs);
    const active = activePhoneClientIds();
    for (const existingClientId of [...current.keys()]) {
      if (existingClientId !== clientId && !active.has(existingClientId)) current.delete(existingClientId);
    }
    await writeStore(current);
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

/** Tests only. */
export function resetPhoneNotificationPreferencesCacheForTests(): void {
  cache = null;
  writeQueue = Promise.resolve();
}
