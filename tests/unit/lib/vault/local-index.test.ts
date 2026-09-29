import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tail } from '../../../../src/lib/vault/continuity.js';
import {
  getOwned,
  listOwned,
  localIndexPath,
  readListCache,
  readLocalIndex,
  removeOwned,
  replaceListCache,
  setOwnedTail,
  type ListCacheRow,
} from '../../../../src/lib/vault/local-index.js';

const TAIL: Tail = { lineCount: 42, byteOffset: 9001, lastHashes: ['0123456789abcdef', 'fedcba9876543210'] };

describe('vault local index', () => {
  let root: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-vault-index-'));
    originalHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(root, '.overdeck');
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('starts empty when no index exists', async () => {
    expect(await readLocalIndex()).toEqual({ v: 1, owned: {}, listCache: [] });
    expect(await getOwned('/nope')).toBeNull();
    expect(await readListCache()).toEqual([]);
  });

  it('ac1: setOwnedTail persists and a fresh read from disk returns the tail', async () => {
    const path = '/home/u/.claude/projects/x/abc.jsonl';
    await setOwnedTail(path, { vaultId: 'v1', harness: 'claude-code', tail: TAIL });

    // Simulate a new process: read straight from the file, then through the API.
    const onDisk = JSON.parse(readFileSync(localIndexPath(), 'utf8'));
    expect(onDisk.owned[path]).toEqual({ vaultId: 'v1', harness: 'claude-code', tail: TAIL });
    expect(await getOwned(path)).toEqual({ vaultId: 'v1', harness: 'claude-code', tail: TAIL });

    const updated = { ...TAIL, lineCount: 43 };
    await setOwnedTail(path, { vaultId: 'v1', harness: 'claude-code', tail: updated });
    expect((await getOwned(path))!.tail).toEqual(updated);
    expect(Object.keys(await listOwned())).toEqual([path]);
  });

  it('ac2: replaceListCache round-trips rows in the same order', async () => {
    const rows: ListCacheRow[] = [
      { vaultId: 'b', title: 'Second', harness: 'codex', ownerLabel: 'laptop', ownerIsHere: false, updatedAt: '2026-09-28T01:00:00Z', tombstone: false },
      { vaultId: 'a', title: 'First', harness: 'claude-code', ownerLabel: 'desktop', ownerIsHere: true, updatedAt: '2026-09-28T00:00:00Z', tombstone: false },
      { vaultId: 'c', title: 'Gone', harness: 'claude-code', ownerLabel: 'desktop', ownerIsHere: true, updatedAt: '2026-09-27T00:00:00Z', tombstone: true },
    ];
    await replaceListCache(rows);
    expect(await readListCache()).toEqual(rows);
    await replaceListCache(rows.slice(0, 1));
    expect(await readListCache()).toEqual(rows.slice(0, 1));
  });

  it('ac3: index.json is written with mode 0600 and no temp file remains', async () => {
    await setOwnedTail('/p', { vaultId: 'v', harness: 'claude-code', tail: TAIL });
    expect(statSync(localIndexPath()).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(root, '.overdeck', 'vault'))).toEqual(['index.json']);
  });

  it('owned entries and the list cache do not disturb each other; removeOwned forgets a path', async () => {
    await setOwnedTail('/p1', { vaultId: 'v1', harness: 'claude-code', tail: TAIL });
    await replaceListCache([{ vaultId: 'v1', title: 't', harness: 'claude-code', ownerLabel: 'here', ownerIsHere: true, updatedAt: 'x', tombstone: false }]);
    await setOwnedTail('/p2', { vaultId: 'v2', harness: 'codex', tail: TAIL });
    expect((await readListCache()).length).toBe(1);
    expect(Object.keys(await listOwned()).sort()).toEqual(['/p1', '/p2']);
    await removeOwned('/p1');
    await removeOwned('/never-there');
    expect(Object.keys(await listOwned())).toEqual(['/p2']);
    expect((await readListCache()).length).toBe(1);
  });
});
