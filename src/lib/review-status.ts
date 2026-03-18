import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { notifyPipeline } from './pipeline-notifier.js';

export interface StatusHistoryEntry {
  type: 'review' | 'test' | 'merge';
  status: string;
  timestamp: string;
  notes?: string;
}

export interface ReviewStatus {
  issueId: string;
  reviewStatus: 'pending' | 'reviewing' | 'passed' | 'failed' | 'blocked';
  testStatus: 'pending' | 'testing' | 'passed' | 'failed' | 'skipped';
  mergeStatus?: 'pending' | 'merging' | 'merged' | 'failed';
  verificationStatus?: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  verificationNotes?: string;
  verificationCycleCount?: number;
  verificationMaxCycles?: number;
  reviewNotes?: string;
  testNotes?: string;
  mergeNotes?: string;
  updatedAt: string;
  readyForMerge: boolean;
  autoRequeueCount?: number;
  prUrl?: string;
  history?: StatusHistoryEntry[];
}

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
  // This is belt-and-suspenders — endpoint-level guards should catch this first.
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
  if (update.mergeStatus && update.mergeStatus !== existing.mergeStatus) {
    history.push({ type: 'merge', status: update.mergeStatus, timestamp: now });
  }
  while (history.length > 10) history.shift();

  const readyForMerge = update.readyForMerge !== undefined
    ? update.readyForMerge
    : (merged.reviewStatus === 'passed' && merged.testStatus === 'passed' && merged.mergeStatus !== 'merged');

  const updated: ReviewStatus = {
    ...merged,
    issueId,
    updatedAt: now,
    readyForMerge,
    history,
  };

  statuses[issueId] = updated;
  saveReviewStatuses(statuses, filePath);

  notifyPipeline({ type: 'status_changed', issueId, status: updated });

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
