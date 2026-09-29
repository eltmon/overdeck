/**
 * pan vault list [--json] — the cached list rows from the last sync. Never
 * contacts the backend (P-18), so it works offline and with the remote down.
 */
import { readListCache, type ListCacheRow } from '../../../lib/vault/local-index.js';
import { defaultIo, openVault, type CliIo } from './shared.js';

export interface ListOptions {
  json?: boolean;
}

export function formatListRow(row: ListCacheRow): string {
  const owner = row.ownerIsHere ? `${row.ownerLabel} (this machine)` : row.ownerLabel;
  return `${row.vaultId.slice(0, 8)}  ${row.title.padEnd(48).slice(0, 48)}  ${row.harness.padEnd(11)}  ${owner.padEnd(24)}  ${row.updatedAt}`;
}

export async function listCommand(options: ListOptions = {}, io: CliIo = defaultIo): Promise<void> {
  const vault = await openVault(io);
  if (!vault) return;
  const rows = (await readListCache()).filter((row) => !row.tombstone);
  if (options.json) {
    io.out(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    io.out('No saved conversations in the list cache. Run: pan vault sync');
    return;
  }
  io.out(`${'id'.padEnd(8)}  ${'title'.padEnd(48)}  ${'harness'.padEnd(11)}  ${'owner'.padEnd(24)}  updated`);
  for (const row of rows) io.out(formatListRow(row));
}
