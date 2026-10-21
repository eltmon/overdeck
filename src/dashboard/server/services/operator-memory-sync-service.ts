/**
 * PAN-4578: the dashboard keeps the synced operator memory store fresh.
 *
 * 60 s after boot and every 15 min after that, the service runs one operator
 * memory sync in-process, only when the store is synced (it has `.git`). Runs
 * are single-flight. Every git call in the sync is an async `execFile`, so the
 * event loop never blocks. A clean sync logs nothing; offline, failed,
 * conflicts and held-back files log one `console.warn` line. Peer dashboards
 * do not start it (main.ts).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { OperatorMemorySyncOutcome } from '../../../lib/memory/facts/operator-sync.js';
import { userMemoryDir } from '../../../lib/memory/facts/store.js';

export const OPERATOR_MEMORY_SYNC_BOOT_DELAY_MS = 60_000;
export const OPERATOR_MEMORY_SYNC_INTERVAL_MS = 15 * 60_000;

export interface OperatorMemorySyncDeps {
  isSynced: () => boolean;
  sync: () => Promise<OperatorMemorySyncOutcome>;
}

const defaultDeps: OperatorMemorySyncDeps = {
  // Same check as isOperatorMemorySynced, inlined like render.ts so the sync module loads only to sync.
  isSynced: () => existsSync(join(userMemoryDir(), '.git')),
  // Dynamic import, like sync-auto-service.ts: avoids a circular ESM edge in the server bundle.
  sync: async () => (await import('../../../lib/memory/facts/operator-sync.js')).syncOperatorMemory(),
};

let deps: OperatorMemorySyncDeps = defaultDeps;
let bootTimer: ReturnType<typeof setTimeout> | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<OperatorMemorySyncOutcome | null> | null = null;

function logOutcome(outcome: OperatorMemorySyncOutcome): void {
  switch (outcome.status) {
    case 'offline':
      console.warn(`[operator-memory-sync] offline: ${outcome.error}`);
      return;
    case 'failed':
      console.warn(`[operator-memory-sync] failed: ${outcome.error}`);
      return;
    case 'synced':
      if (outcome.conflicts.length > 0) {
        console.warn(`[operator-memory-sync] conflict copies written: ${outcome.conflicts.join(', ')}`);
      }
      if (outcome.heldBack.length > 0) {
        const files = outcome.heldBack.map((file) => `${file.path} (${file.reason})`).join(', ');
        console.warn(`[operator-memory-sync] held back: ${files}`);
      }
      return;
    case 'not-configured':
      return;
  }
}

/** One single-flight sync. Returns null when the store is not synced or a run is in flight. */
export function runOperatorMemorySyncTick(): Promise<OperatorMemorySyncOutcome | null> {
  if (inFlight) return Promise.resolve(null);
  const run = (async () => {
    try {
      if (!deps.isSynced()) return null;
      const outcome = await deps.sync();
      logOutcome(outcome);
      return outcome;
    } catch (error) {
      console.warn(`[operator-memory-sync] error: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  })();
  // Clear after the assignment: a run that finishes without awaiting would otherwise
  // reset inFlight before it is set, and every later tick would see a stale run.
  inFlight = run;
  void run.finally(() => {
    if (inFlight === run) inFlight = null;
  });
  return run;
}

export function startOperatorMemorySyncService(opts?: { deps?: Partial<OperatorMemorySyncDeps> }): void {
  if (bootTimer || intervalTimer) return;
  deps = { ...defaultDeps, ...opts?.deps };
  bootTimer = setTimeout(() => {
    bootTimer = null;
    void runOperatorMemorySyncTick();
  }, OPERATOR_MEMORY_SYNC_BOOT_DELAY_MS);
  bootTimer.unref();
  intervalTimer = setInterval(() => void runOperatorMemorySyncTick(), OPERATOR_MEMORY_SYNC_INTERVAL_MS);
  intervalTimer.unref();
}

export function stopOperatorMemorySyncService(): void {
  if (bootTimer) clearTimeout(bootTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  bootTimer = null;
  intervalTimer = null;
  deps = defaultDeps;
}
