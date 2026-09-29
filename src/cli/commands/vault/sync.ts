/**
 * pan vault sync — one push/pull cycle (FR-3): settle owned transcripts that
 * grew, register this machine, refresh the list cache.
 */
import { syncOnce } from '../../../lib/vault/sync.js';
import { defaultIo, openVault, type CliIo } from './shared.js';

export async function syncCommand(_options: Record<string, never> = {}, io: CliIo = defaultIo): Promise<void> {
  const vault = await openVault(io);
  if (!vault) return;
  const report = await syncOnce({ store: vault.store, keys: vault.keys, config: vault.config });
  if (report.offline) {
    io.err(`Backend ${vault.config.backend} is unreachable; nothing was changed. Try again later.`);
    return io.exit(1);
  }
  const appended = report.settled.filter((entry) => entry.result.verdict === 'append').length;
  const blocked = report.settled.filter((entry) => entry.result.verdict === 'blocked');
  io.out(`Settled ${appended} transcript${appended === 1 ? '' : 's'}; ${report.records} record${report.records === 1 ? '' : 's'} listed; ${report.machines.length} machine${report.machines.length === 1 ? '' : 's'}${report.skipped > 0 ? `; ${report.skipped} non-session ref${report.skipped === 1 ? '' : 's'} skipped` : ''}.`);
  for (const failure of report.errors) io.out(`${failure.nativePath}: error: ${failure.message}`);
  for (const entry of blocked) {
    if (entry.result.verdict !== 'blocked') continue;
    io.out(`${entry.nativePath}: ${entry.result.hits.map((hit) => `blocked at line ${hit.line}: ${hit.pattern}`).join('; ')} (pan vault allow-secret ${entry.result.vaultId} <line>)`);
  }
}
