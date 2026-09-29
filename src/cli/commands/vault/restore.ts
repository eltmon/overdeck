/**
 * pan vault restore <id> [--to <path>]
 *
 * Rebuild an evicted transcript byte for byte at its original path (FR-16).
 * Refuses when a file already exists there.
 */
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { listOwned } from '../../../lib/vault/local-index.js';
import { restoreNative } from '../../../lib/vault/materialize.js';
import { defaultIo, openVault, type CliIo } from './shared.js';
import { loadRecord, resolveVaultId } from './show.js';

export interface RestoreOptions {
  to?: string;
}

export async function restoreCommand(id: string, options: RestoreOptions = {}, io: CliIo = defaultIo): Promise<void> {
  const vault = await openVault(io);
  if (!vault) return;
  let vaultId = await resolveVaultId(id);
  if (!vaultId) {
    const owned = Object.values(await listOwned()).find((entry) => entry.vaultId.startsWith(id));
    vaultId = owned?.vaultId ?? null;
  }
  const record = vaultId ? await loadRecord(vaultId, vault.store, vault.keys) : null;
  if (!vaultId || !record) {
    io.err(`No saved conversation matches ${id}.`);
    return io.exit(1);
  }
  const ownedPath = Object.entries(await listOwned()).find(([, entry]) => entry.vaultId === vaultId)?.[0];
  const nativePath = options.to ?? ownedPath;
  if (!nativePath) {
    io.err(`This machine has no recorded path for ${vaultId.slice(0, 8)}. Pass --to <path>.`);
    return io.exit(1);
  }
  try {
    // Rebuild THIS machine's segment, not the current owner's: after an adoption
    // elsewhere, the owner's segment is another machine's file.
    const me = await ensureEnvironmentIdentity();
    const result = await restoreNative({ record, store: vault.store, keys: vault.keys, nativePath, environmentId: me.environmentId });
    io.out(`Restored ${result.lines} line${result.lines === 1 ? '' : 's'} to ${result.path}`);
  } catch (error) {
    io.err((error as Error).message);
    return io.exit(1);
  }
}
