import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ListCacheRow, LocalIndex, OwnedEntry } from '../../vault/local-index.js';
import { buildVaultContinuityLookup, loadVaultContinuityLookup, vaultContinuityFor } from '../conversation-vault-continuity.js';

const HOME = '/home/user/.overdeck';
const TAIL = { lineCount: 0, byteOffset: 0, lastHashes: [] };

function owned(vaultId: string, harness: string): OwnedEntry {
  return { vaultId, harness, tail: TAIL };
}

function row(overrides: Partial<ListCacheRow> & { vaultId: string }): ListCacheRow {
  return { title: '', harness: '', ownerLabel: '', ownerIsHere: true, updatedAt: '', tombstone: false, ...overrides };
}

describe('vaultContinuityFor', () => {
  it('conversation-continuity-map.ac1: matches a Claude row by <claudeSessionId>.jsonl basename; null without claudeSessionId', () => {
    const index: Pick<LocalIndex, 'owned' | 'listCache'> = {
      owned: { '/native/abc.jsonl': owned('v-1', 'claude-code') },
      listCache: [row({ vaultId: 'v-1', ownerIsHere: false, ownerLabel: 'laptop' })],
    };
    const lookup = buildVaultContinuityLookup(index, HOME);
    expect(vaultContinuityFor({ origin: 'local', harness: 'claude-code', claudeSessionId: 'abc', tmuxSession: 'conv-x' }, lookup))
      .toEqual({ kind: 'continued-elsewhere', vaultId: 'v-1', ownerLabel: 'laptop' });
    expect(vaultContinuityFor({ origin: 'local', harness: null, claudeSessionId: null, tmuxSession: 'conv-x' }, lookup)).toBeNull();
  });

  it('conversation-continuity-map.ac2: matches a Codex row under <home>/agents/<tmuxSession>/, rejects a longer sibling segment, greater path wins', () => {
    const index: Pick<LocalIndex, 'owned' | 'listCache'> = {
      owned: {
        [join(HOME, 'agents', 'conv-x', 'rollout-a.jsonl')]: owned('v-a', 'codex'),
        [join(HOME, 'agents', 'conv-x', 'rollout-b.jsonl')]: owned('v-b', 'codex'),
        [join(HOME, 'agents', 'conv-xy', 'rollout-c.jsonl')]: owned('v-c', 'codex'),
      },
      listCache: [
        row({ vaultId: 'v-a', ownerIsHere: false, ownerLabel: 'laptop' }),
        row({ vaultId: 'v-b', ownerIsHere: false, ownerLabel: 'laptop' }),
        row({ vaultId: 'v-c', ownerIsHere: false, ownerLabel: 'laptop' }),
      ],
    };
    const lookup = buildVaultContinuityLookup(index, HOME);
    expect(vaultContinuityFor({ origin: 'local', harness: 'codex', claudeSessionId: null, tmuxSession: 'conv-x' }, lookup))
      .toEqual({ kind: 'continued-elsewhere', vaultId: 'v-b', ownerLabel: 'laptop' });
    expect(vaultContinuityFor({ origin: 'local', harness: 'codex', claudeSessionId: null, tmuxSession: 'conv-xy' }, lookup))
      .toEqual({ kind: 'continued-elsewhere', vaultId: 'v-c', ownerLabel: 'laptop' });
  });

  it('conversation-continuity-map.ac3: null for a vault browse row and for a pi-harness row', () => {
    const index: Pick<LocalIndex, 'owned' | 'listCache'> = {
      owned: { '/native/abc.jsonl': owned('v-1', 'claude-code') },
      listCache: [row({ vaultId: 'v-1', ownerIsHere: false, ownerLabel: 'laptop' })],
    };
    const lookup = buildVaultContinuityLookup(index, HOME);
    expect(vaultContinuityFor({ origin: 'vault', harness: 'claude-code', claudeSessionId: 'abc', tmuxSession: 'conv-x' }, lookup)).toBeNull();
    expect(vaultContinuityFor({ origin: 'local', harness: 'ohmypi', claudeSessionId: null, tmuxSession: 'conv-x' }, lookup)).toBeNull();
  });

  describe('conversation-continuity-map.ac4', () => {
    let root: string;
    let originalHome: string | undefined;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'pan-vault-continuity-'));
      originalHome = process.env.OVERDECK_HOME;
      process.env.OVERDECK_HOME = root;
      mkdirSync(join(root, 'vault'), { recursive: true });
      writeFileSync(join(root, 'vault', 'index.json'), '{ not json');
    });

    afterEach(() => {
      if (originalHome === undefined) delete process.env.OVERDECK_HOME;
      else process.env.OVERDECK_HOME = originalHome;
      rmSync(root, { recursive: true, force: true });
    });

    it('an unreadable vault index resolves without throwing, and every row returns null', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const lookup = await loadVaultContinuityLookup();
      warnSpy.mockRestore();
      expect(vaultContinuityFor({ origin: 'local', harness: 'claude-code', claudeSessionId: 'anything', tmuxSession: 'conv-x' }, lookup)).toBeNull();
    });
  });
});
