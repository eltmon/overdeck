/**
 * Session Vault local-directory backend (PAN-2609, P-3 layout).
 *
 * Used by the test suite and for a plain directory or NAS mount. The layout is
 * the same tree the git backend commits, so both pass the shared contract suite:
 *
 *     <root>/VAULT-FORMAT            "overdeck-vault 1\n"
 *     <root>/objects/<id[0:2]>/<id>  encrypted chunk bytes (immutable)
 *     <root>/refs/<name>             encrypted ref value
 *     <root>/objects/keywrap/v1      reserved slot, overwritten by putSlot
 *
 * A ref's version is the SHA-1 of the ref file bytes. `casRefs` (and `casRef`,
 * its single-op form) is serialized within the process by a promise chain and
 * across processes by an O_EXCL lock file next to each ref, taken in ascending
 * name order; a stale lock (older than 30 s) is reclaimed. Writes publish at
 * once, so `discardUnpublished` has nothing to drop.
 * Imports only Node built-ins and the sibling types module.
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { withFileLock } from '../file-lock.js';
import {
  VAULT_FORMAT_MARKER,
  VAULT_FORMAT_MARKER_FILE,
  VaultOfflineError,
  assertDistinctRefNames,
  assertNotSlotName,
  assertRefName,
  assertSlotName,
  objectRelativePath,
  type CasResult,
  type RefOp,
  type VaultRef,
  type VaultStore,
} from './types.js';

export function refVersion(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex');
}

async function writeAtomic(target: string, bytes: Uint8Array): Promise<void> {
  const temp = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(temp, bytes);
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

async function readOrNull(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export class DirVaultStore implements VaultStore {
  private casQueue: Promise<unknown> = Promise.resolve();

  private constructor(readonly root: string) {}

  /**
   * Open (creating when empty) a vault directory. Refuses a directory that
   * has content but no marker, or a marker for another format.
   */
  static async open(root: string): Promise<DirVaultStore> {
    let entries: string[];
    try {
      await mkdir(root, { recursive: true });
      entries = await readdir(root);
    } catch (error) {
      throw new VaultOfflineError(`Vault directory ${root} is not accessible`, { cause: error });
    }
    const marker = await readOrNull(join(root, VAULT_FORMAT_MARKER_FILE));
    if (marker === null) {
      if (entries.length > 0) {
        throw new Error(`${root} is neither empty nor a vault (no ${VAULT_FORMAT_MARKER_FILE})`);
      }
      await writeFile(join(root, VAULT_FORMAT_MARKER_FILE), VAULT_FORMAT_MARKER);
    } else if (marker.toString('utf8') !== VAULT_FORMAT_MARKER) {
      throw new Error(`${root} has an unsupported ${VAULT_FORMAT_MARKER_FILE}: ${JSON.stringify(marker.toString('utf8'))}`);
    }
    return new DirVaultStore(root);
  }

  private objectPath(id: string): string {
    return join(this.root, 'objects', ...objectRelativePath(id).split('/'));
  }

  private refPath(name: string): string {
    assertRefName(name);
    return join(this.root, 'refs', ...name.split('/'));
  }

  async putObjects(objects: ReadonlyArray<{ id: string; bytes: Uint8Array }>): Promise<void> {
    for (const { id } of objects) assertNotSlotName(id);
    for (const { id, bytes } of objects) {
      const path = this.objectPath(id);
      // Ids bind the plaintext (keyed HMAC) and decodeChunk authenticates on
      // read, so an existing id is already stored: a re-encode of the same
      // lines after a failed push carries a fresh nonce and must not fail.
      if ((await readOrNull(path)) !== null) continue;
      await writeAtomic(path, bytes);
    }
  }

  async putSlot(name: string, bytes: Uint8Array | null): Promise<void> {
    assertSlotName(name);
    const path = this.objectPath(name);
    if (bytes !== null) {
      await writeAtomic(path, bytes);
      return;
    }
    try {
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async getObject(id: string): Promise<Uint8Array | null> {
    return readOrNull(this.objectPath(id));
  }

  async hasObjects(ids: readonly string[]): Promise<Set<string>> {
    const present = new Set<string>();
    await Promise.all(
      ids.map(async (id) => {
        try {
          await stat(this.objectPath(id));
          present.add(id);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }),
    );
    return present;
  }

  async readRef(name: string): Promise<VaultRef | null> {
    const bytes = await readOrNull(this.refPath(name));
    if (bytes === null) return null;
    return { value: bytes, version: refVersion(bytes) };
  }

  async casRef(name: string, expectedVersion: string | null, value: Uint8Array): Promise<CasResult> {
    return this.casRefs([{ name, expectedVersion, value }]);
  }

  async casRefs(ops: ReadonlyArray<RefOp>): Promise<CasResult> {
    assertDistinctRefNames(ops);
    const sorted = ops
      .map((op) => ({ ...op, path: this.refPath(op.name) }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const run = this.casQueue.then(() => this.casRefsLocked(sorted));
    this.casQueue = run.catch(() => undefined);
    return run;
  }

  /** `ops` is in ascending name order, so two batches always take their locks in the same order. */
  private async casRefsLocked(ops: ReadonlyArray<RefOp & { path: string }>): Promise<CasResult> {
    for (const { path } of ops) await mkdir(dirname(path), { recursive: true });
    const withLocks = (index: number): Promise<CasResult> => {
      const op = ops[index];
      if (op !== undefined) return withFileLock(`${op.path}.lock`, () => withLocks(index + 1));
      return this.casRefsHeld(ops);
    };
    return withLocks(0);
  }

  private async casRefsHeld(ops: ReadonlyArray<RefOp & { path: string }>): Promise<CasResult> {
    for (const { path, expectedVersion } of ops) {
      const current = await readOrNull(path);
      const currentVersion = current === null ? null : refVersion(current);
      if (currentVersion !== expectedVersion) return 'conflict';
    }
    for (const { path, value } of ops) {
      if (value !== undefined) await writeAtomic(path, value);
    }
    return 'ok';
  }

  async discardUnpublished(): Promise<void> {
    // Every write lands in the directory at once; nothing is unpublished.
  }

  async refresh(): Promise<void> {
    // The directory is the source of truth; nothing to pull.
  }

  async listRefs(prefix: string): Promise<Array<{ name: string; version: string }>> {
    const refsRoot = join(this.root, 'refs');
    const out: Array<{ name: string; version: string }> = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!entry.isFile() || entry.name.endsWith('.lock') || entry.name.endsWith('.tmp')) continue;
        const name = relative(refsRoot, full).split(sep).join('/');
        if (!name.startsWith(prefix)) continue;
        const bytes = await readFile(full);
        out.push({ name, version: refVersion(bytes) });
      }
    };
    await walk(refsRoot);
    return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
}
