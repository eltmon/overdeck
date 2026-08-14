/**
 * PAN-3736 — how loudly to render a conversation's `forkFallbackReason`.
 *
 * A handoff that downgraded to a summary fork seeds the conversation with a
 * degraded prompt, and `forkFallbackReason` records that forever. While the
 * fork is still unresolved that is a live failure worth shouting about. Once
 * the conversation is demonstrably alive — it holds a session, or its
 * transcript has moved since the row was created — the reason is history, not
 * a live failure, and the dashboard's color rules reserve red for the latter.
 * So the badge drops to a muted informational note instead of staying red for
 * the rest of the conversation's life.
 */

/** `alert` = red, action-required styling. `note` = muted informational chip. */
export type FallbackBadgeTone = 'alert' | 'note';

/** The conversation fields the tone decision reads. */
export interface FallbackBadgeInput {
  /** Async fork provisioning status. Null once the fork resolved. */
  forkStatus?: string | null;
  status: string;
  sessionAlive: boolean;
  createdAt: string;
  /** Transcript mtime. Null when no transcript has been discovered yet. */
  lastActivityAt?: string | null;
}

/** True when the transcript moved after the row was created. */
function hasActivitySinceCreation(conv: FallbackBadgeInput): boolean {
  if (!conv.lastActivityAt) return false;
  const activity = Date.parse(conv.lastActivityAt);
  const created = Date.parse(conv.createdAt);
  if (Number.isNaN(activity) || Number.isNaN(created)) return false;
  return activity > created;
}

/**
 * Decide how to render a stored `forkFallbackReason`.
 *
 * Neutral only once the conversation is demonstrably healthy: the fork
 * resolved, the row is active, and it either holds a live session or has
 * produced transcript activity since it was created. Everything else — fork
 * in progress, fork failed, or a fallback-seeded conversation that never
 * showed a sign of life — keeps the red badge.
 */
export function fallbackBadgeTone(conv: FallbackBadgeInput): FallbackBadgeTone {
  // Non-null covers both the in-progress states and 'failed'.
  if (conv.forkStatus) return 'alert';
  if (conv.status !== 'active') return 'alert';
  if (conv.sessionAlive) return 'note';
  return hasActivitySinceCreation(conv) ? 'note' : 'alert';
}
