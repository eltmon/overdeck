/**
 * pan vault status
 *
 * Backend, this machine's identity, owned record count, last sync and the
 * machine list, read from the local clone and index. With the vault off,
 * prints VAULT_OFF_MESSAGE and exits 0 (AC-1).
 */
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { readMachineRecord, type MachineRecord } from '../../../lib/vault/format.js';
import { listOwned, readListCache } from '../../../lib/vault/local-index.js';
import { defaultIo, openVault, type CliIo } from './shared.js';

export interface StatusOptions {
  json?: boolean;
}

export async function statusCommand(options: StatusOptions = {}, io: CliIo = defaultIo): Promise<void> {
  const vault = await openVault(io);
  if (!vault) return;
  const me = await ensureEnvironmentIdentity();
  const owned = await listOwned();
  const cache = await readListCache();
  const machines: MachineRecord[] = [];
  for (const { name } of await vault.store.listRefs('m/')) {
    const ref = await vault.store.readRef(name);
    if (!ref) continue;
    const record = await readMachineRecord(name, ref.value, vault.keys);
    if (record) machines.push(record);
  }
  machines.sort((a, b) => a.label.localeCompare(b.label));
  const mine = machines.find((machine) => machine.environmentId === me.environmentId);
  const summary = {
    backend: vault.config.backend,
    machine: { label: me.label, environmentId: me.environmentId },
    ownedRecords: Object.keys(owned).length,
    listedRecords: cache.filter((row) => !row.tombstone).length,
    lastSyncAt: mine?.updatedAt ?? null,
    evict: vault.config.evict,
    machines: machines.map((machine) => ({ label: machine.label, environmentId: machine.environmentId, lastSyncAt: machine.updatedAt })),
  };
  if (options.json) {
    io.out(JSON.stringify(summary, null, 2));
    return;
  }
  io.out(`Backend:        ${summary.backend}`);
  io.out(`This machine:   ${summary.machine.label} (${summary.machine.environmentId})`);
  io.out(`Owned records:  ${summary.ownedRecords}`);
  io.out(`Listed records: ${summary.listedRecords}`);
  io.out(`Last sync:      ${summary.lastSyncAt ?? 'never'}`);
  io.out(`Eviction:       ${summary.evict ? 'on (pending-deletion batch, confirmation required)' : 'off'}`);
  io.out('Machines:');
  if (machines.length === 0) io.out('  (none synced yet)');
  for (const machine of summary.machines) {
    const here = machine.environmentId === me.environmentId ? ' (this machine)' : '';
    io.out(`  ${machine.label}${here}  ${machine.environmentId}  last sync ${machine.lastSyncAt}`);
  }
}
