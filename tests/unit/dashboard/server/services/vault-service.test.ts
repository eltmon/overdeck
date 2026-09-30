/** PAN-4307 WI-4: vault-service queue, sync loop, snapshot and eviction operations. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const doorMocks = vi.hoisted(() => ({ removeTranscriptFile: vi.fn(), removeTranscriptTree: vi.fn() }));
vi.mock('../../../../../src/lib/cloister/transcript-deletion-door.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/cloister/transcript-deletion-door.js')>();
  doorMocks.removeTranscriptFile.mockImplementation(actual.removeTranscriptFile);
  doorMocks.removeTranscriptTree.mockImplementation(actual.removeTranscriptTree);
  return doorMocks;
});

import { ensureEnvironmentIdentity } from '../../../../../src/lib/environment-identity.js';
import { VAULT_CONFIG_DEFAULTS, writeVaultConfig, type VaultConfig } from '../../../../../src/lib/vault/config.js';
import { HEADER_REF_NAME, encryptRef, newVaultHeader } from '../../../../../src/lib/vault/format.js';
import { createVaultKey, deriveSubkeys, saveVaultKey } from '../../../../../src/lib/vault/identity.js';
import { settle } from '../../../../../src/lib/vault/settle.js';
import type { SyncReport } from '../../../../../src/lib/vault/sync.js';
import { DirVaultStore } from '../../../../../src/lib/vault/store/dir.js';
import type { OpenVault, VaultOpenResult } from '../../../../../src/lib/vault/open.js';
import {
  confirmEvictionBatch,
  enqueueVaultOperation,
  getVaultServiceSnapshot,
  onVaultSyncReport,
  reviewEvictionBatch,
  startVaultService,
  stopVaultService,
  type VaultServiceDeps,
} from '../../../../../src/dashboard/server/services/vault-service.js';

const FAKE_VAULT: OpenVault = {
  config: { ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] }, backend: 'dir:x' },
  keys: {} as never,
  store: {} as never,
  rotatedAt: null,
};

function offReport(): SyncReport {
  return { offline: false, settled: [], records: 0, skipped: 0, machines: [], retired: 0, unreadable: 0, errors: [] };
}

describe('vault-service (PAN-4307 WI-4)', () => {
  let root: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    root = mkdtempSync(join(tmpdir(), 'pan-vault-service-'));
    originalHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(root, '.overdeck');
    doorMocks.removeTranscriptFile.mockClear();
  });

  afterEach(async () => {
    await stopVaultService();
    vi.useRealTimers();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('the first cycle runs 5s after start and not before; subsequent cycles run at the configured interval', async () => {
    const readVaultConfig = vi.fn().mockResolvedValue({ ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] }, syncIntervalSec: 60 });
    const openVaultContext = vi.fn().mockResolvedValue({ status: 'off' } satisfies VaultOpenResult);
    const syncOnce = vi.fn();
    startVaultService({ readVaultConfig, openVaultContext, syncOnce });

    await vi.advanceTimersByTimeAsync(4999);
    expect(openVaultContext).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(openVaultContext).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(59999);
    expect(openVaultContext).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(openVaultContext).toHaveBeenCalledTimes(2);
    expect(syncOnce).not.toHaveBeenCalled();
  });

  it('a vault that is off never calls syncOnce and logs nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const readVaultConfig = vi.fn().mockResolvedValue({ ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] } });
    const openVaultContext = vi.fn().mockResolvedValue({ status: 'off' } satisfies VaultOpenResult);
    const syncOnce = vi.fn();
    startVaultService({ readVaultConfig, openVaultContext, syncOnce });
    await vi.advanceTimersByTimeAsync(5000);
    expect(syncOnce).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('offline cycles back off and the delay caps at the configured interval', async () => {
    const readVaultConfig = vi.fn().mockResolvedValue({ ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] }, syncIntervalSec: 15 });
    const openVaultContext = vi.fn().mockResolvedValue({ status: 'open', vault: FAKE_VAULT } satisfies VaultOpenResult);
    const syncOnce = vi.fn().mockResolvedValue({ ...offReport(), offline: true });
    startVaultService({ readVaultConfig, openVaultContext, syncOnce });

    await vi.advanceTimersByTimeAsync(5000); // boot cycle @5000
    expect(syncOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000); // +5s backoff @10000
    expect(syncOnce).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10000); // +10s backoff @20000
    expect(syncOnce).toHaveBeenCalledTimes(3);
    // Backoff is now capped at the 15s interval: the next call lands exactly 15s later.
    await vi.advanceTimersByTimeAsync(14999);
    expect(syncOnce).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(syncOnce).toHaveBeenCalledTimes(4);
  });

  it('evict: true passes isLive through to scanEligible', async () => {
    const isLive = vi.fn().mockResolvedValue(false);
    const readVaultConfig = vi.fn().mockResolvedValue({ ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] }, evict: true });
    const openVaultContext = vi.fn().mockResolvedValue({ status: 'open', vault: FAKE_VAULT } satisfies VaultOpenResult);
    const scanEligible = vi.fn().mockResolvedValue({ v: 1, entries: [], declined: [] });
    const syncOnce = vi.fn().mockImplementation(async (options: { afterSettle?: (report: SyncReport) => Promise<void> }) => {
      await options.afterSettle?.(offReport());
      return offReport();
    });
    startVaultService({ readVaultConfig, openVaultContext, syncOnce, scanEligible, isLive });
    await vi.advanceTimersByTimeAsync(5000);
    expect(scanEligible).toHaveBeenCalledTimes(1);
    expect(scanEligible.mock.calls[0]![0]).toMatchObject({ isLive });
  });

  it('a sync-report listener that throws does not stop the cycle', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const readVaultConfig = vi.fn().mockResolvedValue({ ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] } });
    const openVaultContext = vi.fn().mockResolvedValue({ status: 'open', vault: FAKE_VAULT } satisfies VaultOpenResult);
    const report = offReport();
    const syncOnce = vi.fn().mockImplementation(async (options: { afterSettle?: (report: SyncReport) => Promise<void> }) => {
      await options.afterSettle?.(report);
      return report;
    });
    const unregister = onVaultSyncReport(() => {
      throw new Error('listener boom');
    });
    startVaultService({ readVaultConfig, openVaultContext, syncOnce });
    await vi.advanceTimersByTimeAsync(5000);
    expect(syncOnce).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[vault] sync-report listener failed:', expect.any(Error));
    unregister();
    warn.mockRestore();
  });

  it('the snapshot marks this machine and carries MachineRecord.updatedAt as lastSyncedAt', async () => {
    const me = await ensureEnvironmentIdentity();
    const readVaultConfig = vi.fn().mockResolvedValue({ ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] } });
    const openVaultContext = vi.fn().mockResolvedValue({ status: 'open', vault: FAKE_VAULT } satisfies VaultOpenResult);
    const report: SyncReport = {
      ...offReport(),
      records: 2,
      machines: [
        { v: 1, type: 'machine', environmentId: me.environmentId, label: me.label, updatedAt: '2026-01-01T00:00:00.000Z' },
        { v: 1, type: 'machine', environmentId: 'someone-else', label: 'Other Machine', updatedAt: '2026-01-02T00:00:00.000Z' },
      ],
    };
    const syncOnce = vi.fn().mockResolvedValue(report);
    startVaultService({ readVaultConfig, openVaultContext, syncOnce });
    await vi.advanceTimersByTimeAsync(5000);
    const snapshot = await getVaultServiceSnapshot();
    expect(snapshot.state).toBe('ready');
    expect(snapshot.machines).toEqual([
      { label: me.label, isThisMachine: true, lastSyncedAt: '2026-01-01T00:00:00.000Z' },
      { label: 'Other Machine', isThisMachine: false, lastSyncedAt: '2026-01-02T00:00:00.000Z' },
    ]);
  });

  it('two operations enqueued together never overlap: a deferred first op blocks the second', async () => {
    let resolveFirst: () => void = () => undefined;
    const first = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { resolveFirst = resolve; }));
    const second = vi.fn().mockResolvedValue(undefined);
    const p1 = enqueueVaultOperation('first', first);
    const p2 = enqueueVaultOperation('second', second);
    await Promise.resolve();
    await Promise.resolve();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    resolveFirst();
    await p1;
    await p2;
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('confirmEvictionBatch opens the vault and calls confirmEviction with skipFailed: true', async () => {
    const isLive = vi.fn();
    const readVaultConfig = vi.fn().mockResolvedValue({ ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] } });
    const openVaultContext = vi.fn().mockResolvedValue({ status: 'open', vault: FAKE_VAULT } satisfies VaultOpenResult);
    const confirmEviction = vi.fn().mockResolvedValue({ refused: false, deleted: [], skipped: [], bytesFreed: 0, fingerprint: 'abc' });
    const deps: VaultServiceDeps = { readVaultConfig, openVaultContext, confirmEviction, isLive };
    startVaultService(deps);
    const result = await confirmEvictionBatch('fp-1');
    expect(confirmEviction).toHaveBeenCalledWith('fp-1', expect.objectContaining({ skipFailed: true, isLive }));
    expect(result).toEqual({ refused: false, deleted: [], skipped: [], bytesFreed: 0, fingerprint: 'abc' });
  });

  it('confirmEvictionBatch returns { unavailable } without calling confirmEviction when the vault is not open', async () => {
    const readVaultConfig = vi.fn().mockResolvedValue({ ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] } });
    const openVaultContext = vi.fn().mockResolvedValue({ status: 'off' } satisfies VaultOpenResult);
    const confirmEviction = vi.fn();
    startVaultService({ readVaultConfig, openVaultContext, confirmEviction });
    const result = await confirmEvictionBatch('fp-1');
    expect(confirmEviction).not.toHaveBeenCalled();
    expect(result).toEqual({ unavailable: 'Session Vault is off. Run: pan vault setup <git-url>' });
  });

  it('reviewEvictionBatch computes the FR-9 shape from the local batch without opening the vault', async () => {
    const readVaultConfig = vi.fn().mockResolvedValue({ ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] }, evict: true });
    const openVaultContext = vi.fn();
    startVaultService({ readVaultConfig, openVaultContext });
    const response = await reviewEvictionBatch();
    expect(openVaultContext).not.toHaveBeenCalled();
    expect(response).toEqual({ evict: true, fingerprint: expect.any(String), entries: [], declined: [], totalBytes: 0, deletableCount: 0, deletableBytes: 0 });
  });

  it('integration: boot + 3 intervals with evict true and an eligible fixture never reaches the deletion door', async () => {
    const backendDir = join(root, 'backend');
    const key = createVaultKey();
    const keys = deriveSubkeys(key);
    const store = await DirVaultStore.open(backendDir);
    expect(await store.casRef(HEADER_REF_NAME, null, await encryptRef(HEADER_REF_NAME, newVaultHeader(), keys))).toBe('ok');
    await saveVaultKey(key);
    const backend = `dir:${backendDir}`;
    const config: VaultConfig = { ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] }, backend, evict: true, syncIntervalSec: 10 };
    await writeVaultConfig(config);

    const cwd = join(root, 'repo');
    mkdirSync(cwd, { recursive: true });
    const nativePath = join(root, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jsonl');
    writeFileSync(nativePath, `${JSON.stringify({ type: 'user', sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', cwd, message: { role: 'user', content: 'hi' } })}\n`);
    expect((await settle({ nativePath, harness: 'claude-code', store, keys, config })).verdict).toBe('append');
    const HOUR = 60 * 60 * 1000;
    utimesSync(nativePath, new Date(Date.now() - HOUR), new Date(Date.now() - HOUR));

    startVaultService();
    await vi.advanceTimersByTimeAsync(5000); // boot cycle
    await vi.advanceTimersByTimeAsync(10000); // interval 1
    await vi.advanceTimersByTimeAsync(10000); // interval 2
    await vi.advanceTimersByTimeAsync(10000); // interval 3

    expect(doorMocks.removeTranscriptFile).not.toHaveBeenCalled();
    expect(doorMocks.removeTranscriptTree).not.toHaveBeenCalled();
  });
});
