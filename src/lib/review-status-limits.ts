/**
 * Canonical limits for review.status_changed payloads (PAN-3253).
 *
 * These limits are enforced at four points:
 * 1. Composition (review-status.ts) — caps notes when transitions are recorded
 * 2. Hydration (review-status-sync.ts) — caps notes when loading from database
 * 3. Persistence (event-store.ts) — bounds payloads at append, appendAsync, and appendOnce
 * 4. Boot-time migration (event-store.ts) — trims historical oversized rows
 *
 * All enforcement points must use these same constants to prevent silent drift.
 */

export const REVIEW_STATUS_HISTORY_LIMIT = 20;
export const REVIEW_STATUS_NOTE_LIMIT = 500;
