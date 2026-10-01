/**
 * Vault resolution (PAN-4307 D-5).
 *
 * Resolves config, key and store into a tagged result and prints nothing —
 * moved out of `src/cli/commands/vault/shared.ts` so the dashboard's Session
 * Vault consumer can resolve the vault without pulling in CLI output/exit
 * plumbing. The CLI's `openVault` wraps `openVaultContext()` and keeps its
 * exact messages and exit codes.
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readVaultConfig, vaultDir, type VaultConfig } from './config.js';
import { loadVaultKey, type VaultSubkeys } from './identity.js';
import { VaultKeyMismatchError, openKeyring } from './keyring.js';
import { DirVaultStore } from './store/dir.js';
import { GitVaultStore, gitVaultCloneDir } from './store/git.js';
import type { VaultStore } from './store/types.js';

export interface OpenVault {
  config: VaultConfig;
  /** Sub-keys of the verified key; `previous` holds the key ring. */
  keys: VaultSubkeys;
  /** Guarded: every ref write asserts the header version the key was verified against. */
  store: VaultStore;
  /** When the vault key was last rotated; null before the first rotation. */
  rotatedAt: string | null;
}

export type VaultOpenResult =
  | { status: 'off' }
  | { status: 'rotation-pending'; backend: string }
  | { status: 'key-missing'; backend: string }
  | { status: 'key-mismatch'; backend: string }
  | { status: 'open'; vault: OpenVault };

async function rotationPending(): Promise<boolean> {
  try {
    await stat(join(vaultDir(), 'key.next'));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Backends prefixed `dir:` are local directories (tests, NAS); anything else is a git remote. */
export const DIR_BACKEND_PREFIX = 'dir:';

export async function storeForBackend(backend: string, cloneDir = gitVaultCloneDir()): Promise<VaultStore> {
  if (backend.startsWith(DIR_BACKEND_PREFIX)) return DirVaultStore.open(backend.slice(DIR_BACKEND_PREFIX.length));
  return GitVaultStore.open(cloneDir);
}

/**
 * Resolve config, key and store into a tagged result. Prints nothing and
 * throws nothing but `VaultKeyMismatchError`, which becomes `key-mismatch`.
 */
export async function openVaultContext(): Promise<VaultOpenResult> {
  const config = await readVaultConfig();
  if (!config.backend) return { status: 'off' };
  if (await rotationPending()) return { status: 'rotation-pending', backend: config.backend };
  const key = await loadVaultKey();
  if (!key) return { status: 'key-missing', backend: config.backend };
  const store = await storeForBackend(config.backend);
  try {
    const opened = await openKeyring(store, key, { backend: config.backend });
    return { status: 'open', vault: { config, keys: opened.keys, store: opened.store, rotatedAt: opened.rotatedAt } };
  } catch (error) {
    if (!(error instanceof VaultKeyMismatchError)) throw error;
    return { status: 'key-mismatch', backend: config.backend };
  }
}
