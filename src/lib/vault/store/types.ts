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

export interface VaultStore {
  /** Store objects by id. Re-putting an existing id with the same bytes is a no-op. */
  putObjects(objects: ReadonlyArray<{ id: string; bytes: Uint8Array }>): Promise<void>;
  getObject(id: string): Promise<Uint8Array | null>;
  /** The subset of `ids` that exist. */
  hasObjects(ids: readonly string[]): Promise<Set<string>>;
  readRef(name: string): Promise<VaultRef | null>;
  /**
   * Replace `name` with `value` only when its current version equals
   * `expectedVersion` (`null` = the ref must not exist yet).
   */
  casRef(name: string, expectedVersion: string | null, value: Uint8Array): Promise<CasResult>;
  listRefs(prefix: string): Promise<Array<{ name: string; version: string }>>;
  /**
   * Bring the local view up to date with the remote before a read-heavy pass
   * (sync). Throws VaultOfflineError when the remote cannot be reached. A
   * backend with no remote view (the directory store) resolves immediately.
   */
  refresh(): Promise<void>;
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
 * `objects/keywrap/v1` on every backend. Phase A never writes it; reserving
 * the name now means PAN-4328 lands without a format bump.
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

export function assertRefName(name: string): void {
  if (!REF_NAME_PATTERN.test(name)) throw new Error(`Invalid vault ref name: ${JSON.stringify(name)}`);
}
