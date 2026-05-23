/**
 * JSON file-backed review-status operations.
 *
 * Isolated from review-status.ts so that dashboard-reachable code
 * never imports sync FS operations (readFileSync, writeFileSync, mkdirSync).
 * Only tests and CLI tools that explicitly need JSON file I/O should import this module.
 */

import { Effect } from 'effect';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { normalizeReviewStatusSync } from './review-status-normalize.js';
import type { ReviewStatus } from './review-status.js';
import { FsError } from './errors.js';

const DEFAULT_STATUS_FILE = join(homedir(), '.panopticon', 'review-status.json');

export function loadReviewStatusesSync(filePath = DEFAULT_STATUS_FILE): Record<string, ReviewStatus> {
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf-8'));
    }
  } catch (err) {
    console.error('Failed to load review statuses:', err);
  }
  return {};
}

export function saveReviewStatusesSync(statuses: Record<string, ReviewStatus>, filePath = DEFAULT_STATUS_FILE): void {
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(statuses, null, 2));
  } catch (err) {
    console.error('Failed to save review statuses:', err);
  }
}

export function setReviewStatusSync(
  issueId: string,
  update: Partial<ReviewStatus>,
  filePath = DEFAULT_STATUS_FILE,
): ReviewStatus {
  const statuses = loadReviewStatusesSync(filePath);
  const existing = statuses[issueId] || {
    issueId,
    reviewStatus: 'pending' as const,
    testStatus: 'pending' as const,
    updatedAt: new Date().toISOString(),
    readyForMerge: false,
  };

  // Guard: reject reviewStatus regression from 'passed' to 'reviewing' unless the caller
  // is explicitly resetting the merge lifecycle (update includes mergeStatus).
  if (update.reviewStatus === 'reviewing' && existing.reviewStatus === 'passed' && update.mergeStatus === undefined) {
    console.warn(`[review-status] Rejecting reviewStatus regression from 'passed' to 'reviewing' for ${issueId} (mergeStatus not being reset)`);
    return existing as ReviewStatus;
  }

  const merged = { ...existing, ...update };

  // Track status transitions in history (last 10 entries)
  const history = [...(existing.history || [])];
  const now = new Date().toISOString();
  if (update.reviewStatus && update.reviewStatus !== existing.reviewStatus) {
    history.push({ type: 'review', status: update.reviewStatus, timestamp: now, notes: update.reviewNotes });
  }
  if (update.testStatus && update.testStatus !== existing.testStatus) {
    history.push({ type: 'test', status: update.testStatus, timestamp: now, notes: update.testNotes });
  }
  if (update.uatStatus && update.uatStatus !== existing.uatStatus) {
    history.push({ type: 'uat', status: update.uatStatus, timestamp: now, notes: update.uatNotes });
  }
  if (update.mergeStatus && update.mergeStatus !== existing.mergeStatus) {
    history.push({ type: 'merge', status: update.mergeStatus, timestamp: now });
  }
  while (history.length > 10) history.shift();

  // PAN-1048: readyForMerge is only set explicitly by the ship role.
  // PAN-905: GitHub-native blockers always override readyForMerge to false.
  const hasBlockers = (merged.blockerReasons?.length ?? 0) > 0;
  const readyForMerge = hasBlockers
    ? false
    : (update.readyForMerge !== undefined
        ? update.readyForMerge
        : merged.readyForMerge ?? false);

  const updated: ReviewStatus = normalizeReviewStatusSync({
    ...merged,
    issueId,
    updatedAt: now,
    readyForMerge,
    history,
  });

  statuses[issueId] = updated;
  saveReviewStatusesSync(statuses, filePath);
  return updated;
}

export function getReviewStatusSync(issueId: string, filePath = DEFAULT_STATUS_FILE): ReviewStatus | null {
  const statuses = loadReviewStatusesSync(filePath);
  return statuses[issueId] || null;
}

export function clearReviewStatusSync(issueId: string, filePath = DEFAULT_STATUS_FILE): void {
  const statuses = loadReviewStatusesSync(filePath);
  delete statuses[issueId];
  saveReviewStatusesSync(statuses, filePath);
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
// Sync FS wrappers (the underlying impl uses sync FS by design — CLI-only).
// FsError is surfaced when a JSON file is unreadable / unparseable so callers
// can distinguish a real failure from an empty-result.

/** Load all statuses from disk. Pure (logs but does not throw). */
export const loadReviewStatuses = (
  filePath: string = DEFAULT_STATUS_FILE,
): Effect.Effect<Record<string, ReviewStatus>> =>
  Effect.sync(() => loadReviewStatusesSync(filePath));

/** Persist all statuses to disk; surfaces FsError on failure. */
export const saveReviewStatuses = (
  statuses: Record<string, ReviewStatus>,
  filePath: string = DEFAULT_STATUS_FILE,
): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => saveReviewStatusesSync(statuses, filePath),
    catch: (cause) =>
      new FsError({ path: filePath, operation: 'save-review-statuses', cause }),
  });

/** Atomically merge + persist a single issue's review status. */
export const setReviewStatus = (
  issueId: string,
  update: Partial<ReviewStatus>,
  filePath: string = DEFAULT_STATUS_FILE,
): Effect.Effect<ReviewStatus, FsError> =>
  Effect.try({
    try: () => setReviewStatusSync(issueId, update, filePath),
    catch: (cause) =>
      new FsError({ path: filePath, operation: 'set-review-status', cause }),
  });

/** Read one issue's status. Pure. */
export const getReviewStatus = (
  issueId: string,
  filePath: string = DEFAULT_STATUS_FILE,
): Effect.Effect<ReviewStatus | null> =>
  Effect.sync(() => getReviewStatusSync(issueId, filePath));

/** Remove one issue's status from disk. */
export const clearReviewStatus = (
  issueId: string,
  filePath: string = DEFAULT_STATUS_FILE,
): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => clearReviewStatusSync(issueId, filePath),
    catch: (cause) =>
      new FsError({ path: filePath, operation: 'clear-review-status', cause }),
  });
