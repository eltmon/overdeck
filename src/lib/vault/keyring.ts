/**
 * Session Vault key ring and write guard (PAN-4333, decisions D-1, D-3, D-7).
 *
 * `openKeyring` verifies that a vault key opens `h/header`, loads the retired
 * keys of the header's `keyRing` into `keys.previous` (chunks and WIP parts
 * sealed before a rotation decode through them), and returns a
 * `KeyGuardedStore` bound to the header version it verified.
 *
 * The guard makes every ref write assert that header version in the same
 * batch. A key rotation rewrites the header, so a machine that still holds a
 * retired key gets `conflict` on its next write, and the guard turns that into
 * `VaultKeyRetiredError` instead of letting the machine publish under a key
 * the vault no longer uses. `refresh` and `putSlot` check the header the same
 * way, so a stale machine cannot re-wrap a retired key under a passphrase.
 *
 * Imports only Node built-ins and sibling vault modules.
 */
import {
  HEADER_REF_NAME,
  VaultAuthenticationError,
  parseKeyRing,
  readVaultHeader,
  type VaultHeader,
} from './format.js';
import { deriveSubkeys, type VaultSubkeys } from './identity.js';
import type { CasResult, RefOp, VaultRef, VaultStore } from './store/types.js';

const DEFAULT_BACKEND = '<backend>';

/** `h/header` is absent or does not open with the key. */
export class VaultKeyMismatchError extends Error {
  override readonly name = 'VaultKeyMismatchError';

  constructor(message = 'The vault key does not open the vault header') {
    super(message);
  }
}

/** The header this key opened was replaced by one it no longer opens: the key was rotated away. */
export class VaultKeyRetiredError extends Error {
  override readonly name = 'VaultKeyRetiredError';

  constructor(backend = DEFAULT_BACKEND) {
    super(`This machine's vault key was retired by a key rotation. Run: pan vault join ${backend} with the new recovery phrase or passphrase.`);
  }
}

export interface OpenKeyring {
  /** Sub-keys of the verified key; `previous` holds the ring, newest first. */
  keys: VaultSubkeys;
  /** The guarded store; every ref write asserts the verified header version. */
  store: VaultStore;
  headerVersion: string;
  rotatedAt: string | null;
}

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

function loadRing(keys: VaultSubkeys, header: VaultHeader): void {
  keys.previous = parseKeyRing(header).map((retired) => deriveSubkeys(retired));
}

/**
 * Verify `key` against `h/header` and load the key ring. Throws
 * VaultKeyMismatchError when the header is absent or does not open with `key`.
 */
export async function openKeyring(store: VaultStore, key: Uint8Array, options: { backend?: string } = {}): Promise<OpenKeyring> {
  const keys = deriveSubkeys(key);
  const ref = await store.readRef(HEADER_REF_NAME);
  const header = await openHeader(ref, keys);
  if (ref === null || header === null) throw new VaultKeyMismatchError();
  loadRing(keys, header);
  return {
    keys,
    store: new KeyGuardedStore(store, keys, ref.version, options.backend ?? DEFAULT_BACKEND),
    headerVersion: ref.version,
    rotatedAt: header.rotatedAt ?? null,
  };
}

export class KeyGuardedStore implements VaultStore {
  constructor(
    private readonly inner: VaultStore,
    /** Shared with the caller: a header change that still opens reloads `previous` in place. */
    private readonly keys: VaultSubkeys,
    private headerVersion: string,
    private readonly backend: string = DEFAULT_BACKEND,
  ) {}

  /**
   * Re-read the header. Same version: nothing to do. A different version that
   * still opens with the key: adopt it and reload the ring. Otherwise the key
   * was retired.
   */
  private async recheckHeader(): Promise<void> {
    const ref = await this.inner.readRef(HEADER_REF_NAME);
    if (ref !== null && ref.version === this.headerVersion) return;
    const header = await openHeader(ref, this.keys);
    if (ref === null || header === null) throw new VaultKeyRetiredError(this.backend);
    loadRing(this.keys, header);
    this.headerVersion = ref.version;
  }

  putObjects(objects: ReadonlyArray<{ id: string; bytes: Uint8Array }>): Promise<void> {
    return this.inner.putObjects(objects);
  }

  getObject(id: string): Promise<Uint8Array | null> {
    return this.inner.getObject(id);
  }

  hasObjects(ids: readonly string[]): Promise<Set<string>> {
    return this.inner.hasObjects(ids);
  }

  readRef(name: string): Promise<VaultRef | null> {
    return this.inner.readRef(name);
  }

  listRefs(prefix: string): Promise<Array<{ name: string; version: string }>> {
    return this.inner.listRefs(prefix);
  }

  discardUnpublished(): Promise<void> {
    return this.inner.discardUnpublished();
  }

  casRef(name: string, expectedVersion: string | null, value: Uint8Array): Promise<CasResult> {
    return this.casRefs([{ name, expectedVersion, value }]);
  }

  async casRefs(ops: ReadonlyArray<RefOp>): Promise<CasResult> {
    // A batch that names the header itself already carries its own version check.
    const guarded = ops.some((op) => op.name === HEADER_REF_NAME)
      ? ops
      : [...ops, { name: HEADER_REF_NAME, expectedVersion: this.headerVersion }];
    const result = await this.inner.casRefs(guarded);
    if (result === 'conflict') await this.recheckHeader();
    return result;
  }

  async refresh(): Promise<void> {
    await this.inner.refresh();
    await this.recheckHeader();
  }

  async putSlot(name: string, bytes: Uint8Array | null): Promise<void> {
    await this.refresh();
    await this.inner.putSlot(name, bytes);
  }
}
