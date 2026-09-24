/**
 * Warm-idle advancing-session classification (PAN-2579; formerly the PAN-1716
 * reap-on-verdict selection).
 *
 * Advancing roles (review/test/ship) run one tmux session per role per issue.
 * Under the warm-by-default lifecycle a session that has recorded its terminal
 * phase verdict stays ALIVE — "warm-idle" — so the next cycle can resume it with
 * its context intact (fast re-review). This module holds the pure classification
 * logic shared by:
 *
 *   - `countRunningAgents()` (concurrency.ts), which EXCLUDES warm-idle sessions
 *     from the PAN-1665 advancing ceiling — they are free capacity, not load
 *     (this fixes the accounting bug that reap-on-verdict used to work around);
 *   - the memory governor's shed ladder, which kills warm-idle sessions FIRST
 *     under HARD memory pressure (they resume with context via the saved
 *     session, so a shed costs latency, not state);
 *   - the deacon's merged-issue reapers (sessions of MERGED issues are past
 *     close-out and are still reaped).
 */

import type { PrFacts } from './pr-facts.js';

export type AdvancingRole = 'review' | 'test' | 'ship';
export type AdvancingSessionLifecycle = 'active' | 'warm' | 'orphaned' | 'unknown';

/**
 * What the owners of the facts say about an issue's phases (PAN-3917).
 *
 * Every field is derived: the forge for the review verdict and the merge, the
 * workspace's `.pan/test/result.json` for the test verdict. The module keeps
 * its pure selection logic; only the inputs changed.
 */
export interface AdvancingPhase {
  /** The PR carries a decisive review — approved or changes requested. */
  reviewSettled?: boolean;
  /** The test role wrote its verdict artifact. */
  testSettled?: boolean;
  /** The PR merged. */
  merged?: boolean;
  /** The PR is approved, green, and mergeable — the ship phase is settled. */
  mergeReady?: boolean;
}

export type ReapableStatus = AdvancingPhase;

/** Build an {@link AdvancingPhase} from the forge's account of the PR. */
export function advancingPhaseFromPrFacts(
  facts: PrFacts,
  options: { testSettled?: boolean } = {},
): AdvancingPhase {
  return {
    reviewSettled: facts.approved || facts.changesRequested,
    ...(options.testSettled === undefined ? {} : { testSettled: options.testSettled }),
    merged: facts.merged,
    mergeReady: facts.approved && facts.checks === 'green' && facts.mergeable === true,
  };
}

/** Has this role finished its phase for the issue? */
export function isRoleTerminal(role: AdvancingRole, phase: AdvancingPhase): boolean {
  switch (role) {
    case 'review':
      return phase.reviewSettled === true;
    case 'test':
      return phase.testSettled === true;
    case 'ship':
      return phase.merged === true || phase.mergeReady === true;
  }
}

export interface IdleRuntimeStatus {
  state?: string;
  lastActivity?: string;
}

/**
 * Alive advancing-role sessions that have stopped working (PAN-3917).
 *
 * The warm-idle shed list used to be "every session whose stored verdict is
 * terminal". Idleness is the same set without the stored verdict: a reviewer
 * that finished is idle, and an idle advancing pane is by definition not doing
 * the work its slot is reserved for. Sessions are matched by the canonical
 * advancing naming (`agent-<issue>-<role>`, plus the review convoy children).
 */
export function selectIdleAdvancingSessions(
  aliveSessions: readonly string[],
  isIdle: (agentId: string) => boolean,
): string[] {
  const advancing = /^agent-[a-z0-9]+-\d+-(review|test|ship)(?:-|$)/;
  return aliveSessions.filter((session) => advancing.test(session) && isIdle(session));
}
