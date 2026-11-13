/**
 * PAN-5170: the darwin replacement for the systemd unit-failed check. Decides,
 * from successive /health probe results, when the supervisor counts as down.
 * Pure: the caller passes the clock. See docs/ANYWHERE-ARCHITECTURE.md D-10.
 */
export const SUPERVISOR_DOWN_WINDOW_MS = 60_000;

export interface SupervisorDownReport {
  /** Milliseconds since the first failed probe of this episode. */
  unreachableForMs: number;
}

export interface SupervisorReachabilityTracker {
  /** Record one probe. Returns a report exactly once per down episode, else null. */
  observe(answered: boolean, nowMs: number): SupervisorDownReport | null;
}

export function createSupervisorReachabilityTracker(
  windowMs: number = SUPERVISOR_DOWN_WINDOW_MS,
): SupervisorReachabilityTracker {
  let seenAlive = false;
  let unreachableSince: number | null = null;
  let reported = false;
  return {
    observe(answered, nowMs) {
      if (answered) {
        seenAlive = true;
        unreachableSince = null;
        reported = false;
        return null;
      }
      if (!seenAlive) return null;
      unreachableSince ??= nowMs;
      const unreachableForMs = nowMs - unreachableSince;
      if (reported || unreachableForMs < windowMs) return null;
      reported = true;
      return { unreachableForMs };
    },
  };
}
