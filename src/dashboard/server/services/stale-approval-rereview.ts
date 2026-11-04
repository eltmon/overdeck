/**
 * PAN-4772: re-request review when a push leaves a PR's approval stale.
 *
 * GitHub keeps `reviewDecision=APPROVED` after the author pushes, but the
 * merge gate needs an approval of the exact head (#3983). A work agent that
 * pushes after approval (to answer CodeRabbit, say) without asking for review
 * leaves a PR that looks approved and green and that nothing will ever merge.
 *
 * The auto-merge scheduler calls this when the gate refuses such a PR. It asks
 * the guarded review door (`POST /api/review/:issueId/request` without
 * `force`/`nudge`) once per head, the same door `pan review request` uses. The
 * door already re-reviews a stale approval (PAN-4384) and counts every spawn
 * against its `MAX_AUTO_REQUEUE` breaker, so repeated pushes stay bounded.
 *
 * "Once per head" is the workspace's pipeline journal: a
 * `review.stale-approval-rerequested` entry naming the head is written when the
 * door answers `started` or `already-running`. Any other answer (a refusal,
 * `already-passed` on a transient forge read, `tests-requeued`) started no
 * review, so it latches nothing and the next scheduler tick asks again.
 * Nothing else is stored.
 */
import { existsSync } from 'node:fs';

import type { PrFacts } from '../../../lib/cloister/pr-facts.js';
import {
  appendPipelineEntry,
  isReviewInFlightEntry,
  readPipelineJournal,
  type PipelineJournalEntry,
} from '../../../lib/cloister/pipeline-journal.js';
import {
  getGuardedReviewRequester,
  type GuardedReviewRequestOutcome,
} from '../../../lib/cloister/request-review-pipeline.js';
import { getIssueWorkspacePath } from '../../../lib/overdeck/issue-projects.js';

const SOURCE = 'stale-approval';
/** Door answers that mean a review is running for the head; only these latch it. */
const LATCHING_OUTCOMES: ReadonlySet<GuardedReviewRequestOutcome['kind']> = new Set(['started', 'already-running']);
export const STALE_APPROVAL_ENTRY = 'review.stale-approval-rerequested' as const;

export type StaleApprovalFacts = Partial<Pick<PrFacts,
  'forge' | 'open' | 'draft' | 'changesRequested' | 'approved' | 'approvedAtHead' | 'checks' | 'mergeable' | 'headSha'>>;

/**
 * The head whose approval is stale, or null. Stale means: GitHub calls the PR
 * approved, no approval is proven on its head, and nothing else stops the
 * merge (open, not a draft, no changes requested, green, mergeable). A PR
 * whose mergeability is not computed yet has an unproven approval too, but
 * that is a missing read, not a stale approval.
 */
export function staleApprovalHead(facts: StaleApprovalFacts): string | null {
  if (facts.forge !== 'github' || !facts.open || facts.draft || facts.changesRequested) return null;
  if (facts.approved !== true || facts.approvedAtHead === true) return null;
  if (facts.checks !== 'green' || facts.mergeable !== true || !facts.headSha) return null;
  return facts.headSha.toLowerCase();
}

export interface StaleApprovalRereviewDeps {
  workspacePathFor?: (issueId: string) => string | null;
  exists?: (path: string) => boolean;
  readJournal?: (workspacePath: string) => PipelineJournalEntry[];
  appendEntry?: typeof appendPipelineEntry;
  /** The guarded review door; null when this process registered none. */
  requestReview?: (issueId: string, message: string) => Promise<GuardedReviewRequestOutcome | null>;
}

async function defaultRequestReview(issueId: string, message: string): Promise<GuardedReviewRequestOutcome | null> {
  const requester = getGuardedReviewRequester();
  return requester ? requester(issueId, { source: SOURCE, message }) : null;
}

/**
 * Re-request review for a stale approval, once per head. Returns null when the
 * facts show no stale approval; otherwise one short clause for the scheduler's
 * skip reason saying what happened.
 */
export async function rereviewStaleApproval(
  issueId: string,
  facts: StaleApprovalFacts,
  deps: StaleApprovalRereviewDeps = {},
): Promise<string | null> {
  const head = staleApprovalHead(facts);
  if (!head) return null;
  const short = head.slice(0, 8);
  const workspacePath = (deps.workspacePathFor ?? getIssueWorkspacePath)(issueId);
  if (!workspacePath || !(deps.exists ?? existsSync)(workspacePath)) {
    return `approval is stale at ${short}; no workspace to re-review it from`;
  }
  const entries = (deps.readJournal ?? readPipelineJournal)(workspacePath);
  if (entries.some((entry) => (
    entry.type === STALE_APPROVAL_ENTRY
    && entry.data?.head === head
    && LATCHING_OUTCOMES.has(entry.data?.outcome as GuardedReviewRequestOutcome['kind'])
  ))) {
    return `approval is stale at ${short}; review already re-requested for this head`;
  }
  if (isReviewInFlightEntry(entries.at(-1) ?? null)) {
    return `approval is stale at ${short}; a review is already running`;
  }
  const outcome = await (deps.requestReview ?? defaultRequestReview)(
    issueId,
    `the approval is stale: head ${short} was pushed after the approving review`,
  );
  if (!outcome) return `approval is stale at ${short}; no review door in this process`;
  if (!LATCHING_OUTCOMES.has(outcome.kind)) {
    return `approval is stale at ${short}; review not started (${outcome.kind}), will ask again`;
  }
  (deps.appendEntry ?? appendPipelineEntry)(workspacePath, {
    type: STALE_APPROVAL_ENTRY,
    issueId: issueId.toUpperCase(),
    source: SOURCE,
    data: { head, outcome: outcome.kind },
  });
  return `approval is stale at ${short}; review re-requested (${outcome.kind})`;
}
