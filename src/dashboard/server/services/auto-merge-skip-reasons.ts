/**
 * PAN-4772: why the auto-merge scheduler did not schedule an issue.
 *
 * Before this, `main.ts` discarded every pass's outcomes, so a PR that looked
 * approved and green could sit unscheduled with no visible reason. The latest
 * completed pass's skip per issue is kept here, in process memory, and served
 * on `GET /api/merge-train/auto-merge/pending` as `notScheduled`. It is the
 * last pass's answer, recomputed every tick, never stored.
 *
 * A reason is logged only when it changes for that issue, so a PR that stays
 * unscheduled does not log every tick.
 */

export interface NotScheduledAutoMerge {
  issueId: string;
  projectKey: string;
  reason: string;
  /** The PR head the reason applies to, when the pass read it. */
  head?: string;
  /** ISO time this reason was first seen for this issue and head. */
  at: string;
}

export interface SchedulerOutcomeLike {
  projectKey: string;
  issueId: string;
  scheduled: boolean;
  reason?: string;
  head?: string;
  /** Skipped only because an auto-merge row is already pending or merging. */
  alreadyScheduled?: boolean;
}

const latestSkips = new Map<string, NotScheduledAutoMerge>();

/**
 * Replace the recorded skips with one completed pass's outcomes. Issues the
 * pass scheduled, found already scheduled, or did not see at all are dropped.
 */
export function recordSchedulerOutcomes(
  outcomes: readonly SchedulerOutcomeLike[],
  deps: { now?: () => number; log?: (message: string) => void } = {},
): void {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? console.log;
  const seen = new Set<string>();
  for (const outcome of outcomes) {
    const issueId = outcome.issueId.toUpperCase();
    if (outcome.scheduled || outcome.alreadyScheduled) continue;
    seen.add(issueId);
    const reason = outcome.reason ?? 'not scheduled';
    const previous = latestSkips.get(issueId);
    if (previous && previous.reason === reason && previous.head === outcome.head) continue;
    latestSkips.set(issueId, {
      issueId,
      projectKey: outcome.projectKey,
      reason,
      ...(outcome.head ? { head: outcome.head } : {}),
      at: new Date(now()).toISOString(),
    });
    log(`[auto-merge-scheduler] ${issueId} not scheduled: ${reason}`);
  }
  for (const issueId of [...latestSkips.keys()]) {
    if (!seen.has(issueId)) latestSkips.delete(issueId);
  }
}

/** The latest completed pass's skips, oldest first. */
export function listNotScheduledAutoMerges(): NotScheduledAutoMerge[] {
  return [...latestSkips.values()].sort((a, b) => a.at.localeCompare(b.at) || a.issueId.localeCompare(b.issueId));
}

/** Forget every recorded skip. Exported for tests. */
export function resetSchedulerOutcomes(): void {
  latestSkips.clear();
}
