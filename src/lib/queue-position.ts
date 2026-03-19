/**
 * Queue position utilities for the specialist pipeline (PAN-366).
 *
 * These pure helpers are extracted from the review-status API handler so they
 * can be unit-tested independently of the Express server.
 */

import type { ReviewStatus } from './review-status.js';
import type { HookItem } from './hooks.js';

/** Sentinel value meaning the specialist is actively processing this issue now. */
export const SPECIALIST_ACTIVE_POSITION = 0;

/**
 * Return the English ordinal suffix for a positive integer.
 * Handles edge cases like 11th, 12th, 13th, 21st, 22nd, etc.
 */
export function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  const mod10 = n % 10;
  if (mod10 === 1) return 'st';
  if (mod10 === 2) return 'nd';
  if (mod10 === 3) return 'rd';
  return 'th';
}

/**
 * Format a queue position into a human-readable label.
 *
 * - Position 1  → "Queued"         (next up; no ordinal needed)
 * - Position 2+ → "Queued (2nd)", "Queued (3rd)", etc.
 */
export function formatQueueLabel(pos: number): string {
  if (pos === 1) return 'Queued';
  return `Queued (${pos}${ordinalSuffix(pos)})`;
}

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
