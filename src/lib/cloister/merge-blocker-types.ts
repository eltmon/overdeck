/**
 * Merge blocker classification (PAN-1620; widened to six types by PAN-4753
 * WI-7, FR-15). Pure: the caller supplies the PR facts.
 *
 * The merge-blockers payload (`merge-blockers.ts`) asks without `extras` and
 * keeps its three forge-native types. The merge-train board asks with
 * `extras`, which adds a draft PR, a changes-requested review and unresolved
 * review threads.
 */
import type { PrFacts } from './pr-facts.js';

export type MergeBlockerType =
  | 'merge_conflict'
  | 'failing_checks'
  | 'not_mergeable'
  | 'unresolved_conversations'
  | 'changes_requested'
  | 'draft_pr';

export interface MergeBlockerReason { type: MergeBlockerType; summary: string }

export interface BlockerExtras {
  /** Unresolved review threads on the PR; 0 or absent adds nothing. */
  unresolvedThreads?: number;
}

/**
 * Classify one PR's state into blocker reasons. An open PR with green checks,
 * `mergeable` true and (with extras) no draft, no changes requested and no
 * open threads has none.
 */
export function blockerReasonsFor(facts: PrFacts, extras?: BlockerExtras): MergeBlockerReason[] {
  if (!facts.exists || !facts.open || facts.merged) return [];
  const reasons: MergeBlockerReason[] = [];
  if (extras && facts.draft) reasons.push({ type: 'draft_pr', summary: 'the PR is a draft' });
  if (extras && facts.changesRequested) {
    reasons.push({ type: 'changes_requested', summary: 'the latest review requested changes' });
  }
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
  const threads = extras?.unresolvedThreads ?? 0;
  if (threads > 0) {
    reasons.push({ type: 'unresolved_conversations', summary: `${threads} unresolved review thread${threads === 1 ? '' : 's'}` });
  }
  return reasons;
}
