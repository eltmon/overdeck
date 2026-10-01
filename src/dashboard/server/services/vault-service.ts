/**
 * Session Vault dashboard consumer: queue, sync loop, status snapshot and
 * eviction operations (PAN-4307 WI-4, FR-4..FR-11, FR-13, NFR-3, NFR-4).
 *
 * Every vault operation the dashboard performs runs through one in-process
 * promise queue (`enqueueVaultOperation`, FR-6), one at a time, so a sync
 * cycle and an eviction confirm can never race the vault engine's own
 * file-locked writes against each other from this process. The vault
 * config and handle are resolved fresh on every operation (FR-7), so a
 * `pan vault setup`/`join`/`rotate-key`/config edit made in a terminal takes
 * effect without a dashboard restart.
 *
 * This module never calls the transcript deletion door itself (NFR-3): the
 * only path to it is `confirmEvictionBatch` -> `confirmEviction` in the
 * engine, and only in response to an explicit operator confirmation carrying
 * the current batch fingerprint.
 */
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { VAULT_OFF_MESSAGE, readVaultConfig as readVaultConfigDefault, type VaultConfig } from '../../../lib/vault/config.js';
import {
  batchFingerprint,
  clearBatch,
  confirmEviction as confirmEvictionDefault,
  declineEntry,
  readEvictionBatch,
  reofferEntry,
  scanEligible as scanEligibleDefault,
  type ConfirmResult,
  type EvictionBatch,
} from '../../../lib/vault/evict.js';
import { joinVault as joinVaultDefault, type JoinSecret, type JoinVaultResult } from '../../../lib/vault/join-core.js';
import { VaultKeyRetiredError } from '../../../lib/vault/keyring.js';
import { openVaultContext as openVaultContextDefault, type OpenVault, type VaultOpenResult } from '../../../lib/vault/open.js';
import { settle as settleDefault } from '../../../lib/vault/settle.js';
import { setupVault as setupVaultDefault, type SetupPassphrase, type SetupVaultResult } from '../../../lib/vault/setup-core.js';
import { createSyncLoop as createSyncLoopDefault, syncOnce as syncOnceDefault, type SyncLoop, type SyncReport } from '../../../lib/vault/sync.js';
import type { WipMode } from '../../../lib/vault/wip-capture.js';
import { createVaultIsLive } from './vault-liveness.js';
import { createVaultSettlePoller as createVaultSettlePollerDefault, type VaultSettlePoller } from './vault-settle-poller.js';

/** First cycle this long after `startVaultService()`; subsequent cycles at `syncIntervalSec`. */
export const VAULT_BOOT_DELAY_MS = 5_000;

export interface VaultServiceDeps {
  openVaultContext?: typeof openVaultContextDefault;
  readVaultConfig?: typeof readVaultConfigDefault;
  syncOnce?: typeof syncOnceDefault;
  createSyncLoop?: typeof createSyncLoopDefault;
  scanEligible?: typeof scanEligibleDefault;
  confirmEviction?: typeof confirmEvictionDefault;
  isLive?: (nativePath: string) => Promise<boolean>;
  now?: () => Date;
  settle?: typeof settleDefault;
  createVaultSettlePoller?: typeof createVaultSettlePollerDefault;
  setupVault?: typeof setupVaultDefault;
  joinVault?: typeof joinVaultDefault;
}

type ResolvedDeps = Required<VaultServiceDeps>;

function resolveDeps(deps: VaultServiceDeps): ResolvedDeps {
  return {
    openVaultContext: deps.openVaultContext ?? openVaultContextDefault,
    readVaultConfig: deps.readVaultConfig ?? readVaultConfigDefault,
    syncOnce: deps.syncOnce ?? syncOnceDefault,
    createSyncLoop: deps.createSyncLoop ?? createSyncLoopDefault,
    scanEligible: deps.scanEligible ?? scanEligibleDefault,
    confirmEviction: deps.confirmEviction ?? confirmEvictionDefault,
    isLive: deps.isLive ?? createVaultIsLive(),
    now: deps.now ?? (() => new Date()),
    settle: deps.settle ?? settleDefault,
    createVaultSettlePoller: deps.createVaultSettlePoller ?? createVaultSettlePollerDefault,
    setupVault: deps.setupVault ?? setupVaultDefault,
    joinVault: deps.joinVault ?? joinVaultDefault,
  };
}

export interface VaultStatusResponse {
  state: 'off' | 'rotation-pending' | 'key-missing' | 'key-mismatch' | 'ready';
  running: boolean;
  backend: string | null;
  evict: boolean;
  lastSync: null | {
    at: string;
    offline: boolean;
    records: number;
    appended: number;
    errors: Array<{ nativePath: string; message: string }>;
    blocked: Array<{ nativePath: string; vaultId: string; hits: Array<{ line: number; pattern: string }> }>;
  };
  machines: Array<{ label: string; isThisMachine: boolean; lastSyncedAt: string }>;
}

export interface EvictionBatchResponse {
  evict: boolean;
  fingerprint: string;
  entries: Array<{
    vaultId: string;
    title: string;
    harness: string;
    nativePath: string;
    sizeBytes: number;
    verification: 'verified' | 'failed';
    reason?: string;
    checkedAt: string;
  }>;
  declined: Array<{ vaultId: string; nativePath: string; declinedAt: string }>;
  totalBytes: number;
  deletableCount: number;
  deletableBytes: number;
}

interface VaultSnapshotState {
  state: VaultStatusResponse['state'];
  backend: string | null;
  evict: boolean;
  lastSync: VaultStatusResponse['lastSync'];
  /** Raw machine records from the last sync; `isThisMachine` is resolved at read time. */
  machines: Array<{ environmentId: string; label: string; updatedAt: string }>;
}

function initialSnapshot(): VaultSnapshotState {
  return { state: 'off', backend: null, evict: false, lastSync: null, machines: [] };
}

let started = false;
/** Bumped on every start and stop; a boot read that outlives its run must not create a loop. */
let runGeneration = 0;
let deps: ResolvedDeps = resolveDeps({});
let bootTimer: ReturnType<typeof setTimeout> | null = null;
let loop: SyncLoop | null = null;
let currentIntervalSec: number | null = null;
let poller: VaultSettlePoller | null = null;
let queueTail: Promise<unknown> = Promise.resolve();
let snapshot: VaultSnapshotState = initialSnapshot();
const listeners = new Set<(report: SyncReport, vault: OpenVault) => void | Promise<void>>();

/** Run `run` after every operation ahead of it in the queue has settled (FR-6). */
export function enqueueVaultOperation<T>(_label: string, run: () => Promise<T>): Promise<T> {
  const result = queueTail.then(run, run);
  queueTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function applyOpenStatus(opened: VaultOpenResult, config: VaultConfig): void {
  snapshot.evict = config.evict;
  switch (opened.status) {
    case 'off':
      snapshot.state = 'off';
      snapshot.backend = null;
      break;
    case 'rotation-pending':
      snapshot.state = 'rotation-pending';
      snapshot.backend = opened.backend;
      break;
    case 'key-missing':
      snapshot.state = 'key-missing';
      snapshot.backend = opened.backend;
      break;
    case 'key-mismatch':
      snapshot.state = 'key-mismatch';
      snapshot.backend = opened.backend;
      break;
    case 'open':
      snapshot.state = 'ready';
      snapshot.backend = config.backend ?? null;
      break;
  }
}

function applySyncReport(report: SyncReport): void {
  const appended = report.settled.filter((entry) => entry.result.verdict === 'append').length;
  const blocked = report.settled
    .filter((entry): entry is typeof entry & { result: { verdict: 'blocked'; vaultId: string; hits: Array<{ line: number; pattern: string }> } } => entry.result.verdict === 'blocked')
    .map((entry) => ({ nativePath: entry.nativePath, vaultId: entry.result.vaultId, hits: entry.result.hits }));
  snapshot.lastSync = {
    at: deps.now().toISOString(),
    offline: report.offline,
    records: report.records,
    appended,
    errors: report.errors,
    blocked,
  };
  snapshot.machines = report.machines.map((machine) => ({ environmentId: machine.environmentId, label: machine.label, updatedAt: machine.updatedAt }));
}

/** Recreate the sync loop when a cycle reads a different `syncIntervalSec` (D-8). */
function maybeRecreateLoop(intervalSec: number): void {
  if (currentIntervalSec === intervalSec) return;
  currentIntervalSec = intervalSec;
  if (loop) loop.stop();
  loop = deps.createSyncLoop({ intervalSec, run: () => enqueueVaultOperation('sync', cycle), onError: (error) => console.warn('[vault] sync failed:', error) });
  loop.start();
}

async function cycle(): Promise<{ offline: boolean }> {
  if (!started) return { offline: false };
  const config = await deps.readVaultConfig();
  maybeRecreateLoop(config.syncIntervalSec);
  return runSync(config);
}

/**
 * One sync against the vault as it is on disk now. Split from `cycle()` so
 * "Sync now" never touches loop management: inside the boot window
 * `currentIntervalSec` is still null, and recreating the loop there would
 * leave the boot handler starting a second one.
 */
async function runSync(config: VaultConfig): Promise<{ offline: boolean }> {
  const opened = await deps.openVaultContext();
  applyOpenStatus(opened, config);
  if (opened.status !== 'open') return { offline: false };
  const { store, keys } = opened.vault;
  try {
    const report = await deps.syncOnce({
      store,
      keys,
      config,
      afterSettle: async (settled) => {
        if (config.evict) {
          try {
            await deps.scanEligible({ store, keys, config, isLive: deps.isLive });
          } catch (error) {
            console.warn('[vault] eviction scan failed:', error);
          }
        }
        for (const listener of listeners) {
          try {
            await listener(settled, opened.vault);
          } catch (error) {
            console.warn('[vault] sync-report listener failed:', error);
          }
        }
      },
    });
    applySyncReport(report);
    return { offline: report.offline };
  } catch (error) {
    if (error instanceof VaultKeyRetiredError) {
      snapshot.state = 'key-mismatch';
      return { offline: false };
    }
    throw error;
  }
}

/** Idempotent: a second call while already started does nothing. */
/** A failing settle logs once per distinct message and never throws out of the poller's timers (NFR-6). */
async function queuedSettle(path: string, harness: string, wip: WipMode): Promise<void> {
  return enqueueVaultOperation('settle', async () => {
    try {
      const opened = await deps.openVaultContext();
      if (opened.status !== 'open') return;
      const config = await deps.readVaultConfig();
      await deps.settle({ nativePath: path, harness, store: opened.vault.store, keys: opened.vault.keys, config, wip });
    } catch (error) {
      console.warn(`[vault] settle failed for ${path}:`, error);
    }
  });
}

export function startVaultService(overrides: VaultServiceDeps = {}): void {
  if (started) return;
  started = true;
  const generation = ++runGeneration;
  deps = resolveDeps(overrides);
  snapshot = initialSnapshot();
  currentIntervalSec = null;
  loop = null;
  bootTimer = setTimeout(() => {
    bootTimer = null;
    void (async () => {
      if (!started) return;
      const config = await deps.readVaultConfig();
      if (generation !== runGeneration) return;
      currentIntervalSec = config.syncIntervalSec;
      loop = deps.createSyncLoop({ intervalSec: config.syncIntervalSec, run: () => enqueueVaultOperation('sync', cycle), onError: (error) => console.warn('[vault] sync failed:', error) });
      loop.start();
    })().catch((error) => console.warn('[vault] boot failed:', error));
  }, VAULT_BOOT_DELAY_MS);
  if (typeof bootTimer.unref === 'function') bootTimer.unref();
  poller = deps.createVaultSettlePoller({ settle: queuedSettle });
  poller.start();
}

/** FR-3: the whole shutdown sequence (flush plus any queued cycle/settle) fits in one 10 s budget. */
const VAULT_SHUTDOWN_BUDGET_MS = 10_000;

/** Stops the poller (flushing pending settles) and the loop, and awaits the queue draining. */
export async function stopVaultService(): Promise<void> {
  if (!started) return;
  started = false;
  runGeneration++;
  const deadline = Date.now() + VAULT_SHUTDOWN_BUDGET_MS;
  if (bootTimer) {
    clearTimeout(bootTimer);
    bootTimer = null;
  }
  if (loop) {
    loop.stop();
    loop = null;
  }
  currentIntervalSec = null;
  if (poller) {
    const current = poller;
    poller = null;
    current.stop();
    await current.flush(Math.max(0, deadline - Date.now())).catch((error) => console.warn('[vault] shutdown flush failed:', error));
  }
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    console.warn('[vault] shutdown budget exhausted before the queue drained');
    return;
  }
  let timedOut = false;
  await Promise.race([
    queueTail.catch(() => undefined),
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        resolve();
      }, remaining);
      if (typeof timer.unref === 'function') timer.unref();
    }),
  ]);
  if (timedOut) console.warn('[vault] shutdown budget exhausted while the queue was still draining');
}

/**
 * FR-7: resolved fresh on every call, not just while the sync cycle is
 * running, so a peer dashboard (background service never started, NFR-4)
 * and a primary dashboard between cycles both report the vault's real
 * on-disk state rather than a frozen "off" default.
 */
export async function getVaultServiceSnapshot(): Promise<VaultStatusResponse> {
  const config = await deps.readVaultConfig();
  const opened = await deps.openVaultContext();
  applyOpenStatus(opened, config);
  const me = await ensureEnvironmentIdentity();
  return {
    state: snapshot.state,
    running: started,
    backend: snapshot.backend,
    evict: snapshot.evict,
    lastSync: snapshot.lastSync,
    machines: snapshot.machines.map((machine) => ({
      label: machine.label,
      isThisMachine: machine.environmentId === me.environmentId,
      lastSyncedAt: machine.updatedAt,
    })),
  };
}

/** D-7: setup runs on the vault queue, started or not. Never logs the result (it carries secrets). */
export function setupVaultFromDashboard(input: { url: string; passphrase: SetupPassphrase }): Promise<SetupVaultResult> {
  return enqueueVaultOperation('setup', () => deps.setupVault(input));
}

/** D-7: join (and unlock) runs on the vault queue, started or not. Never logs the input (it carries secrets). */
export function joinVaultFromDashboard(input: { url: string; secret: JoinSecret }): Promise<JoinVaultResult> {
  return enqueueVaultOperation('join', () => deps.joinVault(input));
}

/** D-6: one queued sync; refuses on a dashboard whose vault service never started. Never touches loop management. */
export async function syncVaultNow(): Promise<{ status: 'not-running' } | { status: 'synced'; snapshot: VaultStatusResponse }> {
  if (!started) return { status: 'not-running' };
  await enqueueVaultOperation('sync-now', async () => runSync(await deps.readVaultConfig()));
  return { status: 'synced', snapshot: await getVaultServiceSnapshot() };
}

export function onVaultSyncReport(listener: (report: SyncReport, vault: OpenVault) => void | Promise<void>): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function buildEvictionBatchResponse(batch: EvictionBatch, config: VaultConfig): Promise<EvictionBatchResponse> {
  const deletable = batch.entries.filter((entry) => entry.verification === 'verified');
  return {
    evict: config.evict,
    fingerprint: batchFingerprint(batch),
    entries: batch.entries.map((entry) => ({
      vaultId: entry.vaultId,
      title: entry.title,
      harness: entry.harness,
      nativePath: entry.nativePath,
      sizeBytes: entry.sizeBytes,
      verification: entry.verification,
      reason: entry.reason,
      checkedAt: entry.checkedAt,
    })),
    declined: batch.declined.map((entry) => ({ vaultId: entry.vaultId, nativePath: entry.nativePath, declinedAt: entry.declinedAt })),
    totalBytes: batch.entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    deletableCount: deletable.length,
    deletableBytes: deletable.reduce((sum, entry) => sum + entry.sizeBytes, 0),
  };
}

export async function reviewEvictionBatch(): Promise<EvictionBatchResponse> {
  return enqueueVaultOperation('review-eviction-batch', async () => {
    const config = await deps.readVaultConfig();
    return buildEvictionBatchResponse(await readEvictionBatch(), config);
  });
}

/** The message shown when an eviction operation needs the vault open but it is not (D-12). */
export function vaultUnavailableMessage(opened: Exclude<VaultOpenResult, { status: 'open' }>): string {
  switch (opened.status) {
    case 'off':
      return VAULT_OFF_MESSAGE;
    case 'rotation-pending':
      return 'A vault key rotation started on this machine has not finished. Run: pan vault rotate-key';
    case 'key-missing':
      return `Session Vault backend is set to ${opened.backend} but the key file is missing. Run: pan vault join ${opened.backend}`;
    case 'key-mismatch':
      return `This machine's vault key does not open ${opened.backend}. If the key was rotated on another machine, run: pan vault join ${opened.backend}`;
  }
}

/**
 * `deletableVaultIds` is the set of `verified` vaultIds the caller displayed
 * next to `fingerprint`. `batchFingerprint` does not cover `verification`
 * (only vaultId/nativePath/sizeBytes/settlementChunk), so a `failed` entry
 * that becomes eligible again between the display and this call can produce
 * the same fingerprint while the deletable set has grown. Comparing the sets
 * here, before calling into the engine, catches that race and returns the
 * same `{ refused: true, fingerprint }` shape `confirmEviction` uses for a
 * changed fingerprint.
 */
export async function confirmEvictionBatch(fingerprint: string, deletableVaultIds: string[]): Promise<ConfirmResult | { unavailable: string }> {
  return enqueueVaultOperation('confirm-eviction-batch', async () => {
    const opened = await deps.openVaultContext();
    if (opened.status !== 'open') return { unavailable: vaultUnavailableMessage(opened) };
    const config = await deps.readVaultConfig();
    const batch = await readEvictionBatch();
    const currentFingerprint = batchFingerprint(batch);
    const currentDeletable = batch.entries.filter((entry) => entry.verification === 'verified').map((entry) => entry.vaultId).sort();
    const expectedDeletable = [...deletableVaultIds].sort();
    const sameDeletableSet = currentDeletable.length === expectedDeletable.length && currentDeletable.every((id, index) => id === expectedDeletable[index]);
    if (!sameDeletableSet) return { refused: true as const, fingerprint: currentFingerprint };
    return deps.confirmEviction(fingerprint, { store: opened.vault.store, keys: opened.vault.keys, config, isLive: deps.isLive, skipFailed: true });
  });
}

export async function declineEvictionEntry(vaultId: string): Promise<EvictionBatchResponse> {
  return enqueueVaultOperation('decline-eviction-entry', async () => {
    const config = await deps.readVaultConfig();
    return buildEvictionBatchResponse(await declineEntry(vaultId), config);
  });
}

export async function clearEvictionBatch(): Promise<EvictionBatchResponse> {
  return enqueueVaultOperation('clear-eviction-batch', async () => {
    const config = await deps.readVaultConfig();
    return buildEvictionBatchResponse(await clearBatch(), config);
  });
}

export async function reofferEvictionEntry(vaultId: string): Promise<EvictionBatchResponse> {
  return enqueueVaultOperation('reoffer-eviction-entry', async () => {
    const config = await deps.readVaultConfig();
    return buildEvictionBatchResponse(await reofferEntry(vaultId), config);
  });
}
