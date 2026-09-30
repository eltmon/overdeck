/**
 * Session Vault sync cycle (PAN-2609, FR-3, FR-9, P-18).
 *
 * `syncOnce` pushes what this machine owns and pulls what everyone owns:
 *
 *   1. refresh the backend view (offline → `{ offline: true }`, nothing else);
 *   2. settle every owned native transcript whose file grew since its tail;
 *   3. upsert this machine's `m/<hmac(environmentId)>` ref;
 *   4. read every `r/` ref, decrypt it, skip values whose type is not
 *      `session` (FR-9 reservation) and replace the machine-local list cache.
 *      A ref the current key cannot open is skipped and counted (PAN-4333):
 *      `retired` when a key of the ring opens it (the markers a rotation
 *      leaves at old names), `unreadable` when no key does.
 *
 * `createSyncLoop` runs it on an interval; offline cycles retry with an
 * exponential backoff capped at the interval. Imports only Node built-ins and
 * sibling vault modules.
 */
import { stat } from 'node:fs/promises';
import { ensureEnvironmentIdentity } from '../environment-identity.js';
import { readVaultConfig, type VaultConfig } from './config.js';
import {
  VaultAuthenticationError,
  decryptRef,
  encryptRef,
  isTombstone,
  readMachineRecord,
  readSessionRecord,
  refName,
  type MachineRecord,
} from './format.js';
import type { VaultSubkeys } from './identity.js';
import { listOwned, replaceListCache, type ListCacheRow } from './local-index.js';
import { settle, type SettleResult } from './settle.js';
import { VaultOfflineError, type VaultStore } from './store/types.js';

export interface SyncOptions {
  store: VaultStore;
  keys: VaultSubkeys;
  config?: VaultConfig;
  now?: () => Date;
  /** Runs after settling (used by eviction scanning when `config.evict` is true). */
  afterSettle?: (report: SyncReport) => Promise<void>;
}

export interface SyncReport {
  offline: boolean;
  /** One entry per owned transcript that was settled this cycle, keyed by native path. */
  settled: Array<{ nativePath: string; result: SettleResult }>;
  /** Session records now in the list cache (tombstones included). */
  records: number;
  /** Refs skipped because their decrypted type is not "session". */
  skipped: number;
  machines: MachineRecord[];
  /** Refs the current key cannot open but a retired key of the ring can (rotation markers). */
  retired: number;
  /** Refs no key of this machine opens. */
  unreadable: number;
  /** Transcripts whose settlement threw; one bad file never stops the cycle. */
  errors: Array<{ nativePath: string; message: string }>;
}

/**
 * Read a ref value with the current key. A value it cannot open yields
 * `'retired'` when a key of the ring opens it and `'unreadable'` otherwise.
 */
export async function readTolerant<T>(
  name: string,
  bytes: Uint8Array,
  keys: VaultSubkeys,
  read: (name: string, bytes: Uint8Array, keys: VaultSubkeys) => Promise<T>,
): Promise<{ value: T } | 'retired' | 'unreadable'> {
  try {
    return { value: await read(name, bytes, keys) };
  } catch (error) {
    if (!(error instanceof VaultAuthenticationError)) throw error;
  }
  for (const previous of keys.previous ?? []) {
    try {
      await decryptRef(name, bytes, previous);
      return 'retired';
    } catch (error) {
      if (!(error instanceof VaultAuthenticationError)) throw error;
    }
  }
  return 'unreadable';
}

export async function syncOnce(options: SyncOptions): Promise<SyncReport> {
  const { store, keys } = options;
  const now = options.now ?? (() => new Date());
  const config = options.config ?? (await readVaultConfig());
  const report: SyncReport = { offline: false, settled: [], records: 0, skipped: 0, machines: [], retired: 0, unreadable: 0, errors: [] };

  try {
    await store.refresh();
  } catch (error) {
    if (error instanceof VaultOfflineError) return { ...report, offline: true };
    throw error;
  }

  // 2. Settle owned transcripts that grew.
  const owned = await listOwned();
  for (const [nativePath, entry] of Object.entries(owned)) {
    let size: number;
    try {
      size = (await stat(nativePath)).size;
    } catch {
      continue; // gone (evicted or moved); eviction handles its own bookkeeping
    }
    if (size <= entry.tail.byteOffset) continue;
    let result: SettleResult;
    try {
      result = await settle({ nativePath, harness: entry.harness, store, keys, config, now });
    } catch (error) {
      if (error instanceof VaultOfflineError) return { ...report, offline: true };
      report.errors.push({ nativePath, message: (error as Error).message });
      continue;
    }
    report.settled.push({ nativePath, result });
    if (result.verdict === 'offline') return { ...report, offline: true };
  }

  try {
    // 3. Machine ref.
    const me = await ensureEnvironmentIdentity();
    const machineName = refName('machine', me.environmentId, keys.K_ref);
    const machine: MachineRecord = { v: 1, type: 'machine', environmentId: me.environmentId, label: me.label, updatedAt: now().toISOString() };
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await store.readRef(machineName);
      const outcome = await store.casRef(machineName, current?.version ?? null, await encryptRef(machineName, machine, keys));
      if (outcome === 'ok') break;
    }

    // 4. Pull records.
    const rows: ListCacheRow[] = [];
    for (const { name } of await store.listRefs('r/')) {
      const ref = await store.readRef(name);
      if (!ref) continue;
      const read = await readTolerant(name, ref.value, keys, readSessionRecord);
      if (read === 'retired' || read === 'unreadable') {
        report[read]++;
        continue;
      }
      const { value } = read;
      if (value === null) {
        report.skipped++;
        continue;
      }
      if (isTombstone(value)) {
        rows.push({ vaultId: value.vaultId, title: '', harness: '', ownerLabel: '', ownerIsHere: false, updatedAt: '', tombstone: true });
        continue;
      }
      rows.push({
        vaultId: value.vaultId,
        title: value.title,
        harness: value.harness,
        ownerLabel: value.owner.label,
        ownerIsHere: value.owner.environmentId === me.environmentId,
        updatedAt: value.updatedAt,
        tombstone: false,
      });
    }
    rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    await replaceListCache(rows);
    report.records = rows.length;

    for (const { name } of await store.listRefs('m/')) {
      const ref = await store.readRef(name);
      if (!ref) continue;
      const read = await readTolerant(name, ref.value, keys, readMachineRecord);
      if (read === 'retired' || read === 'unreadable') {
        report[read]++;
        continue;
      }
      if (read.value) report.machines.push(read.value);
    }
  } catch (error) {
    if (error instanceof VaultOfflineError) return { ...report, offline: true };
    throw error;
  }

  if (options.afterSettle) await options.afterSettle(report);
  else if (config.evict) {
    // FR-20: with eviction opted in, every sync refreshes the pending-deletion
    // batch. This adds entries only; nothing is deleted without confirmation.
    const { scanEligible } = await import('./evict.js');
    await scanEligible({ store, keys, config, now });
  }
  return report;
}

export interface SyncLoopOptions {
  intervalSec: number;
  run: () => Promise<{ offline: boolean }>;
  /** First retry delay after an offline cycle; doubles each time, capped at intervalSec. */
  initialBackoffSec?: number;
  onError?: (error: unknown) => void;
}

export interface SyncLoop {
  start(): void;
  stop(): void;
  /** Delay before the next cycle, or null when stopped. */
  nextDelayMs(): number | null;
}

/** Schedule `run` every `intervalSec`; back off exponentially (capped) while offline. */
export function createSyncLoop(options: SyncLoopOptions): SyncLoop {
  const intervalMs = options.intervalSec * 1000;
  const initialBackoffMs = (options.initialBackoffSec ?? 5) * 1000;
  let timer: NodeJS.Timeout | null = null;
  let stopped = true;
  let backoffMs = initialBackoffMs;
  let nextDelay: number | null = null;

  const schedule = (delayMs: number): void => {
    if (stopped) return;
    nextDelay = delayMs;
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, delayMs);
  };

  const tick = async (): Promise<void> => {
    let offline = false;
    try {
      offline = (await options.run()).offline;
    } catch (error) {
      options.onError?.(error);
      offline = true;
    }
    if (offline) {
      const delay = Math.min(backoffMs, intervalMs);
      backoffMs = Math.min(backoffMs * 2, intervalMs);
      schedule(delay);
    } else {
      backoffMs = initialBackoffMs;
      schedule(intervalMs);
    }
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      void tick();
    },
    stop() {
      stopped = true;
      nextDelay = null;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    nextDelayMs: () => nextDelay,
  };
}
