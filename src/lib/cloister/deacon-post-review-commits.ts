/**
 * Did the branch move since its review? (PAN-3847, re-pointed by PAN-3917.)
 *
 * This module used to be a reset engine: it compared a `reviewedAtCommit`
 * anchor stored on the review row against the workspace HEAD, then rewrote the
 * row — clearing the verdict, stamping `reviewStaleSince`, dropping
 * merge readiness, resetting retry counters — and re-dispatched a convoy. Most
 * of it existed to keep a stored verdict honest as commits landed under it,
 * and the rest existed to stop the reset from looping when the two anchor
 * producers disagreed.
 *
 * With the verdict living on the pull request, the forge answers the question
 * directly: the latest review carries the commit it was written against, and
 * the PR carries its current head. Everything here is a read; nothing resets
 * anything. A work agent that reworks after `CHANGES_REQUESTED` re-requests
 * review itself through `pan done` / `pan review request`.
 */
import { getLatestPrReview, getPrFacts, type PrFacts } from './pr-facts.js';

export type ReviewFreshness =
  /** No PR, or no decisive review on it yet. */
  | { kind: 'unreviewed' }
  /** The latest review was written against the PR's current head. */
  | { kind: 'current'; state: string; headSha: string }
  /** Commits landed after the latest review; it no longer describes this code. */
  | { kind: 'stale'; state: string; reviewedSha: string; headSha: string };

export interface ReviewFreshnessDeps {
  getFacts?: (issueId: string) => Promise<PrFacts>;
  getLatestReview?: typeof getLatestPrReview;
}

/**
 * Compare the latest PR review against the PR's current head.
 *
 * Unknowable inputs (no PR, no review, a forge that does not report the
 * reviewed commit) report `unreviewed` rather than guessing staleness.
 */
export async function evaluateReviewFreshness(
  issueId: string,
  deps: ReviewFreshnessDeps = {},
): Promise<ReviewFreshness> {
  const facts = await (deps.getFacts ?? getPrFacts)(issueId);
  if (!facts.open || !facts.headSha) return { kind: 'unreviewed' };

  const review = await (deps.getLatestReview ?? getLatestPrReview)(facts);
  if (!review?.commitId) return { kind: 'unreviewed' };

  return review.commitId === facts.headSha
    ? { kind: 'current', state: review.state, headSha: facts.headSha }
    : { kind: 'stale', state: review.state, reviewedSha: review.commitId, headSha: facts.headSha };
}

/**
 * Report which of the given issues have commits newer than their latest review.
 *
 * Report-only by construction: the caller decides what to say about it. No
 * verdict is cleared, no row is stamped, no convoy is dispatched.
 */
export async function checkPostReviewCommits(
  issueIds: readonly string[],
  deps: ReviewFreshnessDeps = {},
): Promise<string[]> {
  const actions: string[] = [];
  for (const issueId of issueIds) {
    const freshness = await evaluateReviewFreshness(issueId, deps).catch(() => null);
    if (freshness?.kind !== 'stale') continue;
    actions.push(
      `${issueId}: the latest review (${freshness.state}) was written against ${freshness.reviewedSha.slice(0, 8)}, `
      + `the PR head is now ${freshness.headSha.slice(0, 8)} — re-request review to re-review the new commits`,
    );
  }
  return actions;
}
