/**
 * PAN-4265: the dashboard keeps the machine's synced setup current by itself.
 *
 * The service evaluates sync status at boot and every 60 s, and runs the light
 * `pan sync --if-changed` once per input set (the attempt key) when the global
 * sync inputs changed. A `pan reload` replaces the server, so the boot
 * evaluation covers "after reload"; the interval catches the main checkout's
 * `sync-sources/` moving between reloads. `GET /api/sync-status` serves the
 * cached evaluation, and `POST /api/system/sync` shares the single-flight
 * runner. The banner shows only when auto-sync failed, ran but could not apply
 * the change, or is off.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { loadConfigSync } from '../../../lib/config-yaml.js';
import { panCliInvocation } from '../../../lib/pan-cli-invocation.js';

const execFileAsync = promisify(execFile);

export const AUTO_SYNC_BOOT_DELAY_MS = 60_000;
const EVALUATE_INTERVAL_MS = 60_000;
const SYNC_TIMEOUT_MS = 180_000;
const MAX_DETAILS = 20;

export type AutoSyncState = 'idle' | 'pending' | 'running' | 'failed' | 'unresolved' | 'disabled';

export interface SyncStatusPayload {
  needed: boolean;
  reason: string;
  /** True only for failed | unresolved | disabled. */
  banner: boolean;
  summary: string | null;
  /** The first 20 changed input keys. */
  details: string[];
  autoSync: { enabled: boolean; state: AutoSyncState; lastError: string | null; lastRunAt: string | null };
}

export interface SyncRunResult {
  ok: boolean;
  output?: string;
  error?: string;
}

export interface SyncInputStatusRead {
  needed: boolean;
  reason: string;
  attemptKey: string;
  summary: string;
  changedKeys: string[];
}

export interface SyncAutoDeps {
  readStatus: () => Promise<SyncInputStatusRead>;
  runPanSync: (args: string[]) => Promise<SyncRunResult>;
  autoSyncEnabled: () => boolean;
  now?: () => Date;
}

const BANNER_STATES: ReadonlySet<AutoSyncState> = new Set(['failed', 'unresolved', 'disabled']);

const defaultDeps: SyncAutoDeps = {
  readStatus: async () => {
    // Dynamic import, like meta.ts's require: avoids a circular ESM edge in the server bundle.
    const { readSyncInputStatus } = await import('../../../lib/sync-startup-gate.js');
    return readSyncInputStatus();
  },
  runPanSync: async (args) => {
    try {
      const invocation = panCliInvocation(args);
      // Light Herdr pass: no minutes-long update/installs that the timeout would orphan (PAN-3956).
      const env = { ...process.env, OVERDECK_HERDR_SYNC_LIGHT: '1' };
      const { stdout, stderr } = await execFileAsync(invocation.command, invocation.args, {
        encoding: 'utf-8',
        timeout: SYNC_TIMEOUT_MS,
        env,
      });
      return { ok: true, output: `${stdout}${stderr}`.trim() };
    } catch (error: unknown) {
      const err = error as { stderr?: string; message?: string } | undefined;
      return { ok: false, error: `pan sync failed: ${String(err?.stderr || err?.message || error)}` };
    }
  },
  autoSyncEnabled: () => {
    try {
      return loadConfigSync().config.context.autoSync;
    } catch {
      return true;
    }
  },
};

function initialPayload(): SyncStatusPayload {
  return {
    needed: false,
    reason: 'not evaluated yet',
    banner: false,
    summary: null,
    details: [],
    autoSync: { enabled: true, state: 'idle', lastError: null, lastRunAt: null },
  };
}

let deps: SyncAutoDeps = defaultDeps;
let autoRun = false;
let started = false;
let bootAt = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let bootImmediate: ReturnType<typeof setImmediate> | null = null;
let cached: SyncStatusPayload = initialPayload();
let lastStatus: SyncInputStatusRead | null = null;
let lastAttempt: { key: string; ok: boolean } | null = null;
let lastError: string | null = null;
let lastRunAt: string | null = null;
/** The single-flight run, including its re-evaluation. */
let inFlight: Promise<SyncRunResult> | null = null;
/** True only while `pan sync` itself runs. */
let running = false;

function now(): Date {
  return (deps.now ?? (() => new Date()))();
}

function autoEnabled(): boolean {
  return autoRun && deps.autoSyncEnabled();
}

function stateFor(status: SyncInputStatusRead, enabled: boolean): AutoSyncState {
  if (running) return 'running';
  if (!status.needed) return 'idle';
  if (lastAttempt?.key === status.attemptKey) return lastAttempt.ok ? 'unresolved' : 'failed';
  if (!enabled) return 'disabled';
  return 'pending';
}

function buildPayload(status: SyncInputStatusRead, enabled: boolean): SyncStatusPayload {
  const state = stateFor(status, enabled);
  return {
    needed: status.needed,
    reason: status.reason,
    banner: BANNER_STATES.has(state),
    summary: status.needed ? status.summary : null,
    details: status.needed ? status.changedKeys.slice(0, MAX_DETAILS) : [],
    autoSync: { enabled, state, lastError, lastRunAt },
  };
}

export async function evaluateSyncStatus(): Promise<SyncStatusPayload> {
  let status: SyncInputStatusRead;
  try {
    status = await deps.readStatus();
  } catch (error: unknown) {
    console.warn(`[sync-auto] status read failed: ${error instanceof Error ? error.message : String(error)}`);
    return cached;
  }
  lastStatus = status;
  const enabled = autoEnabled();
  if (
    enabled &&
    stateFor(status, enabled) === 'pending' &&
    now().getTime() - bootAt >= AUTO_SYNC_BOOT_DELAY_MS
  ) {
    // Sets `running` synchronously, so the payload below reports it.
    void runSyncNow('auto');
  }
  cached = buildPayload(status, enabled);
  return cached;
}

export function runSyncNow(trigger: 'manual' | 'auto'): Promise<SyncRunResult> {
  if (inFlight) return inFlight;
  const attemptKey = lastStatus?.attemptKey ?? null;
  running = true;
  cached = { ...cached, banner: false, autoSync: { ...cached.autoSync, state: 'running' } };
  inFlight = (async () => {
    let result: SyncRunResult;
    try {
      result = await deps.runPanSync(trigger === 'auto' ? ['sync', '--if-changed'] : ['sync']);
    } catch (error: unknown) {
      result = { ok: false, error: `pan sync failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    running = false;
    if (attemptKey !== null) lastAttempt = { key: attemptKey, ok: result.ok };
    lastError = result.ok ? null : (result.error ?? 'pan sync failed');
    lastRunAt = now().toISOString();
    console.log(result.ok ? `[sync-auto] ${trigger} sync ok` : `[sync-auto] ${trigger} sync failed: ${lastError}`);
    try {
      await evaluateSyncStatus();
    } finally {
      inFlight = null;
    }
    return result;
  })();
  return inFlight;
}

export function getSyncStatus(): SyncStatusPayload {
  return cached;
}

export function startSyncAutoService(opts: { autoRun: boolean; deps?: Partial<SyncAutoDeps> }): void {
  if (started) return;
  started = true;
  deps = { ...defaultDeps, ...opts.deps };
  autoRun = opts.autoRun;
  bootAt = now().getTime();
  bootImmediate = setImmediate(() => {
    bootImmediate = null;
    void evaluateSyncStatus();
  });
  timer = setInterval(() => void evaluateSyncStatus(), EVALUATE_INTERVAL_MS);
  timer.unref();
}

export function stopSyncAutoService(): void {
  if (bootImmediate) clearImmediate(bootImmediate);
  if (timer) clearInterval(timer);
  bootImmediate = null;
  timer = null;
  started = false;
  deps = defaultDeps;
  autoRun = false;
  cached = initialPayload();
  lastStatus = null;
  lastAttempt = null;
  lastError = null;
  lastRunAt = null;
  inFlight = null;
  running = false;
}
