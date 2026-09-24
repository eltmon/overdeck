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

export interface ReviewVerdictGuardInput {
  readonly caller: VerdictCaller;
  readonly issueId: string;
  readonly status: 'passed' | 'failed' | 'blocked';
  /** The forge's current account of the PR; null when it was not read. */
  readonly facts: Pick<PrFacts, 'approved' | 'approvedAtHead' | 'headSha'> | null;
}

/**
 * Why this caller may not record this review verdict, or null when it may.
 *
 * An operator may record any verdict. An agent may record one only as the
 * issue's own review session, and never a rejection that reverses the approval
 * standing on the current head: with no new commit there is nothing new to
 * review, so that reversal is an override.
 */
export function reviewVerdictRefusal(input: ReviewVerdictGuardInput): string | null {
  const { caller, issueId, status, facts } = input;
  if (caller.kind === 'operator') return null;
  if (!isIssueReviewSession(caller.id, issueId)) {
    return `${caller.id} is not ${issueId}'s review session; only its review agent or an operator records its review verdict.`;
  }
  if (status !== 'passed' && facts?.approved && facts.approvedAtHead !== false) {
    const head = facts.headSha ? facts.headSha.slice(0, 8) : 'the current head';
    return `${issueId} is approved at ${head} and no commit has landed since; reversing that approval is an operator override, and ${caller.id} is an agent session.`;
  }
  return null;
}
