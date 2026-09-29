/**
 * Session Vault pending-deletion batch (PAN-2609): FR-16, FR-20..FR-23, P-10,
 * NFR-10 and operator decision D-7.
 *
 * Nothing here deletes a transcript on its own. `scanEligible` only adds
 * entries to `${OVERDECK_HOME}/vault/eviction-batch.json` (mode 0600, atomic,
 * never uploaded) for transcripts whose every settleable line is in the vault,
 * whose covering chunk reads back and matches, and which have been quiet for
 * `liveQuietMinutes`. The operator reviews the batch and confirms it by
 * fingerprint (`confirmEviction`, the only caller of the transcript deletion
 * door in this directory); anything that changed since review is skipped.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureEnvironmentIdentity } from '../environment-identity.js';
import { readVaultConfig, vaultDir, type VaultConfig } from './config.js';
import { lineHash, splitSettleableLines } from './continuity.js';
import { decodeChunk, isTombstone, readSessionRecord, refName, type SessionRecord } from './format.js';
import { withFileLock } from './file-lock.js';
import type { VaultSubkeys } from './identity.js';
import { listOwned, type OwnedEntry } from './local-index.js';
import { nativeFileContent } from './materialize.js';
import { logLineCount } from './settle.js';
import type { VaultStore } from './store/types.js';
import { removeTranscriptFile } from '../cloister/transcript-deletion-door.js';

export const EVICTION_BATCH_FILENAME = 'eviction-batch.json';

export type Verification = 'verified' | 'failed';

export interface EvictionEntry {
  vaultId: string;
  harness: string;
  nativePath: string;
  title: string;
  sizeBytes: number;
  /** The chunk whose read-back proved the tail of the file is in the vault. */
  settlementChunk: string;
  verification: Verification;
  reason?: string;
  checkedAt: string;
  addedAt: string;
}

export interface DeclinedEntry {
  vaultId: string;
  nativePath: string;
  declinedAt: string;
}

export interface EvictionBatch {
  v: 1;
  entries: EvictionEntry[];
  declined: DeclinedEntry[];
}

export function evictionBatchPath(): string {
  return join(vaultDir(), EVICTION_BATCH_FILENAME);
}

function emptyBatch(): EvictionBatch {
  return { v: 1, entries: [], declined: [] };
}

export async function readEvictionBatch(): Promise<EvictionBatch> {
  const path = evictionBatchPath();
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyBatch();
    throw new Error(`Cannot read eviction batch ${path}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Eviction batch ${path} is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null) return emptyBatch();
  const record = parsed as Partial<EvictionBatch>;
  return {
    v: 1,
    entries: Array.isArray(record.entries) ? [...record.entries] : [],
    declined: Array.isArray(record.declined) ? [...record.declined] : [],
  };
}

/** Read-modify-write of the batch under its lock, so concurrent scans and confirms never drop entries. */
async function updateEvictionBatch<T>(fn: (batch: EvictionBatch) => Promise<T>): Promise<T> {
  await mkdir(vaultDir(), { recursive: true });
  return withFileLock(`${evictionBatchPath()}.lock`, async () => {
    const batch = await readEvictionBatch();
    const result = await fn(batch);
    await writeEvictionBatch(batch);
    return result;
  });
}

export async function writeEvictionBatch(batch: EvictionBatch): Promise<void> {
  const dir = vaultDir();
  const target = evictionBatchPath();
  const temp = join(dir, `${EVICTION_BATCH_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(temp, `${JSON.stringify(batch, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/** SHA-256 over the sorted (vaultId, nativePath, sizeBytes, settlementChunk) tuples. */
export function batchFingerprint(batch: Pick<EvictionBatch, 'entries'>): string {
  const tuples = batch.entries
    .map((entry) => [entry.vaultId, entry.nativePath, entry.sizeBytes, entry.settlementChunk] as const)
    .map((tuple) => JSON.stringify(tuple))
    .sort();
  return createHash('sha256').update(tuples.join('\n')).digest('hex');
}

export interface EligibilityCheck {
  ok: boolean;
  reason?: string;
  sizeBytes: number;
  settlementChunk: string | null;
}

/**
 * The FR-16 checks for one owned transcript: quiet for `liveQuietMinutes`,
 * every settleable line settled, and the covering chunk read back from the
 * store decrypts with line hashes matching the native lines.
 */
export async function checkEligibility(
  nativePath: string,
  owned: OwnedEntry,
  record: SessionRecord | null,
  store: VaultStore,
  keys: VaultSubkeys,
  config: VaultConfig,
  now: () => Date,
  environmentId: string,
): Promise<EligibilityCheck> {
  let info;
  try {
    info = await stat(nativePath);
  } catch {
    return { ok: false, reason: 'native file is missing', sizeBytes: 0, settlementChunk: null };
  }
  const quietMs = config.liveQuietMinutes * 60_000;
  if (now().getTime() - info.mtimeMs < quietMs) {
    return { ok: false, reason: `modified less than ${config.liveQuietMinutes} minutes ago (live)`, sizeBytes: info.size, settlementChunk: null };
  }
  if (!record) return { ok: false, reason: 'record not readable', sizeBytes: info.size, settlementChunk: null };
  if (record.owner.environmentId !== environmentId) {
    return { ok: false, reason: `record is owned by ${record.owner.label}`, sizeBytes: info.size, settlementChunk: null };
  }
  const segment = [...record.segments].reverse().find((entry) => entry.environmentId === environmentId);
  if (!segment) return { ok: false, reason: 'record has no segment for this machine', sizeBytes: info.size, settlementChunk: null };

  const bytes = await readFile(nativePath);
  const { lines, consumedBytes } = splitSettleableLines(bytes);
  if (consumedBytes !== bytes.length) {
    return { ok: false, reason: 'file has bytes not yet settled', sizeBytes: info.size, settlementChunk: null };
  }
  if (lines.length !== segment.tail.lineCount || owned.tail.lineCount !== lines.length) {
    return { ok: false, reason: `file has ${lines.length} lines but ${segment.tail.lineCount} are settled`, sizeBytes: info.size, settlementChunk: null };
  }
  // restoreNative reproduces exactly nativeFileContent(lines): a file with
  // blank lines or no final newline would not come back byte for byte.
  if (Buffer.byteLength(nativeFileContent(lines), 'utf8') !== bytes.length) {
    return { ok: false, reason: 'file has bytes the vault would not reproduce (blank lines or a missing final newline)', sizeBytes: info.size, settlementChunk: null };
  }
  const last = record.settlements[record.settlements.length - 1];
  if (!last) return { ok: false, reason: 'record has no settlement', sizeBytes: info.size, settlementChunk: null };
  // The LOG must hold exactly this segment's lines after its start: a LOG that
  // was appended twice (a settlement retried after a phantom conflict) has more.
  let logLines: number;
  try {
    logLines = await logLineCount(record, store, keys);
  } catch (error) {
    return { ok: false, reason: `LOG could not be counted: ${(error as Error).message}`, sizeBytes: info.size, settlementChunk: last.chunk };
  }
  const expectedLogLines = segment.logStart + (segment.tail.lineCount - (segment.prefix?.lineCount ?? 0));
  if (logLines !== expectedLogLines) {
    return { ok: false, reason: `LOG has ${logLines} lines but this machine's segment accounts for ${expectedLogLines}`, sizeBytes: info.size, settlementChunk: last.chunk };
  }
  const chunkBytes = await store.getObject(last.chunk);
  if (!chunkBytes) return { ok: false, reason: `covering chunk ${last.chunk} is missing from the backend`, sizeBytes: info.size, settlementChunk: last.chunk };
  let decoded;
  try {
    decoded = await decodeChunk(chunkBytes, last.chunk, keys);
  } catch (error) {
    return { ok: false, reason: `covering chunk failed to decrypt: ${(error as Error).message}`, sizeBytes: info.size, settlementChunk: last.chunk };
  }
  const tailLines = lines.slice(lines.length - decoded.lines.length);
  const matches = decoded.lineHashes.length === tailLines.length
    && decoded.lineHashes.every((hash, index) => hash === lineHash(tailLines[index]!));
  if (!matches) return { ok: false, reason: 'covering chunk line hashes do not match the native file', sizeBytes: info.size, settlementChunk: last.chunk };
  return { ok: true, sizeBytes: info.size, settlementChunk: last.chunk };
}

async function readOwnedRecord(store: VaultStore, keys: VaultSubkeys, vaultId: string): Promise<SessionRecord | null> {
  const name = refName('record', vaultId, keys.K_ref);
  const ref = await store.readRef(name);
  if (!ref) return null;
  const value = await readSessionRecord(name, ref.value, keys);
  return value && !isTombstone(value) ? value : null;
}

export interface ScanOptions {
  store: VaultStore;
  keys: VaultSubkeys;
  config?: VaultConfig;
  now?: () => Date;
}

/** Add every newly eligible owned transcript to the batch. Deletes nothing. */
export async function scanEligible(options: ScanOptions): Promise<EvictionBatch> {
  const { store, keys } = options;
  const now = options.now ?? (() => new Date());
  const config = options.config ?? (await readVaultConfig());
  const me = await ensureEnvironmentIdentity();
  const owned = await listOwned();
  return updateEvictionBatch(async (batch) => {
  for (const [nativePath, entry] of Object.entries(owned)) {
    if (batch.declined.some((declined) => declined.vaultId === entry.vaultId && declined.nativePath === nativePath)) continue;
    const record = await readOwnedRecord(store, keys, entry.vaultId);
    const check = await checkEligibility(nativePath, entry, record, store, keys, config, now, me.environmentId);
    const existing = batch.entries.findIndex((candidate) => candidate.nativePath === nativePath);
    if (!check.ok || !record || !check.settlementChunk) {
      if (existing >= 0) batch.entries.splice(existing, 1);
      continue;
    }
    const at = now().toISOString();
    const next: EvictionEntry = {
      vaultId: entry.vaultId,
      harness: entry.harness,
      nativePath,
      title: record.title,
      sizeBytes: check.sizeBytes,
      settlementChunk: check.settlementChunk,
      verification: 'verified',
      checkedAt: at,
      addedAt: existing >= 0 ? batch.entries[existing]!.addedAt : at,
    };
    if (existing >= 0) batch.entries[existing] = next;
    else batch.entries.push(next);
  }
  return batch;
  });
}

/** Remove an entry from the batch and remember the decision so scans do not re-add it. */
export async function declineEntry(vaultId: string, now: () => Date = () => new Date()): Promise<EvictionBatch> {
  return updateEvictionBatch(async (batch) => {
  const declinedAt = now().toISOString();
  const removed = batch.entries.filter((entry) => entry.vaultId === vaultId);
  batch.entries = batch.entries.filter((entry) => entry.vaultId !== vaultId);
  for (const entry of removed) {
    if (!batch.declined.some((declined) => declined.vaultId === vaultId && declined.nativePath === entry.nativePath)) {
      batch.declined.push({ vaultId, nativePath: entry.nativePath, declinedAt });
    }
  }
  return batch;
  });
}

/** Empty the batch. Records no declines and deletes nothing. */
export async function clearBatch(): Promise<EvictionBatch> {
  return updateEvictionBatch(async (batch) => {
    batch.entries = [];
    return batch;
  });
}

/** Forget a decline so the next scan may offer the transcript again. */
export async function reofferEntry(vaultId: string): Promise<EvictionBatch> {
  return updateEvictionBatch(async (batch) => {
    batch.declined = batch.declined.filter((declined) => declined.vaultId !== vaultId);
    return batch;
  });
}

export interface ConfirmOptions {
  store: VaultStore;
  keys: VaultSubkeys;
  config?: VaultConfig;
  now?: () => Date;
}

export type ConfirmResult =
  | { refused: true; fingerprint: string }
  | {
      refused: false;
      deleted: string[];
      skipped: Array<{ nativePath: string; reason: string }>;
      bytesFreed: number;
      /** Fingerprint of the batch that remains after this confirmation. */
      fingerprint: string;
    };

/**
 * FR-21: delete the reviewed batch. `fingerprint` must equal the current
 * batch fingerprint, otherwise nothing is deleted and the current fingerprint
 * is returned for a fresh review. Each entry re-runs the FR-16 checks (size
 * unchanged since review, quiet, covering chunk reads back and matches)
 * immediately before `removeTranscriptFile`; failing entries stay in the batch
 * with their new status and reason. This is the only deletion call site in
 * src/lib/vault (P-9).
 */
export async function confirmEviction(fingerprint: string, options: ConfirmOptions): Promise<ConfirmResult> {
  const { store, keys } = options;
  const now = options.now ?? (() => new Date());
  const config = options.config ?? (await readVaultConfig());
  const me = await ensureEnvironmentIdentity();
  await mkdir(vaultDir(), { recursive: true });
  return withFileLock(`${evictionBatchPath()}.lock`, async () => {
  const batch = await readEvictionBatch();
  const current = batchFingerprint(batch);
  if (current !== fingerprint) return { refused: true as const, fingerprint: current };
  const owned = await listOwned();
  const deleted: string[] = [];
  const skipped: Array<{ nativePath: string; reason: string }> = [];
  let bytesFreed = 0;
  const remaining: EvictionEntry[] = [];
  for (const entry of batch.entries) {
    const at = now().toISOString();
    const ownedEntry = owned[entry.nativePath];
    const record = ownedEntry ? await readOwnedRecord(store, keys, ownedEntry.vaultId) : null;
    const check = ownedEntry
      ? await checkEligibility(entry.nativePath, ownedEntry, record, store, keys, config, now, me.environmentId)
      : { ok: false, reason: 'transcript is no longer in the local index', sizeBytes: 0, settlementChunk: null };
    let reason = check.ok ? undefined : check.reason;
    if (check.ok && check.sizeBytes !== entry.sizeBytes) reason = `file size changed since review (${entry.sizeBytes} -> ${check.sizeBytes} bytes)`;
    if (check.ok && check.settlementChunk !== entry.settlementChunk) reason = 'a new settlement happened since review';
    if (reason !== undefined) {
      skipped.push({ nativePath: entry.nativePath, reason });
      remaining.push({ ...entry, verification: 'failed', reason, checkedAt: at });
      continue;
    }
    await removeTranscriptFile(entry.nativePath);
    deleted.push(entry.nativePath);
    bytesFreed += entry.sizeBytes;
  }
  batch.entries = remaining;
  await writeEvictionBatch(batch);
  return { refused: false as const, deleted, skipped, bytesFreed, fingerprint: batchFingerprint(batch) };
  });
}
