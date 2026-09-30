/**
 * pan vault evict [--review] [--confirm <fingerprint>] [--decline <vaultId>] [--reoffer <vaultId>] [--clear]
 *
 * The operator-confirmed eviction flow (FR-21, FR-23, D-7). Review (the
 * default) scans and prints the pending batch with its fingerprint and deletes
 * nothing; confirm deletes exactly the reviewed, still-verified entries.
 */
import {
  batchFingerprint,
  clearBatch,
  confirmEviction,
  declineEntry,
  readEvictionBatch,
  reofferEntry,
  scanEligible,
  type EvictionBatch,
} from '../../../lib/vault/evict.js';
import { defaultIo, formatBytes, openVault, type CliIo } from './shared.js';

export interface EvictOptions {
  review?: boolean;
  confirm?: string;
  decline?: string;
  reoffer?: string;
  clear?: boolean;
}

export function printBatch(batch: EvictionBatch, io: CliIo): void {
  if (batch.entries.length === 0) {
    io.out('No transcripts are pending deletion.');
  } else {
    io.out('Pending deletion (nothing is deleted until you confirm):');
    let total = 0;
    for (const entry of batch.entries) {
      total += entry.sizeBytes;
      io.out(`  ${entry.nativePath}`);
      io.out(`      ${entry.harness}  ${formatBytes(entry.sizeBytes)}  ${entry.verification}${entry.reason ? ` (${entry.reason})` : ''}  "${entry.title}"  vault ${entry.vaultId.slice(0, 8)}`);
    }
    io.out(`Total: ${batch.entries.length} file${batch.entries.length === 1 ? '' : 's'}, ${formatBytes(total)}`);
  }
  if (batch.declined.length > 0) io.out(`Declined: ${batch.declined.map((entry) => entry.vaultId.slice(0, 8)).join(', ')} (pan vault evict --reoffer <vaultId> to offer again)`);
  io.out(`Fingerprint: ${batchFingerprint(batch)}`);
  if (batch.entries.length > 0) io.out(`To delete these files: pan vault evict --confirm ${batchFingerprint(batch)}`);
}

export async function evictCommand(options: EvictOptions = {}, io: CliIo = defaultIo): Promise<void> {
  const vault = await openVault(io);
  if (!vault) return;
  if (options.clear) {
    await clearBatch();
    io.out('Cleared the pending-deletion batch. No file was deleted and no decline was recorded.');
    return;
  }
  if (options.decline) {
    const batch = await declineEntry(options.decline);
    io.out(`Declined ${options.decline}; it will not be offered again until pan vault evict --reoffer ${options.decline}.`);
    printBatch(batch, io);
    return;
  }
  if (options.reoffer) {
    await reofferEntry(options.reoffer);
    const batch = await scanEligible({ store: vault.store, keys: vault.keys, config: vault.config });
    io.out(`${options.reoffer} may be offered again.`);
    printBatch(batch, io);
    return;
  }
  if (options.confirm) {
    const result = await confirmEviction(options.confirm, { store: vault.store, keys: vault.keys, config: vault.config });
    if (result.refused) {
      io.err(`The batch changed since that review; nothing was deleted. Review again: current fingerprint ${result.fingerprint}`);
      return io.exit(1);
    }
    for (const path of result.deleted) io.out(`deleted ${path}`);
    for (const skip of result.skipped) io.out(`kept    ${skip.nativePath} (${skip.reason})`);
    io.out(`Deleted ${result.deleted.length} file${result.deleted.length === 1 ? '' : 's'}, freed ${formatBytes(result.bytesFreed)}. Restore any of them with pan vault restore <id>.`);
    return;
  }
  const batch = vault.config.evict
    ? await scanEligible({ store: vault.store, keys: vault.keys, config: vault.config })
    : await readEvictionBatch();
  if (!vault.config.evict) io.out('Eviction is off (vault.evict is false); showing the existing batch only.');
  printBatch(batch, io);
}
