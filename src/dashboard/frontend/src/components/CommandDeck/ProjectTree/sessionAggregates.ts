/**
 * sessionAggregates — pure predicates that fold a feature's descendant sessions
 * into one signal for its row. Extracted from FeatureItem (a baselined god file)
 * so aggregation logic has a home that can be tested directly, matching the
 * sibling-helper precedent set by troubledBadge.ts.
 */
import type { SessionNode as SessionNodeType } from '@overdeck/contracts';
import { type StatusDotStatus } from '../StatusDot';

/**
 * PAN-2765 — does any descendant session need the operator?
 *
 * A wait can be buried a level down in the tree, so the issue row has to carry
 * it without the operator expanding anything. This is what makes a prose
 * question visible: a plan agent that ends its turn leaves no other trace on the
 * row, and a live planning session once sat 36 minutes unanswered because the
 * issue looked idle from the outside.
 */
export function sessionsNeedAttention(sessions: readonly SessionNodeType[]): boolean {
  return sessions.some((session) => session.awaitingInput === true);
}

/** Fold sessions into the single dot shown on a collapsed feature row.
 *  Priority: active > thinking > waiting > idle > ended. */
export function computeDominantStatus(sessions: readonly SessionNodeType[]): StatusDotStatus {
  let hasIdle = false;
  let hasThinking = false;
  let hasWaiting = false;
  for (const s of sessions) {
    if (s.awaitingInput === true) hasWaiting = true;
    if (s.presence === 'active' && s.awaitingInput !== true) return 'active';
    if (s.presence === 'idle') hasIdle = true;
    const st = (s.status || '').toLowerCase();
    if (st.includes('thinking')) hasThinking = true;
    if (st.includes('waiting')) hasWaiting = true;
  }
  if (hasThinking) return 'thinking';
  if (hasWaiting) return 'waiting';
  if (hasIdle) return 'idle';
  return 'ended';
}
