import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const doorMocks = vi.hoisted(() => ({ removeTranscriptFile: vi.fn(), removeTranscriptTree: vi.fn() }));
vi.mock('../../../../src/lib/cloister/transcript-deletion-door.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/cloister/transcript-deletion-door.js')>();
  doorMocks.removeTranscriptFile.mockImplementation(actual.removeTranscriptFile);
  doorMocks.removeTranscriptTree.mockImplementation(actual.removeTranscriptTree);
  return doorMocks;
});

import { VAULT_CONFIG_DEFAULTS, type VaultConfig } from '../../../../src/lib/vault/config.js';
import { batchFingerprint, confirmEviction, readEvictionBatch, scanEligible } from '../../../../src/lib/vault/evict.js';
import { createVaultKey, deriveSubkeys } from '../../../../src/lib/vault/identity.js';
import { restoreNative } from '../../../../src/lib/vault/materialize.js';
import { readSessionRecord, refName, type SessionRecord } from '../../../../src/lib/vault/format.js';
import { settle } from '../../../../src/lib/vault/settle.js';
import { DirVaultStore } from '../../../../src/lib/vault/store/dir.js';
import { createSyncLoop, syncOnce } from '../../../../src/lib/vault/sync.js';

const keys = deriveSubkeys(createVaultKey());
const HOUR = 60 * 60 * 1000;

function line(session: string, text: string, cwd: string): string {
  return JSON.stringify({ type: 'user', sessionId: session, cwd, message: { role: 'user', content: text } });
}

function ageFile(path: string, ageMs: number): void {
  const when = new Date(Date.now() - ageMs);
  utimesSync(path, when, when);
}

describe('vault evict: confirmEviction', () => {
  let root: string;
  let cwd: string;
  let store: DirVaultStore;
  let config: VaultConfig;
  let originalHome: string | undefined;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'pan-vault-confirm-'));
    cwd = join(root, 'repo');
    mkdirSync(cwd, { recursive: true });
    originalHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(root, '.overdeck');
    store = await DirVaultStore.open(join(root, 'backend'));
    config = { ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] }, backend: 'dir', evict: true };
    doorMocks.removeTranscriptFile.mockClear();
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  async function savedTranscript(session: string, texts: string[]): Promise<{ nativePath: string; vaultId: string }> {
    const nativePath = join(root, `${session}.jsonl`);
    writeFileSync(nativePath, texts.map((text) => line(session, text, cwd)).join('\n') + '\n');
    const result = await settle({ nativePath, harness: 'claude-code', store, keys, config });
    if (result.verdict !== 'append') throw new Error(`expected append, got ${result.verdict}`);
    ageFile(nativePath, HOUR);
    return { nativePath, vaultId: result.vaultId };
  }

  it('ac1: a stale fingerprint deletes nothing and returns the current one', async () => {
    const a = await savedTranscript('a', ['one']);
    await scanEligible({ store, keys, config });
    const reviewed = batchFingerprint(await readEvictionBatch());
    const b = await savedTranscript('b', ['two']);
    await scanEligible({ store, keys, config });
    const current = batchFingerprint(await readEvictionBatch());
    expect(current).not.toBe(reviewed);

    const result = await confirmEviction(reviewed, { store, keys, config });
    expect(result).toEqual({ refused: true, fingerprint: current });
    expect(existsSync(a.nativePath)).toBe(true);
    expect(existsSync(b.nativePath)).toBe(true);
    expect(doorMocks.removeTranscriptFile).not.toHaveBeenCalled();
    expect((await readEvictionBatch()).entries).toHaveLength(2);
  });

  it('ac2: deletes only entries that still verify; a grown file stays with a reason', async () => {
    const ok = await savedTranscript('ok', ['fine']);
    const grown = await savedTranscript('grown', ['before']);
    await scanEligible({ store, keys, config });
    const fingerprint = batchFingerprint(await readEvictionBatch());
    appendFileSync(grown.nativePath, line('grown', 'typed after review', cwd) + '\n');
    ageFile(grown.nativePath, HOUR);
    const grownBytes = readFileSync(grown.nativePath);
    const okSize = statSync(ok.nativePath).size;

    const result = await confirmEviction(fingerprint, { store, keys, config });
    expect(result.refused).toBe(false);
    if (result.refused) return;
    expect(result.deleted).toEqual([ok.nativePath]);
    expect(result.bytesFreed).toBe(okSize);
    expect(result.skipped).toEqual([{ nativePath: grown.nativePath, reason: expect.stringMatching(/not yet settled|lines|size/) }]);
    expect(existsSync(ok.nativePath)).toBe(false);
    expect(readFileSync(grown.nativePath).equals(grownBytes)).toBe(true);
    expect(doorMocks.removeTranscriptFile).toHaveBeenCalledTimes(1);
    expect(doorMocks.removeTranscriptFile).toHaveBeenCalledWith(ok.nativePath);

    const batch = await readEvictionBatch();
    expect(batch.entries).toHaveLength(1);
    expect(batch.entries[0]).toMatchObject({ nativePath: grown.nativePath, verification: 'failed', reason: expect.any(String) });
    expect(result.fingerprint).toBe(batchFingerprint(batch));

    // The evicted transcript restores byte for byte from the vault.
    const name = refName('record', ok.vaultId, keys.K_ref);
    const record = (await readSessionRecord(name, (await store.readRef(name))!.value, keys)) as SessionRecord;
    await restoreNative({ record, store, keys, nativePath: ok.nativePath });
    expect(readFileSync(ok.nativePath, 'utf8')).toBe(line('ok', 'fine', cwd) + '\n');
  });

  it('ac3: settle, sync, scanning and the sync loop never call the deletion door', async () => {
    vi.useFakeTimers();
    try {
      const a = await savedTranscript('loop', ['x']);
      ageFile(a.nativePath, HOUR);
      await syncOnce({ store, keys, config });
      await scanEligible({ store, keys, config });
      expect((await readEvictionBatch()).entries).toHaveLength(1);
      const loop = createSyncLoop({ intervalSec: 60, run: () => syncOnce({ store, keys, config }) });
      loop.start();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(3 * 60_000);
      loop.stop();
      expect(doorMocks.removeTranscriptFile).not.toHaveBeenCalled();
      expect(doorMocks.removeTranscriptTree).not.toHaveBeenCalled();
      expect(existsSync(a.nativePath)).toBe(true);

      const fingerprint = batchFingerprint(await readEvictionBatch());
      const result = await confirmEviction(fingerprint, { store, keys, config });
      expect(result).toMatchObject({ refused: false, deleted: [a.nativePath] });
      expect(doorMocks.removeTranscriptFile).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
