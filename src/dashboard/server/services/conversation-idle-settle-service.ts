/**
 * PAN-4655 WI-6: hosts the idle-settle sweep in the dashboard process, where
 * the pending-input feed and the conversation-list cache live. The first sweep
 * runs `IDLE_SETTLE_BOOT_DELAY_MS` after start, then one every
 * `IDLE_SETTLE_INTERVAL_MS`. This module owns only the timers and the
 * process-wide skips: `OVERDECK_DISABLE_IDLE_SETTLE=1`, a peer dashboard, a
 * frozen Deacon, and an overlapping sweep. The decisions live in
 * src/lib/overdeck/conversation-idle-settle.ts.
 */
import { isPeerDashboardProcess } from '../../../lib/boot-gates.js';
import { isDeaconGloballyPaused } from '../../../lib/overdeck/control-settings.js';
import { resurfaceActiveIdleSettles, sweepIdleConversations } from '../../../lib/overdeck/conversation-idle-settle.js';
import { invalidateConversationListEnrichmentCache } from '../../../lib/overdeck/conversation-list.js';
import { listLiveConversationSessions } from '../../../lib/overdeck/conversation-liveness.js';
import { getConversationsPendingInputFeed, resolveSessionFile } from '../../../lib/overdeck/conversation-reads.js';
import { emitConversationSchedulesChanged } from '../../../lib/overdeck/conversation-schedules.js';

export const IDLE_SETTLE_BOOT_DELAY_MS = 120_000;
export const IDLE_SETTLE_INTERVAL_MS = 900_000;

/** PAN-5611 D12: one sweep's outcome. */
export interface IdleSweepOutcome {
  settled: string[];
  resurfaced: string[];
}

export interface IdleSettlePatrolDeps {
  /** One sweep; a test seam. */
  sweep?: () => Promise<IdleSweepOutcome>;
  /** True while the Deacon is frozen; a test seam. */
  isFrozen?: () => boolean;
  /** Drops the conversation-list cache after a settle or resurface; a test seam. */
  invalidate?: () => void;
  /** PAN-5611: notified once per resurfaced conversation; a test seam. */
  emitChanged?: (name: string) => void;
  log?: (line: string) => void;
}

/** The sweep with the dashboard's real liveness, feed, and transcript doors. */
async function sweepWithRealDeps(): Promise<IdleSweepOutcome> {
  const resurfaced = await resurfaceActiveIdleSettles({
    listLiveSessions: () => listLiveConversationSessions(),
    resolveTranscript: resolveSessionFile,
  });
  const settled = await sweepIdleConversations({
    listLiveSessions: () => listLiveConversationSessions(),
    listWaitingNames: async (live) => {
      const result = await getConversationsPendingInputFeed({ resolveSessionFile, listSessionNames: async () => [...live] });
      if (result.status !== undefined || !Array.isArray(result.body)) return null;
      return new Set(result.body.map((row) => (row as { name: string }).name));
    },
    resolveTranscript: resolveSessionFile,
  });
  return { settled, resurfaced };
}

let bootTimer: ReturnType<typeof setTimeout> | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;
let activeSweep: Promise<void> | null = null;

function runSweep(deps: IdleSettlePatrolDeps): void {
  const log = deps.log ?? console.log;
  if ((deps.isFrozen ?? isDeaconGloballyPaused)()) return;
  if (activeSweep) {
    log('[idle-settle] previous sweep still running, skipping');
    return;
  }

  activeSweep = (deps.sweep ?? sweepWithRealDeps)().then(({ settled, resurfaced }) => {
    if (settled.length === 0 && resurfaced.length === 0) return;
    (deps.invalidate ?? invalidateConversationListEnrichmentCache)();
    if (settled.length > 0) log(`[idle-settle] settled ${settled.length} idle conversation(s): ${settled.join(', ')}`);
    if (resurfaced.length > 0) {
      const emitChanged = deps.emitChanged ?? emitConversationSchedulesChanged;
      for (const name of resurfaced) emitChanged(name);
      log(`[idle-settle] resurfaced ${resurfaced.length} conversation(s) with new activity: ${resurfaced.join(', ')}`);
    }
  }).catch((error) => {
    console.warn('[idle-settle] sweep failed:', error);
  }).finally(() => {
    activeSweep = null;
  });
}

export function startConversationIdleSettleService(deps: IdleSettlePatrolDeps = {}): boolean {
  if (process.env.OVERDECK_DISABLE_IDLE_SETTLE === '1') return false;
  // A peer dashboard shares the primary's database; only the primary settles.
  if (isPeerDashboardProcess()) return false;
  if (bootTimer || intervalTimer) return false;

  bootTimer = setTimeout(() => {
    bootTimer = null;
    runSweep(deps);
    intervalTimer = setInterval(() => runSweep(deps), IDLE_SETTLE_INTERVAL_MS);
    intervalTimer.unref?.();
  }, IDLE_SETTLE_BOOT_DELAY_MS);
  bootTimer.unref?.();
  return true;
}

export function stopConversationIdleSettleService(): void {
  if (bootTimer) clearTimeout(bootTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  bootTimer = null;
  intervalTimer = null;
}
