/**
 * pan vault show <id> — read-only view of one saved conversation: the human
 * turns and assistant text of the VIEW, and every settlement with its version
 * number (for `pan vault resume <id>@<version>`).
 */
import { isTombstone, readSessionRecord, refName, type SessionRecord } from '../../../lib/vault/format.js';
import type { VaultSubkeys } from '../../../lib/vault/identity.js';
import { readListCache } from '../../../lib/vault/local-index.js';
import { readViewLines } from '../../../lib/vault/materialize.js';
import { collectTurns } from '../../../lib/vault/seed.js';
import type { VaultStore } from '../../../lib/vault/store/types.js';
import { defaultIo, openVault, type CliIo } from './shared.js';

export interface ShowOptions {
  json?: boolean;
}

/** Resolve a full or prefix vaultId through the list cache; an exact id always works. */
export async function resolveVaultId(idOrPrefix: string): Promise<string | null> {
  const rows = await readListCache();
  const exact = rows.find((row) => row.vaultId === idOrPrefix);
  if (exact) return exact.vaultId;
  const matches = rows.filter((row) => row.vaultId.startsWith(idOrPrefix));
  if (matches.length === 1) return matches[0]!.vaultId;
  if (matches.length > 1) throw new Error(`${idOrPrefix} matches ${matches.length} saved conversations; give more characters`);
  return /^[0-9a-f-]{36}$/.test(idOrPrefix) ? idOrPrefix : null;
}

export async function loadRecord(vaultId: string, store: VaultStore, keys: VaultSubkeys): Promise<SessionRecord | null> {
  const name = refName('record', vaultId, keys.K_ref);
  const ref = await store.readRef(name);
  if (!ref) return null;
  const value = await readSessionRecord(name, ref.value, keys);
  return value && !isTombstone(value) ? value : null;
}

export async function showCommand(id: string, options: ShowOptions = {}, io: CliIo = defaultIo): Promise<void> {
  const vault = await openVault(io);
  if (!vault) return;
  const vaultId = await resolveVaultId(id);
  const record = vaultId ? await loadRecord(vaultId, vault.store, vault.keys) : null;
  if (!record) {
    io.err(`No saved conversation matches ${id}. Run pan vault sync, then pan vault list.`);
    return io.exit(1);
  }
  const view = await readViewLines(record, vault.store, vault.keys);
  const turns = collectTurns(view.lines, record.harness);
  const archived = record.settlementsArchive?.length ?? 0;
  const versions = record.settlements.map((settlement, index) => ({
    version: archived + index + 1,
    at: settlement.at,
    turn: settlement.turn,
    lines: settlement.lines,
  }));
  if (options.json) {
    io.out(JSON.stringify({ record, turns, versions }, null, 2));
    return;
  }
  io.out(`${record.title}`);
  io.out(`id ${record.vaultId}  harness ${record.harness}  owner ${record.owner.label}  cwd ${record.cwd}`);
  if (record.parent) io.out(`forked from ${record.parent.vaultId}@${record.parent.version}`);
  io.out('');
  turns.forEach((turn, index) => {
    io.out(`## Turn ${index + 1}`);
    io.out(`Human: ${turn.human}`);
    if (turn.assistant) io.out(`Assistant: ${turn.assistant}`);
    io.out('');
  });
  io.out('Versions (resume with pan vault resume <id>@<version>):');
  for (const entry of versions) io.out(`  v${entry.version}  ${entry.at}  turn ${entry.turn}  ${entry.lines} lines`);
}
