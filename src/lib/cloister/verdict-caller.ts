/**
 * Who is recording a review verdict, and whether they may (#3853).
 *
 * `pan admin specialists done review` is two doors in one command: the review
 * agent records its verdict through it, and an operator overrides a verdict
 * through it. A review synthesizer on a redundant cycle once used it to flip an
 * approval on an unchanged head and called that an "operator-authorized
 * override". The override half is the operator's alone.
 *
 * The caller is told apart by `OVERDECK_AGENT_ID`, the identity every managed
 * pane carries on both terminal backends (the launch env on Herdr and tmux
 * alike). A process without it is an operator shell; a `conv-*` id is an
 * operator conversation. Anything else is an agent session.
 *
 * The approval half is proven by commit sha, never by dates: a GitHub review
 * whose commit is the head, or a verdict marker whose `sha=` names it. GitLab
 * gives no such proof, so there the guard never refuses a rejection.
 */

import type { PrFacts } from './pr-facts.js';

export type VerdictCaller =
  | { readonly kind: 'operator'; readonly id: string | null }
  | { readonly kind: 'agent'; readonly id: string };

/** Classify the process recording a verdict from its environment. */
export function verdictCallerFromEnv(env: NodeJS.ProcessEnv = process.env): VerdictCaller {
  const id = env.OVERDECK_AGENT_ID?.trim();
  if (!id) return { kind: 'operator', id: null };
  if (id.startsWith('conv-')) return { kind: 'operator', id };
  return { kind: 'agent', id };
}

/** True when `agentId` belongs to the issue's review fleet (`agent-<issue>-review[-…]`). */
export function isIssueReviewSession(agentId: string, issueId: string): boolean {
  const parent = `agent-${issueId.toLowerCase()}-review`;
  return agentId === parent || agentId.startsWith(`${parent}-`);
}

/**
 * The commit a review run reviewed, from its run id
 * (`agent-<issue>-review-<head8>`, stamped at dispatch from the workspace
 * HEAD), or null. A polyrepo run id carries a hash of the composite anchor
 * rather than a commit, so it never prefix-matches a real head.
 */
export function reviewedHeadFromRunId(runId: string | null | undefined, issueId: string): string | null {
  const prefix = `agent-${issueId.toLowerCase()}-review-`;
  if (!runId?.startsWith(prefix)) return null;
  const head = runId.slice(prefix.length).toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(head) ? head : null;
}

export interface ReviewVerdictGuardInput {
  readonly caller: VerdictCaller;
  readonly issueId: string;
  readonly status: 'passed' | 'failed' | 'blocked';
  /**
   * The forge's current account of the PR; null when it was not read. Only
   * `approvedAtHead: true` (an approval proven on the exact head sha) lets the
   * guard refuse; `false` or unset lets the verdict through.
   */
  readonly facts: Pick<PrFacts, 'approved' | 'approvedAtHead' | 'headSha'> | null;
  /**
   * The operator asked for this review run (a forced re-review from the
   * dashboard, or `pan review restart`). Its rejection answers the operator's
   * own request; it is not a redundant cycle reversing an approval.
   */
  readonly operatorRequested?: boolean;
}

/**
 * Why this caller may not record this review verdict, or null when it may.
 *
 * An operator may record any verdict. An agent may record one only as the
 * issue's own review session. Its rejection is refused only when an approval
 * is proven to stand on the exact current head and the operator did not ask
 * for this run: then there is no new commit to review, and the reversal is an
 * override. Unknown is not proof. Turning a real blocker into a pass is the
 * worse failure, so an unproven approval lets the rejection through.
 */
export function reviewVerdictRefusal(input: ReviewVerdictGuardInput): string | null {
  const { caller, issueId, status, facts } = input;
  if (caller.kind === 'operator') return null;
  if (!isIssueReviewSession(caller.id, issueId)) {
    return `${caller.id} is not ${issueId}'s review session; only its review agent or an operator records its review verdict.`;
  }
  if (status === 'passed' || input.operatorRequested === true) return null;
  if (facts?.approved === true && facts.approvedAtHead === true) {
    const head = facts.headSha ? facts.headSha.slice(0, 8) : 'the current head';
    return `${issueId} is approved at ${head} and no commit has landed since; an agent cannot reverse an approval on the commit it approved.`;
  }
  return null;
}
