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
import { writeEvictionBatch, type EvictionBatch } from '../../../../../src/lib/vault/evict.js';
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
  settleOnQueue,
  setupVaultFromDashboard,
  startVaultService,
  stopVaultService,
  syncVaultNow,
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

/** These tests exercise the sync cycle and eviction ops only; the poller has its own test file. */
const noopPoller = () => ({ start: () => undefined, stop: () => undefined, flush: async () => undefined });

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
    startVaultService({ readVaultConfig, openVaultContext, syncOnce, createVaultSettlePoller: noopPoller });

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
    startVaultService({ readVaultConfig, openVaultContext, syncOnce, createVaultSettlePoller: noopPoller });
    await vi.advanceTimersByTimeAsync(5000);
    expect(syncOnce).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('NFR-6: a rejecting readVaultConfig at boot logs a warning instead of an unhandled rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const readVaultConfig = vi.fn().mockRejectedValue(new Error('vault/config.json is not valid JSON'));
    startVaultService({ readVaultConfig, createVaultSettlePoller: noopPoller });
    await vi.advanceTimersByTimeAsync(5000);
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[vault] boot failed:', expect.any(Error));
    warn.mockRestore();
  });

  it('NFR-6: a scheduled cycle that rejects is reported through createSyncLoop\'s onError, not an unhandled rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const readVaultConfig = vi.fn()
      .mockResolvedValueOnce({ ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] }, syncIntervalSec: 60 })
      .mockRejectedValue(new Error('vault/config.json is not valid JSON'));
    const openVaultContext = vi.fn().mockResolvedValue({ status: 'off' } satisfies VaultOpenResult);
    startVaultService({ readVaultConfig, openVaultContext, createVaultSettlePoller: noopPoller });
    await vi.advanceTimersByTimeAsync(5000); // boot cycle succeeds (off)
    await vi.advanceTimersByTimeAsync(60_000); // next scheduled cycle rejects
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[vault] sync failed:', expect.any(Error));
    warn.mockRestore();
  });

  it('NFR-6: queuedSettle (passed to the poller) logs a warning instead of throwing when openVaultContext rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const readVaultConfig = vi.fn().mockResolvedValue({ ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] } });
    const openVaultContext = vi.fn().mockRejectedValue(new Error('key file is missing'));
    let capturedSettle: ((path: string, harness: string, wip: 'auto' | 'force') => Promise<void>) | null = null;
    const createVaultSettlePoller = (pollerDeps: { settle: typeof capturedSettle }) => {
      capturedSettle = pollerDeps.settle;
      return noopPoller();
    };
    startVaultService({ readVaultConfig, openVaultContext, createVaultSettlePoller });
    await expect(capturedSettle!('/a.jsonl', 'claude-code', 'auto')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[vault] settle failed for /a.jsonl:', expect.any(Error));
    warn.mockRestore();
  });

  it('FR-3: stopVaultService bounds the total wait to the 10s shutdown budget when the queue is not done in time', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const readVaultConfig = vi.fn().mockResolvedValue({ ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] } });
    const openVaultContext = vi.fn().mockResolvedValue({ status: 'off' } satisfies VaultOpenResult);
    startVaultService({ readVaultConfig, openVaultContext, createVaultSettlePoller: noopPoller });
    // Resolved after the assertions below, not left dangling: the queue is module-level
    // state shared with every later test in this file, so an operation that never
    // settles would wedge `enqueueVaultOperation` for the rest of the suite.
    let resolveStuck: () => void = () => undefined;
    enqueueVaultOperation('stuck', () => new Promise<void>((resolve) => { resolveStuck = resolve; }));

    const stopPromise = stopVaultService();
    await vi.advanceTimersByTimeAsync(10_000);
    await stopPromise;
    expect(warn).toHaveBeenCalledWith('[vault] shutdown budget exhausted while the queue was still draining');
    warn.mockRestore();
    resolveStuck();
    await Promise.resolve();
  });

  it('offline cycles back off and the delay caps at the configured interval', async () => {
    const readVaultConfig = vi.fn().mockResolvedValue({ ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] }, syncIntervalSec: 15 });
    const openVaultContext = vi.fn().mockResolvedValue({ status: 'open', vault: FAKE_VAULT } satisfies VaultOpenResult);
    const syncOnce = vi.fn().mockResolvedValue({ ...offReport(), offline: true });
    startVaultService({ readVaultConfig, openVaultContext, syncOnce, createVaultSettlePoller: noopPoller });

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
    startVaultService({ readVaultConfig, openVaultContext, syncOnce, scanEligible, isLive, createVaultSettlePoller: noopPoller });
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
    startVaultService({ readVaultConfig, openVaultContext, syncOnce, createVaultSettlePoller: noopPoller });
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
    startVaultService({ readVaultConfig, openVaultContext, syncOnce, createVaultSettlePoller: noopPoller });
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
    const deps: VaultServiceDeps = { readVaultConfig, openVaultContext, confirmEviction, isLive, createVaultSettlePoller: noopPoller };
    startVaultService(deps);
    // No eviction-batch.json on disk yet, so the current deletable (verified) set is empty.
    const result = await confirmEvictionBatch('fp-1', []);
    expect(confirmEviction).toHaveBeenCalledWith('fp-1', expect.objectContaining({ skipFailed: true, isLive }));
    expect(result).toEqual({ refused: false, deleted: [], skipped: [], bytesFreed: 0, fingerprint: 'abc' });
  });

  it('confirmEvictionBatch returns { unavailable } without calling confirmEviction when the vault is not open', async () => {
    const readVaultConfig = vi.fn().mockResolvedValue({ ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] } });
    const openVaultContext = vi.fn().mockResolvedValue({ status: 'off' } satisfies VaultOpenResult);
    const confirmEviction = vi.fn();
    startVaultService({ readVaultConfig, openVaultContext, confirmEviction, createVaultSettlePoller: noopPoller });
    const result = await confirmEvictionBatch('fp-1', []);
    expect(confirmEviction).not.toHaveBeenCalled();
    expect(result).toEqual({ unavailable: 'Session Vault is off. Run: pan vault setup <git-url>' });
  });

  it('confirmEvictionBatch refuses when the displayed deletable set no longer matches the current one, without calling confirmEviction', async () => {
    // A failed entry that became eligible again produces the same batchFingerprint
    // (it hashes vaultId/nativePath/sizeBytes/settlementChunk, never verification),
    // so this race is only caught by comparing the verified-vaultId sets themselves.
    const batch: EvictionBatch = {
      v: 1,
      entries: [
        { vaultId: 'v1', harness: 'claude-code', nativePath: '/a.jsonl', title: 't', sizeBytes: 10, settlementChunk: 'c1', verification: 'verified', checkedAt: 'x', addedAt: 'x' },
      ],
      declined: [],
    };
    await writeEvictionBatch(batch);
    const readVaultConfig = vi.fn().mockResolvedValue({ ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] } });
    const openVaultContext = vi.fn().mockResolvedValue({ status: 'open', vault: FAKE_VAULT } satisfies VaultOpenResult);
    const confirmEviction = vi.fn();
    startVaultService({ readVaultConfig, openVaultContext, confirmEviction, createVaultSettlePoller: noopPoller });
    // The caller displayed an empty deletable set (e.g. v1 was shown as failed).
    const result = await confirmEvictionBatch('fp-does-not-matter', []);
    expect(confirmEviction).not.toHaveBeenCalled();
    expect(result).toMatchObject({ refused: true });
  });

  it('getVaultServiceSnapshot reflects the live config even when the sync cycle never ran (peer dashboard, NFR-4)', async () => {
    // Never call vi.advanceTimersByTimeAsync: the boot cycle never fires, matching
    // a peer dashboard where startVaultService's background loop is real but the
    // caller never lets it tick before asking for status.
    const readVaultConfig = vi.fn().mockResolvedValue({ ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] }, backend: 'dir:x', evict: true });
    const openVaultContext = vi.fn().mockResolvedValue({ status: 'open', vault: FAKE_VAULT } satisfies VaultOpenResult);
    startVaultService({ readVaultConfig, openVaultContext, createVaultSettlePoller: noopPoller });

    const snapshot = await getVaultServiceSnapshot();
    expect(snapshot.state).toBe('ready');
    expect(snapshot.backend).toBe('dir:x');
    expect(snapshot.evict).toBe(true);
    expect(snapshot.running).toBe(true);
    expect(snapshot.lastSync).toBeNull();
  });

  it('reviewEvictionBatch computes the FR-9 shape from the local batch without opening the vault', async () => {
    const readVaultConfig = vi.fn().mockResolvedValue({ ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] }, evict: true });
    const openVaultContext = vi.fn();
    startVaultService({ readVaultConfig, openVaultContext, createVaultSettlePoller: noopPoller });
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

    startVaultService({ createVaultSettlePoller: noopPoller });
    await vi.advanceTimersByTimeAsync(5000); // boot cycle
    await vi.advanceTimersByTimeAsync(10000); // interval 1
    await vi.advanceTimersByTimeAsync(10000); // interval 2
    await vi.advanceTimersByTimeAsync(10000); // interval 3

    expect(doorMocks.removeTranscriptFile).not.toHaveBeenCalled();
    expect(doorMocks.removeTranscriptTree).not.toHaveBeenCalled();
  });

  describe('PAN-4446 WI-5: setup, join and Sync now', () => {
    const config = { ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] } };

    it('syncVaultNow on a service that is not started returns not-running and never calls syncOnce', async () => {
      const syncOnce = vi.fn();
      startVaultService({ readVaultConfig: vi.fn().mockResolvedValue(config), syncOnce, createVaultSettlePoller: noopPoller });
      await stopVaultService();
      expect(await syncVaultNow()).toEqual({ status: 'not-running' });
      expect(syncOnce).not.toHaveBeenCalled();
    });

    it('a boot config read that settles after stopVaultService never creates a sync loop', async () => {
      let resolveConfig!: (value: typeof config) => void;
      const readVaultConfig = vi.fn(() => new Promise<typeof config>((resolve) => { resolveConfig = resolve; }));
      const createSyncLoop = vi.fn(() => ({ start: () => undefined, stop: () => undefined }));
      startVaultService({ readVaultConfig, createSyncLoop, createVaultSettlePoller: noopPoller });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(readVaultConfig).toHaveBeenCalledTimes(1);
      await stopVaultService();
      resolveConfig(config);
      await vi.advanceTimersByTimeAsync(0);
      expect(createSyncLoop).not.toHaveBeenCalled();
    });

    it('syncVaultNow on a started service with an open vault calls syncOnce once and reports lastSync', async () => {
      const readVaultConfig = vi.fn().mockResolvedValue({ ...config, backend: 'dir:x' });
      const openVaultContext = vi.fn().mockResolvedValue({ status: 'open', vault: FAKE_VAULT } satisfies VaultOpenResult);
      const syncOnce = vi.fn().mockResolvedValue(offReport());
      startVaultService({ readVaultConfig, openVaultContext, syncOnce, createVaultSettlePoller: noopPoller });

      const result = await syncVaultNow();
      expect(syncOnce).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('synced');
      if (result.status !== 'synced') return;
      expect(result.snapshot.state).toBe('ready');
      expect(result.snapshot.lastSync?.at).toEqual(expect.any(String));
    });

    it('setupVaultFromDashboard waits for an in-flight queued operation before calling setupVault', async () => {
      const order: string[] = [];
      const setupVault = vi.fn(async () => {
        order.push('setup');
        return { status: 'already-set-up' as const, backend: 'dir:x' };
      });
      startVaultService({ readVaultConfig: vi.fn().mockResolvedValue(config), setupVault, createVaultSettlePoller: noopPoller });

      let release!: () => void;
      const inFlight = enqueueVaultOperation('held', () => new Promise<void>((resolve) => {
        release = () => {
          order.push('held');
          resolve();
        };
      }));
      const setup = setupVaultFromDashboard({ url: 'dir:x', passphrase: { mode: 'none' } });
      await vi.advanceTimersByTimeAsync(0);
      expect(setupVault).not.toHaveBeenCalled();

      release();
      await inFlight;
      expect(await setup).toEqual({ status: 'already-set-up', backend: 'dir:x' });
      expect(order).toEqual(['held', 'setup']);
      expect(setupVault).toHaveBeenCalledWith({ url: 'dir:x', passphrase: { mode: 'none' } });
    });

    it('syncVaultNow inside the boot window never creates a second sync loop', async () => {
      const readVaultConfig = vi.fn().mockResolvedValue({ ...config, syncIntervalSec: 60 });
      const openVaultContext = vi.fn().mockResolvedValue({ status: 'off' } satisfies VaultOpenResult);
      const createSyncLoop = vi.fn(() => ({ start: () => undefined, stop: () => undefined }));
      startVaultService({ readVaultConfig, openVaultContext, createSyncLoop, createVaultSettlePoller: noopPoller });

      expect((await syncVaultNow()).status).toBe('synced');
      await vi.advanceTimersByTimeAsync(5_000);
      expect(createSyncLoop).toHaveBeenCalledTimes(1);
    });
  });

  describe('PAN-4455 WI-1: settleOnQueue', () => {
    const config: VaultConfig = { ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] }, backend: 'dir:x' };

    it('settleOnQueue returns unavailable when the vault is not open', async () => {
      const settleSpy = vi.fn();
      startVaultService({
        readVaultConfig: vi.fn().mockResolvedValue(config),
        openVaultContext: vi.fn().mockResolvedValue({ status: 'off' } satisfies VaultOpenResult),
        settle: settleSpy,
        createVaultSettlePoller: noopPoller,
      });

      expect(await settleOnQueue('/a.jsonl', 'claude-code', 'force', { readBack: true })).toEqual({ status: 'unavailable', opened: { status: 'off' } });
      expect(settleSpy).not.toHaveBeenCalled();
    });

    it('settleOnQueue returns the settle result and, with readBack, the record', async () => {
      const backendDir = join(root, 'backend');
      const keys = deriveSubkeys(createVaultKey());
      const store = await DirVaultStore.open(backendDir);
      expect(await store.casRef(HEADER_REF_NAME, null, await encryptRef(HEADER_REF_NAME, newVaultHeader(), keys))).toBe('ok');
      const nativePath = join(root, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jsonl');
      writeFileSync(nativePath, `${JSON.stringify({ type: 'user', sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', message: { role: 'user', content: 'hi' } })}\n`);
      const verdict = await settle({ nativePath, harness: 'claude-code', store, keys, config });
      expect(verdict.verdict).toBe('append');

      const settleSpy = vi.fn().mockResolvedValue(verdict);
      const vault: OpenVault = { config, keys, store, rotatedAt: null };
      startVaultService({
        readVaultConfig: vi.fn().mockResolvedValue(config),
        openVaultContext: vi.fn().mockResolvedValue({ status: 'open', vault } satisfies VaultOpenResult),
        settle: settleSpy,
        createVaultSettlePoller: noopPoller,
      });

      const outcome = await settleOnQueue(nativePath, 'claude-code', 'force', { readBack: true });
      expect(settleSpy).toHaveBeenCalledWith({ nativePath, harness: 'claude-code', store, keys, config, wip: 'force' });
      expect(outcome.status).toBe('settled');
      if (outcome.status !== 'settled') return;
      expect(outcome.result).toBe(verdict);
      expect(outcome.record?.vaultId).toBe(verdict.vaultId);

      const withoutReadBack = await settleOnQueue(nativePath, 'claude-code', 'auto');
      expect(withoutReadBack).toEqual({ status: 'settled', result: verdict, record: null });
    });

    it('settleOnQueue runs on the vault queue', async () => {
      const order: string[] = [];
      const settleSpy = vi.fn(async () => {
        order.push('settle');
        return { verdict: 'noop' as const, vaultId: 'v1' };
      });
      startVaultService({
        readVaultConfig: vi.fn().mockResolvedValue(config),
        openVaultContext: vi.fn().mockResolvedValue({ status: 'open', vault: FAKE_VAULT } satisfies VaultOpenResult),
        settle: settleSpy,
        createVaultSettlePoller: noopPoller,
      });

      let release!: () => void;
      const inFlight = enqueueVaultOperation('held', () => new Promise<void>((resolve) => {
        release = () => {
          order.push('held');
          resolve();
        };
      }));
      const settled = settleOnQueue('/a.jsonl', 'claude-code', 'force');
      await vi.advanceTimersByTimeAsync(0);
      expect(settleSpy).not.toHaveBeenCalled();

      release();
      await inFlight;
      expect(await settled).toEqual({ status: 'settled', result: { verdict: 'noop', vaultId: 'v1' }, record: null });
      expect(order).toEqual(['held', 'settle']);
    });
  });
});
