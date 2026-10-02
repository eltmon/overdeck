/**
 * Round-trip states for the dashboard "Continued on <machine>" / "Local
 * turns saved as a fork" rows (PAN-4447, PRD FR-2).
 *
 * Pure projection over the machine-local index: no I/O, no vault access.
 * Imports only types from `local-index.js`.
 */
import type { ListCacheRow, LocalIndex } from './local-index.js';

export type RoundTripState =
  | { kind: 'continued-elsewhere'; vaultId: string; ownerLabel: string }
  | { kind: 'forked-locally'; forkVaultId: string; parentVaultId: string; parentOwnerLabel: string };

/** Owned native paths whose list-cache row shows the conversation moved, keyed by native path. */
export function roundTripStates(index: Pick<LocalIndex, 'owned' | 'listCache'>): Map<string, RoundTripState> {
  const rowsByVaultId = new Map<string, ListCacheRow>(index.listCache.map((row) => [row.vaultId, row]));
  const states = new Map<string, RoundTripState>();

  for (const [nativePath, entry] of Object.entries(index.owned)) {
    const row = rowsByVaultId.get(entry.vaultId);
    if (!row || row.tombstone) continue;

    if (!row.ownerIsHere) {
      states.set(nativePath, { kind: 'continued-elsewhere', vaultId: row.vaultId, ownerLabel: row.ownerLabel });
      continue;
    }

    if (row.forkKind !== 'settlement' || !row.parentVaultId) continue;
    const parentRow = rowsByVaultId.get(row.parentVaultId);
    if (!parentRow || parentRow.tombstone || parentRow.ownerIsHere) continue;
    states.set(nativePath, {
      kind: 'forked-locally',
      forkVaultId: row.vaultId,
      parentVaultId: row.parentVaultId,
      parentOwnerLabel: parentRow.ownerLabel,
    });
  }

  return states;
}
