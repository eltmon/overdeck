/**
 * Session Vault machine-local index (PAN-2609, PRD decision P-18).
 *
 * `${OVERDECK_HOME}/vault/index.json` (mode 0600, atomic write) maps each native
 * transcript path this machine owns to its `vaultId`, harness and current
 * settlement tail, and caches the decrypted list rows from the last pull so
 * `pan vault list` and `show` never contact the backend. Nothing in this file
 * is ever uploaded. Imports only Node built-ins and sibling vault modules.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { vaultDir } from './config.js';
import type { Tail } from './continuity.js';

export const LOCAL_INDEX_FILENAME = 'index.json';

export interface OwnedEntry {
  vaultId: string;
  harness: string;
  tail: Tail;
}

export interface ListCacheRow {
  vaultId: string;
  title: string;
  harness: string;
  ownerLabel: string;
  ownerIsHere: boolean;
  updatedAt: string;
  tombstone: boolean;
}

export interface LocalIndex {
  v: 1;
  /** nativePath -> owned entry */
  owned: Record<string, OwnedEntry>;
  listCache: ListCacheRow[];
}

export function localIndexPath(): string {
  return join(vaultDir(), LOCAL_INDEX_FILENAME);
}

function emptyIndex(): LocalIndex {
  return { v: 1, owned: {}, listCache: [] };
}

export async function readLocalIndex(): Promise<LocalIndex> {
  const path = localIndexPath();
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyIndex();
    throw new Error(`Cannot read vault index ${path}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Vault index ${path} is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null) return emptyIndex();
  const record = parsed as Partial<LocalIndex>;
  return {
    v: 1,
    owned: typeof record.owned === 'object' && record.owned !== null ? { ...record.owned } : {},
    listCache: Array.isArray(record.listCache) ? [...record.listCache] : [],
  };
}

async function writeLocalIndex(index: LocalIndex): Promise<void> {
  const dir = vaultDir();
  const target = localIndexPath();
  const temp = join(dir, `${LOCAL_INDEX_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(temp, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/** The owned entry for a native path, or null when this machine does not own it. */
export async function getOwned(nativePath: string): Promise<OwnedEntry | null> {
  const index = await readLocalIndex();
  return index.owned[nativePath] ?? null;
}

/** Every owned entry keyed by native path. */
export async function listOwned(): Promise<Record<string, OwnedEntry>> {
  return (await readLocalIndex()).owned;
}

/** Record (or update) the tail of an owned native path after a settlement. */
export async function setOwnedTail(nativePath: string, entry: OwnedEntry): Promise<void> {
  const index = await readLocalIndex();
  index.owned[nativePath] = entry;
  await writeLocalIndex(index);
}

/** Forget an owned native path (after exclusion or a transfer of ownership). */
export async function removeOwned(nativePath: string): Promise<void> {
  const index = await readLocalIndex();
  if (!(nativePath in index.owned)) return;
  delete index.owned[nativePath];
  await writeLocalIndex(index);
}

/** Replace the cached list rows with the rows from the latest pull, in order. */
export async function replaceListCache(rows: readonly ListCacheRow[]): Promise<void> {
  const index = await readLocalIndex();
  index.listCache = [...rows];
  await writeLocalIndex(index);
}

/** The cached list rows in the order they were stored. */
export async function readListCache(): Promise<ListCacheRow[]> {
  return (await readLocalIndex()).listCache;
}
