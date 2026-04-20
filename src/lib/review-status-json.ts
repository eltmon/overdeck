/**
 * JSON file-backed review-status operations.
 *
 * Isolated from review-status.ts so that dashboard-reachable code
 * never imports sync FS operations (readFileSync, writeFileSync, mkdirSync).
 * Only tests and CLI tools that explicitly need JSON file I/O should import this module.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { normalizeReviewStatus } from './review-status-normalize.js';
import type { ReviewStatus } from './review-status.js';

const DEFAULT_STATUS_FILE = join(homedir(), '.panopticon', 'review-status.json');

export function loadReviewStatuses(filePath = DEFAULT_STATUS_FILE): Record<string, ReviewStatus> {
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf-8'));
    }
  } catch (err) {
    console.error('Failed to load review statuses:', err);
  }
  return {};
}

export function saveReviewStatuses(statuses: Record<string, ReviewStatus>, filePath = DEFAULT_STATUS_FILE): void {
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

export function setReviewStatus(
  issueId: string,
  update: Partial<ReviewStatus>,
  filePath = DEFAULT_STATUS_FILE,
): ReviewStatus {
  const statuses = loadReviewStatuses(filePath);
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

  const readyForMerge = update.readyForMerge !== undefined
    ? update.readyForMerge
    : (
        merged.reviewStatus === 'passed' &&
        merged.testStatus === 'passed' &&
        merged.mergeStatus !== 'merged' &&
        merged.mergeStatus !== 'failed' &&
        (merged.uatStatus === undefined || merged.uatStatus === 'passed')
      );

  const updated: ReviewStatus = normalizeReviewStatus({
    ...merged,
    issueId,
    updatedAt: now,
    readyForMerge,
    history,
  });

  statuses[issueId] = updated;
  saveReviewStatuses(statuses, filePath);
  return updated;
}

export function getReviewStatus(issueId: string, filePath = DEFAULT_STATUS_FILE): ReviewStatus | null {
  const statuses = loadReviewStatuses(filePath);
  return statuses[issueId] || null;
}

export function clearReviewStatus(issueId: string, filePath = DEFAULT_STATUS_FILE): void {
  const statuses = loadReviewStatuses(filePath);
  delete statuses[issueId];
  saveReviewStatuses(statuses, filePath);
}
