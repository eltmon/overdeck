/**
 * PAN-4451: hosts the blocker-wake patrol in the dashboard process, where
 * prompt-carrying dispatch lives. Every `BLOCKER_WAKE_INTERVAL_MS` it runs
 * `tickBlockerWake`; the tick itself decides whom to wake. This module owns
 * only the timer and the process-wide skips: `OVERDECK_DISABLE_BLOCKER_WAKE=1`,
 * a peer dashboard, a frozen Deacon, and an overlapping tick.
 */
import { isPeerDashboardProcess } from '../../../lib/boot-gates.js';
import {
  BLOCKER_WAKE_INTERVAL_MS,
  tickBlockerWake,
  type BlockerWakeDeps,
} from '../../../lib/cloister/blocker-wake.js';
import { isDeaconGloballyPaused } from '../../../lib/overdeck/control-settings.js';

export interface BlockerWakePatrolDeps extends BlockerWakeDeps {
  /** The tick to run; a test seam. */
  tick?: (deps: BlockerWakeDeps) => Promise<string[]>;
  /** True while the Deacon is frozen; a test seam. */
  isFrozen?: () => boolean;
}

let timer: ReturnType<typeof setInterval> | null = null;
let activeTick: Promise<void> | null = null;

function runTick(deps: BlockerWakePatrolDeps): void {
  const log = deps.log ?? console.log;
  if (activeTick) {
    log('[blocker-wake] previous tick still running, skipping tick');
    return;
  }
  if ((deps.isFrozen ?? isDeaconGloballyPaused)()) return;

  activeTick = (deps.tick ?? tickBlockerWake)(deps).then((actions) => {
    for (const action of actions) log(`[blocker-wake] ${action}`);
  }).catch((error) => {
    console.warn('[blocker-wake] tick failed:', error);
  }).finally(() => {
    activeTick = null;
  });
}

export function startBlockerWakePatrol(deps: BlockerWakePatrolDeps = {}): boolean {
  if (process.env.OVERDECK_DISABLE_BLOCKER_WAKE === '1') return false;
  // A peer dashboard shares the primary's database and agents; only the
  // primary may message them.
  if (isPeerDashboardProcess()) return false;
  if (timer) return false;

  timer = setInterval(() => runTick(deps), BLOCKER_WAKE_INTERVAL_MS);
  timer.unref?.();
  return true;
}

export function stopBlockerWakePatrol(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
