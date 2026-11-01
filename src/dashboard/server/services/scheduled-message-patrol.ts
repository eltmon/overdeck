/**
 * PAN-4641 WI-7: hosts the scheduled-messages tick in the dashboard process,
 * where the conversation delivery and resume doors live. On start it turns rows
 * a crash left in `sending` into `unknown` (D6), runs one tick, then ticks every
 * `SCHEDULED_MESSAGES_INTERVAL_MS`. This module owns only the timer and the
 * process-wide skips: `OVERDECK_DISABLE_SCHEDULED_MESSAGES=1`, a peer
 * dashboard, a frozen Deacon, and an overlapping tick.
 */
import { isPeerDashboardProcess } from '../../../lib/boot-gates.js';
import { recoverInterruptedScheduledMessages } from '../../../lib/overdeck/conversation-scheduled-messages.js';
import { isDeaconGloballyPaused } from '../../../lib/overdeck/control-settings.js';
import {
  SCHEDULED_MESSAGES_INTERVAL_MS,
  tickScheduledMessages,
  type ScheduledDeliveryDeps,
} from '../../../lib/overdeck/scheduled-message-delivery.js';

export interface ScheduledMessagePatrolDeps extends ScheduledDeliveryDeps {
  /** The tick to run; a test seam. */
  tick?: (deps: ScheduledDeliveryDeps) => Promise<string[]>;
  /** True while the Deacon is frozen; a test seam. */
  isFrozen?: () => boolean;
  /** The start-up crash recovery; a test seam. */
  recover?: (now: number) => number;
}

let timer: ReturnType<typeof setInterval> | null = null;
let activeTick: Promise<void> | null = null;

function runTick(deps: ScheduledMessagePatrolDeps): void {
  const log = deps.log ?? console.log;
  if (activeTick) {
    log('[scheduled-messages] previous tick still running, skipping tick');
    return;
  }
  if ((deps.isFrozen ?? isDeaconGloballyPaused)()) return;

  activeTick = (deps.tick ?? tickScheduledMessages)(deps).then((actions) => {
    for (const action of actions) log(`[scheduled-messages] ${action}`);
  }).catch((error) => {
    console.warn('[scheduled-messages] tick failed:', error);
  }).finally(() => {
    activeTick = null;
  });
}

export function startScheduledMessagePatrol(deps: ScheduledMessagePatrolDeps = {}): boolean {
  if (process.env.OVERDECK_DISABLE_SCHEDULED_MESSAGES === '1') return false;
  // A peer dashboard shares the primary's database and conversations; only the
  // primary may deliver to them.
  if (isPeerDashboardProcess()) return false;
  if (timer) return false;

  const log = deps.log ?? console.log;
  try {
    const recovered = (deps.recover ?? recoverInterruptedScheduledMessages)(Date.now());
    if (recovered > 0) log(`[scheduled-messages] ${recovered} interrupted send(s) marked unknown`);
  } catch (error) {
    console.warn('[scheduled-messages] crash recovery failed:', error);
  }
  runTick(deps);
  timer = setInterval(() => runTick(deps), SCHEDULED_MESSAGES_INTERVAL_MS);
  timer.unref?.();
  return true;
}

export function stopScheduledMessagePatrol(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
