/**
 * Session Vault key rotation (PAN-4333, PRD section 8; decisions D-4, D-5,
 * D-9, D-11, D-14).
 *
 * `rotateVaultKey` replaces the vault key `K` with a new key `K'`:
 *
 *   1. `K'` is written to `${OVERDECK_HOME}/vault/key.next` before any backend
 *      write, so a crashed rotation resumes with the same key;
 *   2. every record and machine ref is re-sealed under `K'` at its new name
 *      (ref names are HMACs under the key), every old name gets a retired-ref
 *      marker sealed under `K`, and the header is re-sealed under `K'` with
 *      `K` at the front of its key ring, all in one `casRefs` batch. That
 *      batch is the point of no return;
 *   3. the keywrap slot is replaced or removed, then `K'` becomes the key file.
 *
 * Chunks and WIP parts are not re-encrypted; they decode through the ring.
 * `key.next` is left in place: the CLI removes it after it has printed the
 * new recovery phrase. The retry loop has no delay.
 *
 * Imports only Node built-ins and sibling vault modules, and no backend
 * implementation: any store that passes the contract suite can be rotated.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { vaultDir } from './config.js';
import {
  HEADER_REF_NAME,
  VaultAuthenticationError,
  decryptRef,
  encryptRef,
  readVaultHeader,
  refName,
  type MachineRecord,
  type RetiredRefMarker,
  type SessionRecordValue,
  type VaultHeader,
} from './format.js';
import { VAULT_KEY_BYTES, createVaultKey, deriveSubkeys, saveVaultKey, type VaultSubkeys } from './identity.js';
import { KEYWRAP_OBJECT_NAME, type RefOp, type VaultRef, type VaultStore } from './store/types.js';

export const NEXT_KEY_FILENAME = 'key.next';
const DEFAULT_MAX_ATTEMPTS = 5;

export function nextKeyPath(): string {
  return join(vaultDir(), NEXT_KEY_FILENAME);
}

/** The key of a rotation in progress; `null` when none is. A wrong-length file throws naming the path. */
export async function loadNextKey(): Promise<Buffer | null> {
  const path = nextKeyPath();
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Cannot read pending vault key ${path}: ${(error as Error).message}`);
  }
  if (bytes.length !== VAULT_KEY_BYTES) {
    throw new Error(`Pending vault key ${path} must be ${VAULT_KEY_BYTES} bytes, got ${bytes.length}`);
  }
  return bytes;
}

/** Persist the new key of a rotation with mode 0600, atomically. */
export async function saveNextKey(key: Uint8Array): Promise<string> {
  if (key.length !== VAULT_KEY_BYTES) throw new Error(`Pending vault key must be ${VAULT_KEY_BYTES} bytes, got ${key.length}`);
  const dir = vaultDir();
  const target = nextKeyPath();
  const temp = join(dir, `${NEXT_KEY_FILENAME}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(temp, key, { mode: 0o600 });
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  return target;
}

export async function clearNextKey(): Promise<void> {
  try {
    await unlink(nextKeyPath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export class VaultRotationConflictError extends Error {
  override readonly name = 'VaultRotationConflictError';

  constructor() {
    super('Another machine kept writing to the vault. Stop pan vault on your other machines and run pan vault rotate-key again.');
  }
}

export interface RotateOptions {
  /** The raw store, not the guarded one: rotation rewrites the header the guard asserts. */
  store: VaultStore;
  /** From loadVaultKey(). */
  currentKey: Buffer;
  /** keywrap/v1 bytes to publish under the new key (already wrapped), null = delete, undefined = leave as is. */
  keywrap?: Uint8Array | null;
  now?: () => Date;
  /** Attempts at the batch before giving up on conflicts. */
  maxAttempts?: number;
}

export interface RotateResult {
  newKey: Buffer;
  records: number;
  machines: number;
  /** A `key.next` from an earlier run was reused. */
  resumed: boolean;
  /** `'earlier'` when a previous run already committed the batch and this one only finished up. */
  committed: 'now' | 'earlier';
}

type MovedValue = { kind: 'record'; id: string; value: SessionRecordValue } | { kind: 'machine'; id: string; value: MachineRecord };

/** The header when `ref` opens with `keys`, else null. */
async function openHeader(ref: VaultRef | null, keys: VaultSubkeys): Promise<VaultHeader | null> {
  if (ref === null) return null;
  try {
    return await readVaultHeader(ref.value, keys);
  } catch (error) {
    if (error instanceof VaultAuthenticationError) return null;
    throw error;
  }
}

/** A record or machine value sealed under `keys` at `name`; null for anything else (markers, junk, other types). */
async function readMovable(name: string, bytes: Uint8Array, keys: VaultSubkeys): Promise<MovedValue | null> {
  let value: unknown;
  try {
    value = await decryptRef(name, bytes, keys);
  } catch (error) {
    if (error instanceof VaultAuthenticationError) return null;
    throw error;
  }
  if (typeof value !== 'object' || value === null) return null;
  const fields = value as { type?: unknown; vaultId?: unknown; environmentId?: unknown };
  if (fields.type === 'session' && typeof fields.vaultId === 'string') {
    return { kind: 'record', id: fields.vaultId, value: value as SessionRecordValue };
  }
  if (fields.type === 'machine' && typeof fields.environmentId === 'string') {
    return { kind: 'machine', id: fields.environmentId, value: value as MachineRecord };
  }
  return null;
}

interface Batch {
  ops: RefOp[];
  records: number;
  machines: number;
}

async function buildBatch(
  store: VaultStore,
  header: { ref: VaultRef; value: VaultHeader },
  currentKey: Buffer,
  oldKeys: VaultSubkeys,
  newKeys: VaultSubkeys,
  at: string,
): Promise<Batch> {
  const batch: Batch = { ops: [], records: 0, machines: 0 };
  const marker: RetiredRefMarker = { v: 1, type: 'retired', at };
  const listed = [...(await store.listRefs('r/')), ...(await store.listRefs('m/'))];
  for (const { name } of listed) {
    const ref = await store.readRef(name);
    if (ref === null) continue;
    const moved = await readMovable(name, ref.value, oldKeys);
    // A value stored under a name other than its own is not a vault ref; leave it behind.
    if (moved === null || refName(moved.kind, moved.id, oldKeys.K_ref) !== name) continue;
    const newName = refName(moved.kind, moved.id, newKeys.K_ref);
    batch.ops.push({
      name: newName,
      expectedVersion: (await store.readRef(newName))?.version ?? null,
      value: await encryptRef(newName, moved.value, newKeys),
    });
    batch.ops.push({ name, expectedVersion: ref.version, value: await encryptRef(name, marker, oldKeys) });
    if (moved.kind === 'record') batch.records++;
    else batch.machines++;
  }
  const nextHeader: VaultHeader = {
    ...header.value,
    rotatedAt: at,
    keyRing: [currentKey.toString('base64'), ...(header.value.keyRing ?? [])],
  };
  batch.ops.push({
    name: HEADER_REF_NAME,
    expectedVersion: header.ref.version,
    value: await encryptRef(HEADER_REF_NAME, nextHeader, newKeys),
  });
  return batch;
}

/** Records and machines readable under `keys`: what an earlier run's batch moved. */
async function countMoved(store: VaultStore, keys: VaultSubkeys): Promise<{ records: number; machines: number }> {
  const counts = { records: 0, machines: 0 };
  for (const { name } of [...(await store.listRefs('r/')), ...(await store.listRefs('m/'))]) {
    const ref = await store.readRef(name);
    const moved = ref === null ? null : await readMovable(name, ref.value, keys);
    if (moved?.kind === 'record') counts.records++;
    else if (moved?.kind === 'machine') counts.machines++;
  }
  return counts;
}

export async function rotateVaultKey(options: RotateOptions): Promise<RotateResult> {
  const { store, currentKey } = options;
  const now = options.now ?? (() => new Date());
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  const pending = await loadNextKey();
  const newKey = pending ?? createVaultKey();
  if (pending === null) await saveNextKey(newKey);
  const oldKeys = deriveSubkeys(currentKey);
  const newKeys = deriveSubkeys(newKey);

  let outcome: { committed: 'now' | 'earlier'; records: number; machines: number } | null = null;
  for (let attempt = 0; attempt < maxAttempts && outcome === null; attempt++) {
    await store.refresh();
    const headerRef = await store.readRef(HEADER_REF_NAME);
    if ((await openHeader(headerRef, newKeys)) !== null) {
      outcome = { committed: 'earlier', ...(await countMoved(store, newKeys)) };
      break;
    }
    const header = await openHeader(headerRef, oldKeys);
    if (headerRef === null || header === null) {
      throw new Error('The vault key on this machine does not open the vault; nothing was rotated.');
    }
    await store.discardUnpublished();
    const batch = await buildBatch(store, { ref: headerRef, value: header }, currentKey, oldKeys, newKeys, now().toISOString());
    if ((await store.casRefs(batch.ops)) === 'ok') {
      outcome = { committed: 'now', records: batch.records, machines: batch.machines };
    }
  }
  if (outcome === null) throw new VaultRotationConflictError();

  if (options.keywrap !== undefined) await store.putSlot(KEYWRAP_OBJECT_NAME, options.keywrap);
  await saveVaultKey(newKey);
  return { newKey, resumed: pending !== null, ...outcome };
}
