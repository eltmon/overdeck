/**
 * Queue position utilities for the specialist pipeline (PAN-366).
 *
 * These pure helpers are extracted from the review-status API handler so they
 * can be unit-tested independently of the Express server.
 */

import { Effect } from 'effect';
import type { ReviewStatus } from './review-status.js';
import type { HookItem } from './hooks.js';

/** Sentinel value meaning the specialist is actively processing this issue now. */
export const SPECIALIST_ACTIVE_POSITION = 0;

export interface QueuePositionResult {
  /** null = not queued; 0 = actively processing; 1+ = position in queue */
  queuePosition: number | null;
  /** Which specialist is handling (or will handle) this issue */
  activeSpecialist: 'review' | 'test' | 'merge' | null;
}

/**
 * Derive queue position from the persisted review status fields alone.
 * Returns {0, specialist} when the status indicates active processing,
 * or {null, null} when no active phase is detected (caller must check queues).
 */
export function computeQueuePositionFromStatus(
  status: Pick<ReviewStatus, 'reviewStatus' | 'testStatus' | 'mergeStatus'> | null
): QueuePositionResult {
  if (status?.reviewStatus === 'reviewing') {
    return { queuePosition: SPECIALIST_ACTIVE_POSITION, activeSpecialist: 'review' };
  }
  if (status?.testStatus === 'testing') {
    return { queuePosition: SPECIALIST_ACTIVE_POSITION, activeSpecialist: 'test' };
  }
  if (status?.mergeStatus === 'merging') {
    return { queuePosition: SPECIALIST_ACTIVE_POSITION, activeSpecialist: 'merge' };
  }
  return { queuePosition: null, activeSpecialist: null };
}

/**
 * Find this issueId's 1-based position in a specialist's pending queue.
 * Returns -1 if not found (caller interprets as "not queued").
 */
export function findPositionInQueue(issueId: string, items: HookItem[]): number {
  const upper = issueId.toUpperCase();
  const idx = items.findIndex(
    (item) => item.payload?.issueId?.toUpperCase() === upper
  );
  return idx >= 0 ? idx + 1 : -1;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Effect variant of {@link computeQueuePositionFromStatus}. Pure; cannot fail. */
export const computeQueuePositionFromStatusEffect = (
  status: Pick<ReviewStatus, 'reviewStatus' | 'testStatus' | 'mergeStatus'> | null,
): Effect.Effect<QueuePositionResult, never> =>
  Effect.sync(() => computeQueuePositionFromStatus(status));

/** Effect variant of {@link findPositionInQueue}. Pure; cannot fail. */
export const findPositionInQueueEffect = (
  issueId: string,
  items: HookItem[],
): Effect.Effect<number, never> =>
  Effect.sync(() => findPositionInQueue(issueId, items));
