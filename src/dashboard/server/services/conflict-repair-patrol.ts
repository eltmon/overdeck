/**
 * PAN-4384: hosts the conflict-repair patrol in the dashboard process, where
 * prompt-carrying dispatch and the guarded review request live. Every
 * `CONFLICT_REPAIR_INTERVAL_MS` it runs `tickConflictRepair`; the tick itself
 * decides what to repair or escalate. This module owns only the timer and the
 * process-wide skips: `OVERDECK_DISABLE_CONFLICT_REPAIR=1`, a peer dashboard,
 * a frozen Deacon, and an overlapping tick.
 */
import { isPeerDashboardProcess } from '../../../lib/boot-gates.js';
import {
  CONFLICT_REPAIR_INTERVAL_MS,
  tickConflictRepair,
  type ConflictRepairDeps,
} from '../../../lib/cloister/conflict-repair.js';
import { isDeaconGloballyPaused } from '../../../lib/overdeck/control-settings.js';

export interface ConflictRepairPatrolDeps extends ConflictRepairDeps {
  /** The tick to run; a test seam. */
  tick?: (deps: ConflictRepairDeps) => Promise<string[]>;
  /** True while the Deacon is frozen; a test seam. */
  isFrozen?: () => boolean;
}

let timer: ReturnType<typeof setInterval> | null = null;
let activeTick: Promise<void> | null = null;

function runTick(deps: ConflictRepairPatrolDeps): void {
  const log = deps.log ?? console.log;
  if (activeTick) {
    log('[conflict-repair] previous tick still running, skipping tick');
    return;
  }
  if ((deps.isFrozen ?? isDeaconGloballyPaused)()) return;

  activeTick = (deps.tick ?? tickConflictRepair)(deps).then((actions) => {
    for (const action of actions) log(`[conflict-repair] ${action}`);
  }).catch((error) => {
    console.warn('[conflict-repair] tick failed:', error);
  }).finally(() => {
    activeTick = null;
  });
}

export function startConflictRepairPatrol(deps: ConflictRepairPatrolDeps = {}): boolean {
  if (process.env.OVERDECK_DISABLE_CONFLICT_REPAIR === '1') return false;
  // A peer dashboard shares the primary's database and agents; only the
  // primary may message them.
  if (isPeerDashboardProcess()) return false;
  if (timer) return false;

  timer = setInterval(() => runTick(deps), CONFLICT_REPAIR_INTERVAL_MS);
  timer.unref?.();
  return true;
}

export function stopConflictRepairPatrol(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
