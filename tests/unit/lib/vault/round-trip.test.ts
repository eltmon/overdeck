import { describe, expect, it } from 'vitest';
import type { ListCacheRow, LocalIndex, OwnedEntry } from '../../../../src/lib/vault/local-index.js';
import { roundTripStates } from '../../../../src/lib/vault/round-trip.js';

const TAIL = { lineCount: 0, byteOffset: 0, lastHashes: [] };

function owned(vaultId: string): OwnedEntry {
  return { vaultId, harness: 'claude-code', tail: TAIL };
}

function row(overrides: Partial<ListCacheRow> & { vaultId: string }): ListCacheRow {
  return {
    title: '',
    harness: 'claude-code',
    ownerLabel: '',
    ownerIsHere: true,
    updatedAt: '',
    tombstone: false,
    ...overrides,
  };
}

function index(owned_: LocalIndex['owned'], listCache: ListCacheRow[]): Pick<LocalIndex, 'owned' | 'listCache'> {
  return { owned: owned_, listCache };
}

describe('roundTripStates', () => {
  it('round-trip-states.ac1: a row owned elsewhere yields continued-elsewhere', () => {
    const states = roundTripStates(
      index(
        { '/native/a.jsonl': owned('v-a') },
        [row({ vaultId: 'v-a', ownerIsHere: false, ownerLabel: 'laptop-b' })],
      ),
    );
    expect(states.get('/native/a.jsonl')).toEqual({ kind: 'continued-elsewhere', vaultId: 'v-a', ownerLabel: 'laptop-b' });
  });

  it('round-trip-states.ac2: a settlement fork whose parent is owned elsewhere yields forked-locally', () => {
    const states = roundTripStates(
      index(
        { '/native/a.jsonl': owned('v-fork') },
        [
          row({ vaultId: 'v-fork', ownerIsHere: true, forkKind: 'settlement', parentVaultId: 'v-parent' }),
          row({ vaultId: 'v-parent', ownerIsHere: false, ownerLabel: 'laptop-b' }),
        ],
      ),
    );
    expect(states.get('/native/a.jsonl')).toEqual({
      kind: 'forked-locally',
      forkVaultId: 'v-fork',
      parentVaultId: 'v-parent',
      parentOwnerLabel: 'laptop-b',
    });
  });

  it('round-trip-states.ac3: no entry for owned-here, tombstone, missing, version-fork, or locally-owned/tombstoned/missing parent rows', () => {
    const owned_: LocalIndex['owned'] = {
      '/native/plain.jsonl': owned('v-plain'),
      '/native/tomb.jsonl': owned('v-tomb'),
      '/native/missing.jsonl': owned('v-missing'),
      '/native/version-fork.jsonl': owned('v-version-fork'),
      '/native/parent-here.jsonl': owned('v-fork-parent-here'),
      '/native/parent-tomb.jsonl': owned('v-fork-parent-tomb'),
      '/native/parent-missing.jsonl': owned('v-fork-parent-missing'),
    };
    const listCache: ListCacheRow[] = [
      row({ vaultId: 'v-plain', ownerIsHere: true }),
      row({ vaultId: 'v-tomb', tombstone: true }),
      // v-missing has no row at all.
      row({ vaultId: 'v-version-fork', ownerIsHere: true, forkKind: 'version', parentVaultId: 'v-version-parent' }),
      row({ vaultId: 'v-version-parent', ownerIsHere: false, ownerLabel: 'laptop-b' }),
      row({ vaultId: 'v-fork-parent-here', ownerIsHere: true, forkKind: 'settlement', parentVaultId: 'v-parent-here' }),
      row({ vaultId: 'v-parent-here', ownerIsHere: true }),
      row({ vaultId: 'v-fork-parent-tomb', ownerIsHere: true, forkKind: 'settlement', parentVaultId: 'v-parent-tomb' }),
      row({ vaultId: 'v-parent-tomb', tombstone: true }),
      row({ vaultId: 'v-fork-parent-missing', ownerIsHere: true, forkKind: 'settlement', parentVaultId: 'v-parent-missing' }),
      // v-parent-missing has no row at all.
    ];
    const states = roundTripStates(index(owned_, listCache));
    expect(states.size).toBe(0);
  });
});
