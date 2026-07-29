/**
 * navigateToDecisionSubject — the one way a "needs you" surface sends the
 * operator to whatever is waiting on them.
 *
 * A pending decision lives in one of two planes and each has its own route: an
 * agent is reached through its issue (`/issues/:id`, which opens the issue view
 * with the agent tree and its terminal), a conversation through `/conv/:name`.
 * Navigation goes through the URL door — pushState plus a synthetic popstate,
 * which App's onPopState already owns — so any surface can call this without
 * threading callbacks down from App.
 *
 * PAN-3276: this used to live inside DecisionsIndicator, so only the decisions
 * popover could navigate. The "Needs you" list in the session-feed sidebar just
 * called `requestReopen`, which is a no-op for the kinds that carry no dialog
 * payload (a question typed into the terminal, a permission prompt) — clicking
 * those rows appeared to do nothing at all and the operator had to go hunt for
 * the session by hand.
 */
import type { PendingInputSource } from './store';

/** The minimum a subject must expose to be navigable. `Decision` and the row shapes both satisfy it. */
export interface DecisionSubjectTarget {
  id: string;
  source: PendingInputSource;
  issueId?: string;
}

/** The path a subject resolves to, or null when there is nowhere to send the operator. */
export function decisionSubjectPath(target: DecisionSubjectTarget): string | null {
  if (target.source === 'conversation') return `/conv/${encodeURIComponent(target.id)}`;
  return target.issueId ? `/issues/${encodeURIComponent(target.issueId)}` : null;
}

export function navigateToDecisionSubject(target: DecisionSubjectTarget): void {
  const path = decisionSubjectPath(target);
  if (!path) return;
  if (window.location.pathname !== path) window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
