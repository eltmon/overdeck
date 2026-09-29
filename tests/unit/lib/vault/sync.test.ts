import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureEnvironmentIdentity } from '../../../../src/lib/environment-identity.js';
import { VAULT_CONFIG_DEFAULTS, type VaultConfig } from '../../../../src/lib/vault/config.js';
import { encryptRef, refName } from '../../../../src/lib/vault/format.js';
import { createVaultKey, deriveSubkeys } from '../../../../src/lib/vault/identity.js';
import { readListCache } from '../../../../src/lib/vault/local-index.js';
import { settle } from '../../../../src/lib/vault/settle.js';
import { DirVaultStore } from '../../../../src/lib/vault/store/dir.js';
import { createSyncLoop, syncOnce } from '../../../../src/lib/vault/sync.js';

const keys = deriveSubkeys(createVaultKey());
const SESSION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function user(text: string, cwd: string): string {
  return JSON.stringify({ type: 'user', sessionId: SESSION, cwd, message: { role: 'user', content: text } });
}

describe('vault sync: syncOnce', () => {
  let root: string;
  let homeA: string;
  let homeB: string;
  let cwd: string;
  let store: DirVaultStore;
  let config: VaultConfig;
  let originalHome: string | undefined;

  const useHome = (home: string) => { process.env.OVERDECK_HOME = home; };

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'pan-vault-sync-'));
    homeA = join(root, 'machine-a', '.overdeck');
    homeB = join(root, 'machine-b', '.overdeck');
    cwd = join(root, 'proj');
    mkdirSync(cwd, { recursive: true });
    originalHome = process.env.OVERDECK_HOME;
    store = await DirVaultStore.open(join(root, 'backend'));
    config = { ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] }, backend: 'dir' };
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('ac1: a record settled on A appears in B list cache owned by A', async () => {
    useHome(homeA);
    const nativePath = join(root, 'a-session.jsonl');
    writeFileSync(nativePath, `${user('the distinctive title line', cwd)}\n`);
    const saved = await settle({ nativePath, harness: 'claude-code', store, keys, config });
    expect(saved.verdict).toBe('append');
    const a = await ensureEnvironmentIdentity();
    const reportA = await syncOnce({ store, keys, config });
    expect(reportA.offline).toBe(false);
    expect(reportA.records).toBe(1);
    expect((await readListCache())[0]).toMatchObject({ title: 'the distinctive title line', ownerIsHere: true, ownerLabel: a.label });
    expect(reportA.machines.map((machine) => machine.environmentId)).toEqual([a.environmentId]);

    // A grew its transcript: the next sync settles it without an explicit save.
    appendFileSync(nativePath, `${user('more', cwd)}\n`);
    const reportA2 = await syncOnce({ store, keys, config });
    expect(reportA2.settled).toHaveLength(1);
    expect(reportA2.settled[0]!.result).toMatchObject({ verdict: 'append', lines: 1 });

    useHome(homeB);
    const b = await ensureEnvironmentIdentity();
    expect(b.environmentId).not.toBe(a.environmentId);
    const reportB = await syncOnce({ store, keys, config });
    expect(reportB.offline).toBe(false);
    expect(reportB.settled).toEqual([]);
    const rows = await readListCache();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      vaultId: (saved as { vaultId: string }).vaultId,
      title: 'the distinctive title line',
      harness: 'claude-code',
      ownerLabel: a.label,
      ownerIsHere: false,
      tombstone: false,
    });
    expect(reportB.machines.map((machine) => machine.environmentId).sort()).toEqual([a.environmentId, b.environmentId].sort());
  });

  it('one transcript whose settlement throws is reported and does not stop the cycle', async () => {
    useHome(homeA);
    const good = join(root, 'good.jsonl');
    writeFileSync(good, `${user('fine', cwd)}\n`);
    expect((await settle({ nativePath: good, harness: 'claude-code', store, keys, config })).verdict).toBe('append');
    // An owned entry whose "file" is a directory: readFile throws EISDIR inside settle.
    const { setOwnedTail } = await import('../../../../src/lib/vault/local-index.js');
    const broken = join(root, 'broken-dir');
    mkdirSync(broken);
    await setOwnedTail(broken, { vaultId: 'v-broken', harness: 'claude-code', tail: { lineCount: 0, byteOffset: 0, lastHashes: [] } });
    appendFileSync(good, `${user('more', cwd)}\n`);
    const report = await syncOnce({ store, keys, config });
    expect(report.offline).toBe(false);
    expect(report.errors).toEqual([{ nativePath: broken, message: expect.stringMatching(/EISDIR|directory/i) }]);
    expect(report.settled.map((entry) => entry.nativePath)).toEqual([good]);
    expect(report.settled[0]!.result).toMatchObject({ verdict: 'append', lines: 1 });
    expect(report.records).toBe(1);
  });

  it('ac2: a ref whose type is "task" is skipped without error', async () => {
    useHome(homeA);
    const taskName = refName('record', 'task-1', keys.K_ref);
    await store.casRef(taskName, null, await encryptRef(taskName, { v: 1, type: 'task', vaultId: 'task-1' } as never, keys));
    const tombName = refName('record', 'gone', keys.K_ref);
    await store.casRef(tombName, null, await encryptRef(tombName, { v: 1, type: 'session', vaultId: 'gone', tombstone: true }, keys));
    const report = await syncOnce({ store, keys, config });
    expect(report.offline).toBe(false);
    expect(report.skipped).toBe(1);
    expect(report.records).toBe(1);
    expect(await readListCache()).toEqual([expect.objectContaining({ vaultId: 'gone', tombstone: true })]);
  });

  it('tolerant.ac1: a ref sealed under an unknown key is counted unreadable and sync completes', async () => {
    useHome(homeA);
    const nativePath = join(root, 'a-session.jsonl');
    writeFileSync(nativePath, `${user('a readable conversation', cwd)}\n`);
    const saved = await settle({ nativePath, harness: 'claude-code', store, keys, config });
    expect(saved.verdict).toBe('append');
    const unknown = deriveSubkeys(createVaultKey());
    const junkRecord = `r/${'0'.repeat(40)}`;
    const junkMachine = `m/${'1'.repeat(40)}`;
    await store.casRef(junkRecord, null, await encryptRef(junkRecord, { v: 1, type: 'session', vaultId: 'junk', tombstone: true }, unknown));
    await store.casRef(junkMachine, null, Buffer.from('not an envelope'));

    const report = await syncOnce({ store, keys, config });
    expect(report.offline).toBe(false);
    expect(report.unreadable).toBe(2);
    expect(report.retired).toBe(0);
    expect(report.records).toBe(1);
    expect(report.machines).toHaveLength(1);
    expect((await readListCache()).map((row) => row.vaultId)).toEqual([(saved as { vaultId: string }).vaultId]);
  });

  it('tolerant.ac2: a retired-ref marker under a ring key is counted retired, not listed', async () => {
    useHome(homeA);
    const retired = deriveSubkeys(createVaultKey());
    const current = { ...keys, previous: [deriveSubkeys(createVaultKey()), retired] };
    const marker = { v: 1 as const, type: 'retired' as const, at: '2026-09-29T00:00:00.000Z' };
    const oldRecord = refName('record', 'moved', retired.K_ref);
    const oldMachine = refName('machine', 'env-old', retired.K_ref);
    await store.casRef(oldRecord, null, await encryptRef(oldRecord, marker, retired));
    await store.casRef(oldMachine, null, await encryptRef(oldMachine, marker, retired));
    const liveName = refName('record', 'moved', current.K_ref);
    await store.casRef(liveName, null, await encryptRef(liveName, { v: 1, type: 'session', vaultId: 'moved', tombstone: true }, current));

    const report = await syncOnce({ store, keys: current, config });
    expect(report.offline).toBe(false);
    expect(report.retired).toBe(2);
    expect(report.unreadable).toBe(0);
    expect(report.skipped).toBe(0);
    expect(report.records).toBe(1);
    expect((await readListCache()).map((row) => row.vaultId)).toEqual(['moved']);
    // Without the ring the same markers are unreadable, and sync still completes.
    const blind = await syncOnce({ store, keys, config });
    expect(blind.retired).toBe(0);
    expect(blind.unreadable).toBe(2);
  });

  it('an offline refresh returns { offline: true } and touches nothing', async () => {
    useHome(homeA);
    const offlineStore = { ...store, refresh: async () => { const { VaultOfflineError } = await import('../../../../src/lib/vault/store/types.js'); throw new VaultOfflineError('down'); } };
    const report = await syncOnce({ store: offlineStore as never, keys, config });
    expect(report).toMatchObject({ offline: true, settled: [], records: 0 });
    expect(await readListCache()).toEqual([]);
  });
});

describe('vault sync: createSyncLoop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ac3: offline cycles back off exponentially, capped at intervalSec, without throwing', async () => {
    const calls: number[] = [];
    const run = vi.fn(async () => {
      calls.push(Date.now());
      return { offline: true };
    });
    const loop = createSyncLoop({ intervalSec: 60, run, initialBackoffSec: 5 });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    const expectedDelays = [5_000, 10_000, 20_000, 40_000, 60_000, 60_000];
    for (const delay of expectedDelays) {
      expect(loop.nextDelayMs()).toBe(delay);
      await vi.advanceTimersByTimeAsync(delay - 1);
      const before = run.mock.calls.length;
      await vi.advanceTimersByTimeAsync(1);
      expect(run).toHaveBeenCalledTimes(before + 1);
    }
    const gaps = calls.slice(1).map((time, i) => time - calls[i]!);
    expect(gaps).toEqual(expectedDelays);
    loop.stop();
    expect(loop.nextDelayMs()).toBeNull();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(run).toHaveBeenCalledTimes(expectedDelays.length + 1);
  });

  it('a successful cycle resets the backoff and reschedules at the interval', async () => {
    let offline = true;
    const run = vi.fn(async () => ({ offline }));
    const loop = createSyncLoop({ intervalSec: 30, run, initialBackoffSec: 5 });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(loop.nextDelayMs()).toBe(5_000);
    offline = false;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(loop.nextDelayMs()).toBe(30_000);
    offline = true;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(loop.nextDelayMs()).toBe(5_000);
    loop.stop();
  });

  it('a throwing run counts as offline and reports the error', async () => {
    const onError = vi.fn();
    const loop = createSyncLoop({ intervalSec: 10, run: async () => { throw new Error('boom'); }, initialBackoffSec: 2, onError });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(loop.nextDelayMs()).toBe(2_000);
    loop.stop();
  });
});
