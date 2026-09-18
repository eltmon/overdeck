/**
 * PRs that are done being reviewed but cannot merge for a forge-native reason
 * (PAN-1620, re-pointed by PAN-3917): merge conflicts, failing checks, or a
 * not-mergeable state.
 *
 * Before the cut this read `blockerReasons` off the `review_status` row — a
 * stored copy a patrol had to keep in step with GitHub. Now every reason comes
 * straight from the forge's account of the PR, so there is nothing to drift.
 * The in-flight candidate set comes from the durable pipeline lenses (tracker +
 * git + PR), never from a record.
 */
import { listInFlightIssuesWithPr, type MergeCandidateDeps } from './merge-ready-set.js';
import { getPrFacts, type PrFacts } from './pr-facts.js';

export type MergeBlockerType = 'merge_conflict' | 'failing_checks' | 'not_mergeable';

export interface MergeBlocker {
  issueId: string;
  prUrl?: string;
  reasons: Array<{ type: MergeBlockerType; summary: string }>;
}

export type MergeBlockersDeps = MergeCandidateDeps;

/**
 * Classify one PR's forge state into blocker reasons. Pure: the caller supplies
 * the facts. An approved PR with green checks and `mergeable` true has none.
 */
export function blockerReasonsFor(facts: PrFacts): MergeBlocker['reasons'] {
  if (!facts.exists || !facts.open || facts.merged) return [];
  const reasons: MergeBlocker['reasons'] = [];
  if (facts.mergeable === false) {
    const conflicting = (facts.mergeableState ?? '').includes('conflict')
      || facts.mergeableState === 'conflicting';
    reasons.push(conflicting
      ? { type: 'merge_conflict', summary: 'the branch conflicts with the base branch' }
      : { type: 'not_mergeable', summary: `the forge reports the PR is not mergeable${facts.mergeableState ? ` (${facts.mergeableState})` : ''}` });
  }
  if (facts.checks === 'red') {
    reasons.push({ type: 'failing_checks', summary: `CI checks are failing on ${facts.headSha?.slice(0, 8) ?? 'HEAD'}` });
  }
  return reasons;
}

/**
 * Every in-flight issue whose PR is approved but blocked by the forge.
 *
 * Async because the forge is the source: callers that used to read SQLite
 * synchronously (the dashboard route and `pan flywheel merge-blockers`) await it.
 */
export async function getMergeBlockersPayload(deps: MergeBlockersDeps = {}): Promise<MergeBlocker[]> {
  const candidates = await listInFlightIssuesWithPr(deps);

  const getFacts = deps.getFacts ?? getPrFacts;
  const out: MergeBlocker[] = [];
  for (const issueId of candidates) {
    const facts = await getFacts(issueId);
    if (!facts.approved) continue;
    const reasons = blockerReasonsFor(facts);
    if (reasons.length === 0) continue;
    out.push({ issueId, prUrl: facts.url ?? undefined, reasons });
  }
  return out;
}
