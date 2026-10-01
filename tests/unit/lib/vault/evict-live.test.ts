/** PAN-4307 WI-2 (D-4, D-6): injectable `isLive` and `confirmEviction`'s `skipFailed`. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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
import { settle } from '../../../../src/lib/vault/settle.js';
import { DirVaultStore } from '../../../../src/lib/vault/store/dir.js';

const keys = deriveSubkeys(createVaultKey());
const HOUR = 60 * 60 * 1000;

function line(session: string, text: string, cwd: string): string {
  return JSON.stringify({ type: 'user', sessionId: session, cwd, message: { role: 'user', content: text } });
}

function ageFile(path: string, ageMs: number): void {
  const when = new Date(Date.now() - ageMs);
  utimesSync(path, when, when);
}

describe('vault evict: injectable liveness and skipFailed (PAN-4307 WI-2)', () => {
  let root: string;
  let cwd: string;
  let store: DirVaultStore;
  let config: VaultConfig;
  let originalHome: string | undefined;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'pan-vault-evict-live-'));
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

  it('scanEligible with isLive -> true adds nothing and keeps the file', async () => {
    const a = await savedTranscript('live', ['one']);
    const isLive = vi.fn().mockResolvedValue(true);
    const batch = await scanEligible({ store, keys, config, isLive });
    expect(batch.entries).toEqual([]);
    expect(isLive).toHaveBeenCalledWith(a.nativePath);
    expect(existsSync(a.nativePath)).toBe(true);
  });

  it('scanEligible with isLive that throws adds nothing (uncertain counts as live)', async () => {
    await savedTranscript('throws', ['one']);
    const isLive = vi.fn().mockRejectedValue(new Error('probe failed'));
    const batch = await scanEligible({ store, keys, config, isLive });
    expect(batch.entries).toEqual([]);
  });

  it('scanEligible with isLive -> false is unaffected: the transcript is added as usual', async () => {
    await savedTranscript('quiet', ['one']);
    const isLive = vi.fn().mockResolvedValue(false);
    const batch = await scanEligible({ store, keys, config, isLive });
    expect(batch.entries).toHaveLength(1);
  });

  it('confirmEviction with isLive -> true skips the entry with reason "session is live in Overdeck" and keeps the file', async () => {
    const a = await savedTranscript('confirm-live', ['one']);
    await scanEligible({ store, keys, config });
    const fingerprint = batchFingerprint(await readEvictionBatch());
    const isLive = vi.fn().mockResolvedValue(true);

    const result = await confirmEviction(fingerprint, { store, keys, config, isLive });
    expect(result.refused).toBe(false);
    if (result.refused) return;
    expect(result.deleted).toEqual([]);
    expect(result.skipped).toEqual([{ nativePath: a.nativePath, reason: 'session is live in Overdeck' }]);
    expect(existsSync(a.nativePath)).toBe(true);
    expect(doorMocks.removeTranscriptFile).not.toHaveBeenCalled();

    const batch = await readEvictionBatch();
    expect(batch.entries).toHaveLength(1);
    expect(batch.entries[0]).toMatchObject({ nativePath: a.nativePath, verification: 'failed', reason: 'session is live in Overdeck' });
  });

  it('confirmEviction with skipFailed: true leaves a failed entry untouched even once it would now pass, and still deletes a verified entry in the same batch', async () => {
    const failing = await savedTranscript('failing', ['one']);
    const verified = await savedTranscript('verified', ['two']);
    await scanEligible({ store, keys, config });
    const fingerprint = batchFingerprint(await readEvictionBatch());

    // First confirm marks `failing` as failed (isLive true only for that path) and deletes `verified`.
    const isLiveOnlyFailing = vi.fn(async (nativePath: string) => nativePath === failing.nativePath);
    const first = await confirmEviction(fingerprint, { store, keys, config, isLive: isLiveOnlyFailing });
    expect(first.refused).toBe(false);
    if (first.refused) return;
    expect(first.deleted).toEqual([verified.nativePath]);
    expect(existsSync(verified.nativePath)).toBe(false);
    expect(existsSync(failing.nativePath)).toBe(true);
    doorMocks.removeTranscriptFile.mockClear();

    const afterFirst = await readEvictionBatch();
    expect(afterFirst.entries).toEqual([expect.objectContaining({ nativePath: failing.nativePath, verification: 'failed' })]);

    // Second confirm: with skipFailed true and no isLive, the failed entry is
    // left exactly as it is, not re-checked, not deleted, and not reported skipped.
    const second = await confirmEviction(batchFingerprint(afterFirst), { store, keys, config, skipFailed: true });
    expect(second.refused).toBe(false);
    if (second.refused) return;
    expect(second.deleted).toEqual([]);
    expect(second.skipped).toEqual([]);
    expect(doorMocks.removeTranscriptFile).not.toHaveBeenCalled();
    expect(existsSync(failing.nativePath)).toBe(true);
    const afterSecond = await readEvictionBatch();
    expect(afterSecond.entries).toEqual(afterFirst.entries);
  });
});
