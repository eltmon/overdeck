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
import { sweepIdleConversations } from '../../../lib/overdeck/conversation-idle-settle.js';
import { invalidateConversationListEnrichmentCache } from '../../../lib/overdeck/conversation-list.js';
import { listLiveConversationSessions } from '../../../lib/overdeck/conversation-liveness.js';
import { getConversationsPendingInputFeed, resolveSessionFile } from '../../../lib/overdeck/conversation-reads.js';

export const IDLE_SETTLE_BOOT_DELAY_MS = 120_000;
export const IDLE_SETTLE_INTERVAL_MS = 900_000;

export interface IdleSettlePatrolDeps {
  /** One sweep; a test seam. */
  sweep?: () => Promise<string[]>;
  /** True while the Deacon is frozen; a test seam. */
  isFrozen?: () => boolean;
  /** Drops the conversation-list cache after a settle; a test seam. */
  invalidate?: () => void;
  log?: (line: string) => void;
}

/** The sweep with the dashboard's real liveness, feed, and transcript doors. */
function sweepWithRealDeps(): Promise<string[]> {
  return sweepIdleConversations({
    listLiveSessions: () => listLiveConversationSessions(),
    listWaitingNames: async (live) => {
      const result = await getConversationsPendingInputFeed({ resolveSessionFile, listSessionNames: async () => [...live] });
      if (result.status !== undefined || !Array.isArray(result.body)) return null;
      return new Set(result.body.map((row) => (row as { name: string }).name));
    },
    resolveTranscript: resolveSessionFile,
  });
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

  activeSweep = (deps.sweep ?? sweepWithRealDeps)().then((names) => {
    if (names.length === 0) return;
    (deps.invalidate ?? invalidateConversationListEnrichmentCache)();
    log(`[idle-settle] settled ${names.length} idle conversation(s): ${names.join(', ')}`);
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
