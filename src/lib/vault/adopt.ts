/**
 * Session Vault ownership transfer and version forks (PAN-2609, P-5, P-7).
 *
 * `adoptRecord` moves a conversation to this machine: it appends a lineage
 * entry and a new segment whose prefix describes the VIEW it materializes,
 * writes that with `casRef`, and only on `ok` writes the native file. A
 * `conflict` means another machine adopted first: the record is re-read and
 * `{ alreadyContinuedOn: <label> }` is returned with no native file written.
 * The origin machine's native file is never touched.
 *
 * `forkRecordAtVersion` creates a new record (new vaultId, owned here) whose
 * log is the parent's chunk ids through settlement `n` and whose parent is
 * `{ vaultId, version: n }`; the original ref is never written.
 */
import { randomUUID } from 'node:crypto';
import { ensureEnvironmentIdentity, type EnvironmentIdentity } from '../environment-identity.js';
import { tailOf } from './continuity.js';
import { encryptRef, isTombstone, readSessionRecord, refName, type SessionRecord } from './format.js';
import type { VaultSubkeys } from './identity.js';
import { setOwnedTail } from './local-index.js';
import { nativeFileContent, planMaterialization, writeMaterialization } from './materialize.js';
import { logThroughVersion } from './settle.js';
import type { VaultStore } from './store/types.js';

export interface AdoptOptions {
  vaultId: string;
  store: VaultStore;
  keys: VaultSubkeys;
  targetCwd: string;
  newSessionId?: string;
  /** Defaults to `~/.claude/projects`. */
  projectsRoot?: string;
  /** Defaults to `ensureEnvironmentIdentity()`. */
  identity?: EnvironmentIdentity;
  now?: () => Date;
}

export type AdoptResult =
  | { adopted: true; vaultId: string; path: string; newSessionId: string; lines: number }
  | { adopted: false; alreadyContinuedOn: string };

async function readRecordOrThrow(store: VaultStore, vaultId: string, keys: VaultSubkeys) {
  const name = refName('record', vaultId, keys.K_ref);
  const ref = await store.readRef(name);
  if (!ref) throw new Error(`Vault record ${vaultId} not found`);
  const value = await readSessionRecord(name, ref.value, keys);
  if (!value) throw new Error(`Vault ref for ${vaultId} is not a session record`);
  if (isTombstone(value)) throw new Error(`Vault record ${vaultId} was excluded (tombstone)`);
  return { name, record: value, version: ref.version };
}

/**
 * Claim `record` for `identity` (adding a segment for the file about to be
 * written) and materialize it. Shared by adoption and owned-fork resume.
 */
async function claimAndMaterialize(
  options: AdoptOptions & { identity: EnvironmentIdentity },
  current: { name: string; record: SessionRecord; version: string },
  adopting: boolean,
): Promise<AdoptResult> {
  const { store, keys, targetCwd, identity } = options;
  const now = options.now ?? (() => new Date());
  const newSessionId = options.newSessionId ?? randomUUID();
  const plan = await planMaterialization({ record: current.record, store, keys, targetCwd, newSessionId, projectsRoot: options.projectsRoot });
  const tail = tailOf(plan.lines, Buffer.byteLength(nativeFileContent(plan.lines), 'utf8'));
  const at = now().toISOString();
  const next: SessionRecord = {
    ...current.record,
    owner: { environmentId: identity.environmentId, label: identity.label },
    nativeSessionId: newSessionId,
    cwd: targetCwd,
    segments: [
      ...current.record.segments,
      { environmentId: identity.environmentId, nativeSessionId: newSessionId, logStart: plan.prefix.logEnd, prefix: plan.prefix, tail },
    ],
    lineage: adopting
      ? [...current.record.lineage, { environmentId: identity.environmentId, adoptedAt: at }]
      : current.record.lineage,
    updatedAt: at,
  };
  const outcome = await store.casRef(current.name, current.version, await encryptRef(current.name, next, keys));
  if (outcome === 'conflict') {
    const latest = await readRecordOrThrow(store, options.vaultId, keys);
    return { adopted: false, alreadyContinuedOn: latest.record.owner.label };
  }
  await writeMaterialization(plan);
  await setOwnedTail(plan.path, { vaultId: options.vaultId, harness: current.record.harness, tail });
  return { adopted: true, vaultId: options.vaultId, path: plan.path, newSessionId, lines: plan.lines.length };
}

/** Transfer a record owned elsewhere to this machine and materialize it. */
export async function adoptRecord(options: AdoptOptions): Promise<AdoptResult> {
  const identity = options.identity ?? (await ensureEnvironmentIdentity());
  const current = await readRecordOrThrow(options.store, options.vaultId, options.keys);
  if (current.record.owner.environmentId === identity.environmentId) {
    throw new Error(`Vault record ${options.vaultId} is already owned by this machine (${identity.label}); nothing to adopt`);
  }
  return claimAndMaterialize({ ...options, identity }, current, true);
}

/**
 * Materialize a record this machine already owns but has no native file for
 * (a fresh fork from `forkRecordAtVersion`). Refuses when a segment for this
 * machine already exists, so an existing native file is never duplicated.
 */
export async function materializeOwned(options: AdoptOptions): Promise<AdoptResult> {
  const identity = options.identity ?? (await ensureEnvironmentIdentity());
  const current = await readRecordOrThrow(options.store, options.vaultId, options.keys);
  if (current.record.owner.environmentId !== identity.environmentId) {
    throw new Error(`Vault record ${options.vaultId} is owned by ${current.record.owner.label}; use adoptRecord`);
  }
  if (current.record.segments.some((segment) => segment.environmentId === identity.environmentId)) {
    throw new Error(`Vault record ${options.vaultId} already has a native file on this machine`);
  }
  return claimAndMaterialize({ ...options, identity }, current, false);
}

export interface ForkOptions {
  vaultId: string;
  version: number;
  store: VaultStore;
  keys: VaultSubkeys;
  identity?: EnvironmentIdentity;
  now?: () => Date;
}

/** Create a new record owned here whose history is the parent's through settlement `version`. */
export async function forkRecordAtVersion(options: ForkOptions): Promise<{ vaultId: string; record: SessionRecord }> {
  const { store, keys, version } = options;
  const identity = options.identity ?? (await ensureEnvironmentIdentity());
  const now = options.now ?? (() => new Date());
  const { record: parent } = await readRecordOrThrow(store, options.vaultId, keys);
  const archived = parent.settlementsArchive?.length ?? 0;
  const total = archived + parent.settlements.length;
  if (!Number.isInteger(version) || version < 1 || version > total) {
    throw new Error(`Vault record ${options.vaultId} has versions 1..${total}; ${version} does not exist`);
  }
  const log = logThroughVersion(parent, version);
  const view = parent.view.fromChunk < log.length ? parent.view : { fromChunk: 0, fromLine: 0 };
  const at = now().toISOString();
  const vaultId = randomUUID();
  const record: SessionRecord = {
    ...parent,
    vaultId,
    owner: { environmentId: identity.environmentId, label: identity.label },
    nativeSessionId: '',
    title: `${parent.title} @${version}`,
    log,
    view,
    parent: { vaultId: options.vaultId, version },
    segments: [],
    settlements: version > archived ? parent.settlements.slice(0, version - archived) : [],
    settlementsArchive: version > archived ? parent.settlementsArchive : undefined,
    lineage: [],
    tombstone: false,
    createdAt: at,
    updatedAt: at,
    endedAt: null,
  };
  if (record.settlementsArchive === undefined) delete record.settlementsArchive;
  const name = refName('record', vaultId, keys.K_ref);
  const outcome = await store.casRef(name, null, await encryptRef(name, record, keys));
  if (outcome !== 'ok') throw new Error(`Could not create fork record ${vaultId}: ref already exists`);
  return { vaultId, record };
}
