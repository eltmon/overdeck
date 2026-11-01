/**
 * Anywhere settings door (PAN-4650 D-4650-15).
 *
 * The single read/write door for `${OVERDECK_HOME}/anywhere.json`
 * (`{ "v": 1, "shareConversations": true }`, 0600). It lives outside
 * `config.yaml` because the Settings whole-document save is lossy. An absent
 * file means the defaults (sharing on, D-4). A corrupt file shares nothing and
 * logs once; a write refuses to overwrite it until it is repaired.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getOverdeckHome } from '../paths.js';

export const ANYWHERE_SETTINGS_FILENAME = 'anywhere.json';

export interface AnywhereSettings {
  shareConversations: boolean;
}

const DEFAULTS: AnywhereSettings = { shareConversations: true };

let lastError: string | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();

export function anywhereSettingsPath(): string {
  return join(getOverdeckHome(), ANYWHERE_SETTINGS_FILENAME);
}

function parseSettings(raw: string, path: string): AnywhereSettings {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(`Anywhere settings ${path} is not valid JSON`);
  }
  const record = body as { v?: unknown; shareConversations?: unknown } | null;
  if (!record || typeof record !== 'object' || record.v !== 1) {
    throw new Error(`Anywhere settings ${path} has an unknown format (expected v: 1)`);
  }
  if (record.shareConversations !== undefined && typeof record.shareConversations !== 'boolean') {
    throw new Error(`Anywhere settings ${path}: shareConversations must be a boolean`);
  }
  return { shareConversations: record.shareConversations ?? DEFAULTS.shareConversations };
}

/** Strict read: absent ⇒ defaults; unreadable or corrupt ⇒ throws naming the path. */
async function readStrict(path: string): Promise<AnywhereSettings> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULTS };
    throw new Error(`Cannot read Anywhere settings ${path}: ${(error as Error).message}`);
  }
  return parseSettings(raw, path);
}

/** The current settings. A corrupt file turns sharing off (fail closed) and logs once. */
export async function readAnywhereSettings(): Promise<AnywhereSettings> {
  try {
    const settings = await readStrict(anywhereSettingsPath());
    lastError = null;
    return settings;
  } catch (error) {
    const message = (error as Error).message;
    if (message !== lastError) console.error(`[anywhere-settings] ${message}. Conversations are not shared until it is repaired.`);
    lastError = message;
    return { ...DEFAULTS, shareConversations: false };
  }
}

/** Merge `patch` into the stored settings and write them atomically. */
export function writeAnywhereSettings(patch: Partial<AnywhereSettings>): Promise<AnywhereSettings> {
  const run = writeQueue.then(async () => {
    const path = anywhereSettingsPath();
    const next = { ...(await readStrict(path)), ...patch };
    const home = getOverdeckHome();
    await mkdir(home, { recursive: true, mode: 0o700 });
    const temp = join(home, `${ANYWHERE_SETTINGS_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
    try {
      await writeFile(temp, `${JSON.stringify({ v: 1, ...next }, null, 2)}\n`, { mode: 0o600 });
      await rename(temp, path);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
    lastError = null;
    return next;
  });
  writeQueue = run.catch(() => undefined);
  return run;
}
