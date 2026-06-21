/**
 * Reap terminal-status advancing-role sessions (PAN-1716).
 *
 * Advancing roles (review/test/ship) run one tmux session per role per issue.
 * Once a session records its terminal phase verdict the Claude process sits idle
 * at its prompt forever — nothing kills it. `countRunningAgents()` keeps counting
 * those zombies against the PAN-1665 advancing ceiling, so a handful of completed
 * review/test sessions can starve every new dispatch and livelock the pipeline.
 *
 * This module holds the pure selection logic shared by the completion path
 * (`pan specialists done`) and the deacon defense-in-depth janitor: given the
 * review-status map and the set of tmux-alive sessions, decide which advancing
 * sessions are safe to reap.
 */

/**
 * PAN-2007 (operator request, 2026-06-21): temporarily keep specialist
 * (review/test/ship) tmux sessions ALIVE through the whole pipeline so the
 * operator can watch them and confirm verdict signaling. While `true`:
 *   - the PAN-1716 terminal-advancing reaper (`checkTerminalAdvancingSessions`)
 *     is a no-op, and
 *   - the `pan specialists done` completion path records the verdict but does
 *     NOT kill the tmux session.
 *
 * The verdict is recorded BEFORE either kill would fire and the deacon advances
 * the pipeline independently, so disabling the kills loses no state.
 *
 * Tradeoff: idle specialist sessions linger and count against the PAN-1665
 * advancing-role ceiling until close-out. Acceptable for low-volume supervised
 * debugging only — set back to `false` once the review session-death + reset
 * loop work is done (see PAN-2007 re-enable checklist).
 */
export const KEEP_SPECIALIST_SESSIONS_ALIVE = true;

export type AdvancingRole = 'review' | 'test' | 'ship';

/** Review/test statuses that mean the phase is over and the session has no more work. */
const TERMINAL_REVIEW: ReadonlySet<string> = new Set(['passed', 'failed', 'blocked']);
const TERMINAL_TEST: ReadonlySet<string> = new Set(['passed', 'failed']);

/** Minimal review-status shape this module reads. */
export interface ReapableStatus {
  reviewStatus?: string;
  testStatus?: string;
  readyForMerge?: boolean;
  mergeStatus?: string;
}

/**
 * Of the alive sessions, the ones belonging to `issueId`'s advancing `role`.
 * Matches the canonical role session (`agent-<id>-<role>`), the review convoy
 * sub-sessions (`agent-<id>-review-*`), and legacy `specialist-*` sessions.
 * Exact-name matching against the alive set — never a blind prefix kill.
 */
export function sessionsToReapForRole(
  issueId: string,
  role: AdvancingRole,
  aliveSessions: readonly string[],
): string[] {
  const lo = issueId.toLowerCase();
  const legacy = new RegExp(`-${role}(?:-|$)`);
  return aliveSessions.filter((s) => {
    if (role === 'review') {
      if (s === `agent-${lo}-review` || s.startsWith(`agent-${lo}-review-`)) return true;
    } else if (s === `agent-${lo}-${role}`) {
      return true;
    }
    return s.startsWith('specialist-') && s.includes(`-${lo}-`) && legacy.test(s);
  });
}

/**
 * Whether an advancing role's phase verdict is terminal — the session can be reaped.
 * Ship is terminal once it has pushed (readyForMerge) or the merge itself resolved;
 * the merge is a separate server-side flow, not the ship tmux session's job.
 */
export function isRoleTerminal(role: AdvancingRole, status: ReapableStatus): boolean {
  switch (role) {
    case 'review':
      return TERMINAL_REVIEW.has(status.reviewStatus ?? '');
    case 'test':
      return TERMINAL_TEST.has(status.testStatus ?? '');
    case 'ship':
      return status.readyForMerge === true
        || status.mergeStatus === 'merged'
        || status.mergeStatus === 'failed';
  }
}

/**
 * Across every issue, the alive advancing-role sessions whose phase verdict is
 * terminal — the deacon janitor's kill list. Deduplicated.
 */
export function selectTerminalAdvancingSessions(
  statuses: Record<string, ReapableStatus>,
  aliveSessions: readonly string[],
): string[] {
  const kill = new Set<string>();
  for (const [issueId, status] of Object.entries(statuses)) {
    for (const role of ['review', 'test', 'ship'] as const) {
      if (!isRoleTerminal(role, status)) continue;
      for (const session of sessionsToReapForRole(issueId, role, aliveSessions)) {
        kill.add(session);
      }
    }
  }
  return [...kill];
}

/**
 * Whether an issue's WORK session is safe to reap (PAN-1726).
 *
 * Once the issue has merged, its work agent (`agent-<id>`) has no remaining
 * work — it sits idle at the prompt yet `countRunningAgents()` still counts it
 * against the PAN-1665 work ceiling, throttling dispatch for every live issue.
 * `postMergeLifecycle` pauses + kills it at merge time, but a server restart
 * mid-lifecycle (PAN-1723) or a deacon read-modify-write race on state.json can
 * resurrect it. This is the work-role sibling of the advancing reaper above.
 */
export function isWorkReapable(status: ReapableStatus): boolean {
  return status.mergeStatus === 'merged';
}

/**
 * Across every issue, the alive WORK sessions whose issue has merged — the
 * deacon janitor's work-role kill list. Matches only the canonical work session
 * `agent-<id>` (never the `agent-<id>-<role>` advancing sub-sessions, which the
 * advancing reaper owns). Exact-name matching against the alive set.
 */
export function selectMergedWorkSessions(
  statuses: Record<string, ReapableStatus>,
  aliveSessions: readonly string[],
): string[] {
  const alive = new Set(aliveSessions);
  const kill: string[] = [];
  for (const [issueId, status] of Object.entries(statuses)) {
    if (!isWorkReapable(status)) continue;
    const session = `agent-${issueId.toLowerCase()}`;
    if (alive.has(session)) kill.push(session);
  }
  return kill;
}

/**
 * Whether an issue's WORK session is reapable because it's idle awaiting its
 * test verdict (PAN-1730).
 *
 * Review has passed and test is still pending, so the work agent has already
 * handed off via `pan done` and now sits idle at its prompt — yet
 * `countRunningAgents()` keeps counting it against the PAN-1665 work ceiling.
 * When the work pool alone meets the total ceiling (work=7 advancing=4
 * total=11/9 observed) `tryReserveAdvancingSlot()` can never admit the test
 * that would release these agents: a livelock. Reaping returns the work slot
 * (and RAM).
 *
 * This is the status half of the predicate. The idle-duration gate (pane idle
 * ≥10 min) lives in the deacon caller, which has the runtime state — a pure
 * status predicate cannot see it. Unlike `isWorkReapable` (merged), the caller
 * must NOT pause the agent: if the test later FAILS the deacon's auto-resume
 * `needsFix` gate has to be free to bring it back to address the feedback.
 */
export function isAwaitingTestReapable(status: ReapableStatus): boolean {
  return status.reviewStatus === 'passed' && status.testStatus === 'pending';
}

/**
 * Across every issue, the alive WORK sessions whose review passed but whose
 * test verdict is still pending — candidates for the idle-awaiting-test reaper
 * (PAN-1730). Matches only the canonical work session `agent-<id>` (never the
 * `agent-<id>-<role>` advancing sub-sessions). The deacon applies the idle-≥10
 * min gate per returned session before killing.
 */
export function selectAwaitingTestWorkSessions(
  statuses: Record<string, ReapableStatus>,
  aliveSessions: readonly string[],
): string[] {
  const alive = new Set(aliveSessions);
  const candidates: string[] = [];
  for (const [issueId, status] of Object.entries(statuses)) {
    if (!isAwaitingTestReapable(status)) continue;
    const session = `agent-${issueId.toLowerCase()}`;
    if (alive.has(session)) candidates.push(session);
  }
  return candidates;
}
