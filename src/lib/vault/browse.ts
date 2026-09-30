/**
 * Session Vault browse cache (PAN-4436, PAN-2609 FR-4).
 *
 * `refreshBrowseCache` keeps one decrypted LOG file per record owned by another
 * machine under `${vaultDir()}/browse/`, so the dashboard can render it with its
 * existing Claude Code and Codex parsers. `manifest.json` records how many LOG
 * chunks and bytes each file holds, so a refresh appends only new chunks and
 * skips records whose `updatedAt` has not moved.
 *
 * The files are derived copies, never native transcripts: removal uses `rm`
 * under a containment check and never the transcript deletion door. Imports
 * only Node built-ins and sibling vault modules (not `materialize.js`, which
 * pulls in runtime storage).
 */
import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { vaultDir } from './config.js';
import { decodeChunk, readSessionRecord, refName, type SessionRecord } from './format.js';
import type { VaultSubkeys } from './identity.js';
import { readListCache, type ListCacheRow } from './local-index.js';
import type { VaultStore } from './store/types.js';

export const BROWSE_DIRNAME = 'browse';
export const BROWSE_HARNESSES = ['claude-code', 'codex'] as const;

type BrowseHarness = (typeof BROWSE_HARNESSES)[number];

const MANIFEST_FILENAME = 'manifest.json';
const VAULT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BROWSE_FILE_PATTERN = /^(?:rollout-)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;

export interface BrowseCopy {
  vaultId: string;
  harness: BrowseHarness;
  title: string;
  ownerLabel: string;
  cwd: string;
  model: string | null;
  createdAt: string;
  updatedAt: string;
  path: string;
}

export interface BrowseRefreshResult {
  /** Every cache entry kept or written this refresh. */
  copies: BrowseCopy[];
  /** vaultIds whose file and manifest entry were removed. */
  removed: string[];
  /** Wanted but not refreshed; the previous file and manifest entry are kept. */
  failed: Array<{ vaultId: string; message: string }>;
}

interface ManifestEntry {
  harness: BrowseHarness;
  chunks: number;
  bytes: number;
  updatedAt: string;
  title: string;
  ownerLabel: string;
  cwd: string;
  model: string | null;
  createdAt: string;
}

interface BrowseManifest {
  v: 1;
  entries: Record<string, ManifestEntry>;
}

export function vaultBrowseDir(): string {
  return join(vaultDir(), BROWSE_DIRNAME);
}

export function isBrowsableVaultId(vaultId: string): boolean {
  return VAULT_ID_PATTERN.test(vaultId);
}

function isBrowseHarness(harness: string): harness is BrowseHarness {
  return (BROWSE_HARNESSES as readonly string[]).includes(harness);
}

/** Throws on an id that fails isBrowsableVaultId. */
export function vaultBrowseFilePath(vaultId: string, harness: string): string {
  if (!isBrowsableVaultId(vaultId)) throw new Error(`Invalid vault id for a browse copy: ${JSON.stringify(vaultId)}`);
  // The `rollout-` prefix makes the dashboard pick its Codex parser.
  return join(vaultBrowseDir(), harness === 'codex' ? `rollout-${vaultId}.jsonl` : `${vaultId}.jsonl`);
}

/** Same bytes as `materialize.ts` `nativeFileContent`. */
function browseFileContent(lines: readonly string[]): string {
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

function manifestPath(): string {
  return join(vaultBrowseDir(), MANIFEST_FILENAME);
}

async function readManifest(): Promise<BrowseManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath(), 'utf8'));
  } catch {
    return { v: 1, entries: {} };
  }
  const manifest = parsed as { v?: unknown; entries?: unknown } | null;
  const entries = manifest?.entries;
  if (manifest?.v !== 1 || typeof entries !== 'object' || entries === null) return { v: 1, entries: {} };
  const out: Record<string, ManifestEntry> = {};
  for (const [vaultId, entry] of Object.entries(entries as Record<string, ManifestEntry>)) {
    if (isBrowsableVaultId(vaultId) && entry && isBrowseHarness(entry.harness)) out[vaultId] = entry;
  }
  return { v: 1, entries: out };
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const temp = join(vaultBrowseDir(), `.${process.pid}.${randomBytes(8).toString('hex')}.tmp`);
  try {
    await writeFile(temp, content, { mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

async function fileSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Remove a browse file after checking it sits inside the browse directory. */
async function removeBrowseFile(path: string): Promise<void> {
  const rel = relative(vaultBrowseDir(), path);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Refusing to remove ${path}: outside the browse directory`);
  await rm(path, { force: true });
}

async function decodeLines(record: SessionRecord, chunkIds: readonly string[], store: VaultStore, keys: VaultSubkeys): Promise<string[]> {
  const lines: string[] = [];
  for (const id of chunkIds) {
    const bytes = await store.getObject(id);
    if (!bytes) throw new Error(`Vault chunk ${id} of record ${record.vaultId} is missing from the backend`);
    lines.push(...(await decodeChunk(bytes, id, keys)).lines);
  }
  return lines;
}

function copyFromEntry(vaultId: string, entry: ManifestEntry): BrowseCopy {
  return {
    vaultId,
    harness: entry.harness,
    title: entry.title,
    ownerLabel: entry.ownerLabel,
    cwd: entry.cwd,
    model: entry.model,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    path: vaultBrowseFilePath(vaultId, entry.harness),
  };
}

/**
 * Write or refresh the cache file of `row`'s record. Returns the new manifest
 * entry, or null when the record is gone, tombstoned or no longer browsable.
 */
async function refreshOne(
  row: ListCacheRow,
  entry: ManifestEntry | undefined,
  store: VaultStore,
  keys: VaultSubkeys,
): Promise<ManifestEntry | null> {
  const name = refName('record', row.vaultId, keys.K_ref);
  const ref = await store.readRef(name);
  const value = ref ? await readSessionRecord(name, ref.value, keys) : null;
  if (!value || value.tombstone || !isBrowseHarness(value.harness)) return null;
  const record = value;
  const harness = record.harness as BrowseHarness;
  const path = vaultBrowseFilePath(row.vaultId, harness);
  const size = await fileSize(path);

  if (entry && entry.harness === harness && size === entry.bytes && entry.chunks <= record.log.length) {
    const lines = await decodeLines(record, record.log.slice(entry.chunks), store, keys);
    if (lines.length > 0) await appendFile(path, browseFileContent(lines), { mode: 0o600 });
  } else {
    const lines = await decodeLines(record, record.log, store, keys);
    await writeAtomic(path, browseFileContent(lines));
    await removeBrowseFile(vaultBrowseFilePath(row.vaultId, harness === 'codex' ? 'claude-code' : 'codex'));
  }

  return {
    harness,
    chunks: record.log.length,
    bytes: (await stat(path)).size,
    updatedAt: record.updatedAt,
    title: record.title,
    ownerLabel: record.owner.label,
    cwd: record.cwd,
    model: record.model,
    createdAt: record.createdAt,
  };
}

export async function refreshBrowseCache(options: {
  store: VaultStore;
  keys: VaultSubkeys;
  /** Defaults to the list cache the last pull wrote. */
  rows?: readonly ListCacheRow[];
}): Promise<BrowseRefreshResult> {
  const { store, keys } = options;
  const rows = options.rows ?? (await readListCache());
  await mkdir(vaultBrowseDir(), { recursive: true, mode: 0o700 });
  const manifest = await readManifest();
  const result: BrowseRefreshResult = { copies: [], removed: [], failed: [] };
  const kept = new Set<string>();

  const wanted = rows.filter((row) => !row.ownerIsHere && !row.tombstone && isBrowseHarness(row.harness) && isBrowsableVaultId(row.vaultId));
  for (const row of wanted) {
    try {
      const entry = manifest.entries[row.vaultId];
      if (entry && entry.updatedAt === row.updatedAt && entry.harness === row.harness
        && (await fileSize(vaultBrowseFilePath(row.vaultId, row.harness))) === entry.bytes) {
        result.copies.push(copyFromEntry(row.vaultId, entry));
        kept.add(row.vaultId);
        continue;
      }
      const next = await refreshOne(row, entry, store, keys);
      if (!next) continue;
      manifest.entries[row.vaultId] = next;
      result.copies.push(copyFromEntry(row.vaultId, next));
      kept.add(row.vaultId);
    } catch (error) {
      result.failed.push({ vaultId: row.vaultId, message: (error as Error).message });
    }
  }

  const failed = new Set(result.failed.map((entry) => entry.vaultId));
  for (const vaultId of Object.keys(manifest.entries)) {
    if (kept.has(vaultId) || failed.has(vaultId)) continue;
    await removeBrowseFile(vaultBrowseFilePath(vaultId, 'claude-code'));
    await removeBrowseFile(vaultBrowseFilePath(vaultId, 'codex'));
    delete manifest.entries[vaultId];
    result.removed.push(vaultId);
  }

  // A lost or corrupt manifest forgets files; sweep any decrypted copy (or
  // leftover temp file) that no kept or failed entry accounts for.
  const keptPaths = new Set(result.copies.map((copy) => copy.path));
  for (const name of await readdir(vaultBrowseDir())) {
    if (name === MANIFEST_FILENAME) continue;
    const vaultId = BROWSE_FILE_PATTERN.exec(name)?.[1];
    const path = join(vaultBrowseDir(), name);
    if (vaultId && (failed.has(vaultId) || keptPaths.has(path))) continue;
    if (!vaultId && !name.endsWith('.tmp')) continue;
    await removeBrowseFile(path);
    if (vaultId && !kept.has(vaultId) && !result.removed.includes(vaultId)) result.removed.push(vaultId);
  }

  await writeAtomic(manifestPath(), `${JSON.stringify(manifest)}\n`);
  return result;
}
