import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VAULT_CONFIG_DEFAULTS, type VaultConfig } from '../../../../src/lib/vault/config.js';
import {
  batchFingerprint,
  clearBatch,
  declineEntry,
  evictionBatchPath,
  readEvictionBatch,
  reofferEntry,
  scanEligible,
} from '../../../../src/lib/vault/evict.js';
import { createVaultKey, deriveSubkeys } from '../../../../src/lib/vault/identity.js';
import { settle } from '../../../../src/lib/vault/settle.js';
import { DirVaultStore } from '../../../../src/lib/vault/store/dir.js';
import { syncOnce } from '../../../../src/lib/vault/sync.js';

const keys = deriveSubkeys(createVaultKey());
const SESSION = '44444444-4444-4444-8444-444444444444';
const HOUR = 60 * 60 * 1000;

function line(text: string, cwd: string): string {
  return JSON.stringify({ type: 'user', sessionId: SESSION, cwd, message: { role: 'user', content: text } });
}

/** Make a file look untouched for `ageMs`. */
function ageFile(path: string, ageMs: number): void {
  const when = new Date(Date.now() - ageMs);
  utimesSync(path, when, when);
}

describe('vault evict: pending-deletion batch', () => {
  let root: string;
  let cwd: string;
  let nativePath: string;
  let store: DirVaultStore;
  let config: VaultConfig;
  let originalHome: string | undefined;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'pan-vault-evict-'));
    cwd = join(root, 'repo');
    mkdirSync(cwd, { recursive: true });
    originalHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(root, '.overdeck');
    nativePath = join(root, `${SESSION}.jsonl`);
    writeFileSync(nativePath, [line('q1', cwd), line('q2', cwd)].join('\n') + '\n');
    store = await DirVaultStore.open(join(root, 'backend'));
    config = { ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] }, backend: 'dir', evict: true };
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  async function saved(): Promise<string> {
    const result = await settle({ nativePath, harness: 'claude-code', store, keys, config });
    if (result.verdict !== 'append') throw new Error(`expected append, got ${result.verdict}`);
    return result.vaultId;
  }

  it('ac1: with evict true, sync adds a verified quiet transcript to the batch and the file still exists', async () => {
    const vaultId = await saved();
    ageFile(nativePath, HOUR);
    const report = await syncOnce({ store, keys, config });
    expect(report.offline).toBe(false);
    const batch = await readEvictionBatch();
    expect(batch.entries).toHaveLength(1);
    expect(batch.entries[0]).toMatchObject({
      vaultId,
      harness: 'claude-code',
      nativePath,
      title: 'q1',
      sizeBytes: statSync(nativePath).size,
      verification: 'verified',
    });
    expect(batch.entries[0]!.settlementChunk).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(nativePath)).toBe(true);
    expect(statSync(evictionBatchPath()).mode & 0o777).toBe(0o600);

    // A second scan keeps one entry and its original addedAt.
    const again = await scanEligible({ store, keys, config });
    expect(again.entries).toHaveLength(1);
    expect(again.entries[0]!.addedAt).toBe(batch.entries[0]!.addedAt);
  });

  it('with evict false, sync never touches the batch', async () => {
    await saved();
    ageFile(nativePath, HOUR);
    await syncOnce({ store, keys, config: { ...config, evict: false } });
    expect(existsSync(evictionBatchPath())).toBe(false);
  });

  it('ac2: a transcript modified 5 minutes ago is not added', async () => {
    await saved();
    ageFile(nativePath, 5 * 60 * 1000);
    const batch = await scanEligible({ store, keys, config });
    expect(batch.entries).toEqual([]);
  });

  it('unsettled lines or a missing covering chunk keep a transcript out of the batch', async () => {
    const vaultId = await saved();
    appendFileSync(nativePath, line('unsettled', cwd) + '\n');
    ageFile(nativePath, HOUR);
    expect((await scanEligible({ store, keys, config })).entries).toEqual([]);

    // Settle the new line, then remove the covering chunk from the backend.
    const result = await settle({ nativePath, harness: 'claude-code', store, keys, config });
    if (result.verdict !== 'append') throw new Error('expected append');
    ageFile(nativePath, HOUR);
    expect((await scanEligible({ store, keys, config })).entries).toHaveLength(1);
    const chunkId = result.chunks[0]!;
    rmSync(join(root, 'backend', 'objects', chunkId.slice(0, 2), chunkId));
    const after = await scanEligible({ store, keys, config });
    expect(after.entries).toEqual([]);
    expect(existsSync(nativePath)).toBe(true);
    void vaultId;
  });

  it('a LOG that holds more lines than this machine\'s segment accounts for is never eligible', async () => {
    const vaultId = await saved();
    ageFile(nativePath, HOUR);
    expect((await scanEligible({ store, keys, config })).entries).toHaveLength(1);
    // Simulate a settlement that appended the same lines twice: the record's
    // LOG count exceeds the segment's native line count.
    const { encryptRef, readSessionRecord, refName } = await import('../../../../src/lib/vault/format.js');
    const name = refName('record', vaultId, keys.K_ref);
    const ref = (await store.readRef(name))!;
    const record = (await readSessionRecord(name, ref.value, keys)) as import('../../../../src/lib/vault/format.js').SessionRecord;
    const last = record.settlements[record.settlements.length - 1]!;
    expect(last.logLines).toBe(2);
    const corrupted = { ...record, settlements: [...record.settlements.slice(0, -1), { ...last, logLines: last.logLines! + 2 }] };
    expect(await store.casRef(name, ref.version, await encryptRef(name, corrupted, keys))).toBe('ok');
    const batch = await scanEligible({ store, keys, config });
    expect(batch.entries).toEqual([]);
    expect(existsSync(nativePath)).toBe(true);
  });

  it('a file the vault would not reproduce byte for byte (no final newline, blank line) is never eligible', async () => {
    // Written without a final newline: the last line is settled, but the file
    // is one byte short of what restore would write.
    const original = readFileSync(nativePath, 'utf8');
    writeFileSync(nativePath, original.trimEnd());
    expect((await settle({ nativePath, harness: 'claude-code', store, keys, config })).verdict).toBe('append');
    ageFile(nativePath, HOUR);
    expect((await scanEligible({ store, keys, config })).entries).toEqual([]);
    // The newline lands later: an unchanged transcript is noop, not diverged, and now eligible.
    writeFileSync(nativePath, original);
    ageFile(nativePath, HOUR);
    expect((await settle({ nativePath, harness: 'claude-code', store, keys, config })).verdict).toBe('noop');
    expect((await scanEligible({ store, keys, config })).entries).toHaveLength(1);
    // An extra blank line at the end: still noop for settlement, but never eligible.
    writeFileSync(nativePath, `${original}\n`);
    ageFile(nativePath, HOUR);
    expect((await settle({ nativePath, harness: 'claude-code', store, keys, config })).verdict).toBe('noop');
    expect((await scanEligible({ store, keys, config })).entries).toEqual([]);
    expect(existsSync(nativePath)).toBe(true);
  });

  it('ac3: a declined entry is not re-added until reofferEntry runs', async () => {
    const vaultId = await saved();
    ageFile(nativePath, HOUR);
    expect((await scanEligible({ store, keys, config })).entries).toHaveLength(1);
    const declined = await declineEntry(vaultId);
    expect(declined.entries).toEqual([]);
    expect(declined.declined).toEqual([{ vaultId, nativePath, declinedAt: expect.any(String) }]);
    expect((await scanEligible({ store, keys, config })).entries).toEqual([]);
    await reofferEntry(vaultId);
    expect((await readEvictionBatch()).declined).toEqual([]);
    expect((await scanEligible({ store, keys, config })).entries).toHaveLength(1);
    expect(existsSync(nativePath)).toBe(true);
  });

  it('ac4: clearBatch empties the batch, records no declines and deletes nothing', async () => {
    await saved();
    ageFile(nativePath, HOUR);
    await scanEligible({ store, keys, config });
    const cleared = await clearBatch();
    expect(cleared.entries).toEqual([]);
    expect(cleared.declined).toEqual([]);
    expect(existsSync(nativePath)).toBe(true);
    expect((await scanEligible({ store, keys, config })).entries).toHaveLength(1);
  });

  it('batchFingerprint depends only on the sorted identifying tuples', () => {
    const a = { vaultId: 'v1', nativePath: '/p1', sizeBytes: 10, settlementChunk: 'c1' };
    const b = { vaultId: 'v2', nativePath: '/p2', sizeBytes: 20, settlementChunk: 'c2' };
    const fp = batchFingerprint({ entries: [a, b] as never });
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(batchFingerprint({ entries: [b, a] as never })).toBe(fp);
    expect(batchFingerprint({ entries: [{ ...a, title: 'ignored', checkedAt: 'x' }, b] as never })).toBe(fp);
    expect(batchFingerprint({ entries: [{ ...a, sizeBytes: 11 }, b] as never })).not.toBe(fp);
    expect(batchFingerprint({ entries: [] })).not.toBe(fp);
    expect(readFileSync).toBeDefined();
  });
});
