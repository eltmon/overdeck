/**
 * Session Vault backend interface (PAN-2609, PRD "Backend interface", D-4).
 *
 * A backend is an immutable object store plus compare-and-swap refs. Every
 * byte handed to it is already encrypted, and ref names are keyed HMACs, so the
 * backend can neither read records nor link them to conversations. Two
 * implementations share this contract: `dir.ts` (local directory: tests, NAS)
 * and `git.ts` (a git remote). Both expose the P-3 layout: a plaintext
 * `VAULT-FORMAT` marker, `objects/<id[0:2]>/<id>`, and `refs/<name>`.
 */

export const VAULT_FORMAT_MARKER_FILE = 'VAULT-FORMAT';
export const VAULT_FORMAT_MARKER = 'overdeck-vault 1\n';

export interface VaultRef {
  value: Uint8Array;
  /** Opaque version token; equal tokens mean equal bytes. */
  version: string;
}

export type CasResult = 'ok' | 'conflict';

/** One ref in a `casRefs` batch. */
export interface RefOp {
  name: string;
  /** The version the ref must be at (`null` = the ref must not exist yet). */
  expectedVersion: string | null;
  /** Omitted = assert-only: the ref must be at expectedVersion; nothing is written. */
  value?: Uint8Array;
}

export interface VaultStore {
  /** Store objects by id. Re-putting an existing id with the same bytes is a no-op. */
  putObjects(objects: ReadonlyArray<{ id: string; bytes: Uint8Array }>): Promise<void>;
  getObject(id: string): Promise<Uint8Array | null>;
  /** The subset of `ids` that exist. */
  hasObjects(ids: readonly string[]): Promise<Set<string>>;
  readRef(name: string): Promise<VaultRef | null>;
  /**
   * Replace `name` with `value` only when its current version equals
   * `expectedVersion` (`null` = the ref must not exist yet). The single-op
   * form of `casRefs`.
   */
  casRef(name: string, expectedVersion: string | null, value: Uint8Array): Promise<CasResult>;
  /**
   * All-or-nothing CAS over several distinct refs: when every op's ref is at its
   * expectedVersion, write every op that carries a value and publish them together;
   * otherwise write nothing and return 'conflict'. An op without a value only
   * asserts. Throws for duplicate names.
   *
   * A backend that cannot publish a batch atomically (the directory store)
   * writes the valued ops in the order given, so a caller that must survive a
   * crash between two writes puts the op that commits the batch last.
   */
  casRefs(ops: ReadonlyArray<RefOp>): Promise<CasResult>;
  /**
   * Drop objects no ref write has published yet. A backend that publishes on
   * write resolves at once.
   */
  discardUnpublished(): Promise<void>;
  listRefs(prefix: string): Promise<Array<{ name: string; version: string }>>;
  /**
   * Bring the local view up to date with the remote before a read-heavy pass
   * (sync). Throws VaultOfflineError when the remote cannot be reached. A
   * backend with no remote view (the directory store) resolves immediately.
   */
  refresh(): Promise<void>;
  /**
   * Overwrite (`bytes`) or delete (`null`) a reserved slot (RESERVED_OBJECT_NAMES)
   * and publish the change before resolving. Last write wins. Throws for any
   * other name, and VaultOfflineError when the backend cannot be reached.
   */
  putSlot(name: string, bytes: Uint8Array | null): Promise<void>;
}

/** The backend cannot be reached right now; the caller should back off and retry later. */
export class VaultOfflineError extends Error {
  override readonly name = 'VaultOfflineError';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/** Object ids are 40 lowercase hex chars (truncated HMAC-SHA256). */
export const OBJECT_ID_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Reserved object name for PAN-4328 (vault passphrase, anywhere-accounts
 * design 6.5): the scrypt-wrapped copy of the vault key. Stored at
 * `objects/keywrap/v1` on every backend. Only `putSlot` writes it; `putObjects`
 * rejects it, because content objects are immutable and a slot is not.
 */
export const KEYWRAP_OBJECT_NAME = 'keywrap/v1';

/** Object names that are not content ids but fixed, well-known slots. */
export const RESERVED_OBJECT_NAMES: ReadonlySet<string> = new Set([KEYWRAP_OBJECT_NAME]);

/** Relative path of an object below `objects/`: `<id[0:2]>/<id>` for ids, the name itself for reserved slots. */
export function objectRelativePath(id: string): string {
  assertObjectId(id);
  return RESERVED_OBJECT_NAMES.has(id) ? id : `${id.slice(0, 2)}/${id}`;
}

/** Ref names are `<prefix>/<40 hex>` or the fixed `h/header`; never `..`, never absolute. */
export const REF_NAME_PATTERN = /^[a-z]\/[0-9a-z]{1,64}$/;

export function assertObjectId(id: string): void {
  if (RESERVED_OBJECT_NAMES.has(id)) return;
  if (!OBJECT_ID_PATTERN.test(id)) throw new Error(`Invalid vault object id: ${JSON.stringify(id)}`);
}

/** Throws unless `name` is a reserved slot (the only names `putSlot` accepts). */
export function assertSlotName(name: string): void {
  if (!RESERVED_OBJECT_NAMES.has(name)) throw new Error(`Invalid vault slot name: ${JSON.stringify(name)}`);
}

/** Throws for a reserved slot name: content objects never go through a slot. */
export function assertNotSlotName(id: string): void {
  if (RESERVED_OBJECT_NAMES.has(id)) throw new Error(`Reserved vault object ${id} must be written with putSlot`);
}

export function assertRefName(name: string): void {
  if (!REF_NAME_PATTERN.test(name)) throw new Error(`Invalid vault ref name: ${JSON.stringify(name)}`);
}

/** Throws when two ops of a `casRefs` batch name the same ref. */
export function assertDistinctRefNames(ops: ReadonlyArray<RefOp>): void {
  const seen = new Set<string>();
  for (const { name } of ops) {
    if (seen.has(name)) throw new Error(`Duplicate vault ref name in one batch: ${JSON.stringify(name)}`);
    seen.add(name);
  }
}
