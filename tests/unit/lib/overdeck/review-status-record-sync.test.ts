/**
 * Tests for PAN-2689: flushReviewStatusJournalWrites drains the fire-and-forget
 * journal writes so a short-lived CLI process cannot exit past an in-flight
 * verdict write (the incident: `pan admin specialists done` exited in <1s and
 * the sandboxed review verdict vanished while the CLI printed success).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReviewStatus } from '../../../../src/lib/review-status.js';

const mockUpdateIssueRecordForIssue = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/lib/pan-dir/records.js', () => ({
  updateIssueRecordForIssue: mockUpdateIssueRecordForIssue,
}));

// The workspace-fallback path resolves the project; return null so the
// fallback branch is a no-op instead of touching the filesystem.
vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: vi.fn(() => null),
  getProjectSync: vi.fn(() => undefined),
}));

vi.mock('../../../../src/lib/pan-dir/record.js', () => ({
  readIssueRecordSync: vi.fn(() => null),
}));

import {
  updateIssueRecordForReviewStatusSync,
  flushReviewStatusJournalWrites,
} from '../../../../src/lib/overdeck/review-status-record-sync.js';

const status: ReviewStatus = {
  issueId: 'PAN-2689',
  reviewStatus: 'passed',
  testStatus: 'pending',
  readyForMerge: false,
  updatedAt: '2026-07-15T05:12:52.000Z',
} as ReviewStatus;

beforeEach(() => {
  mockUpdateIssueRecordForIssue.mockReset();
});

describe('flushReviewStatusJournalWrites (PAN-2689)', () => {
  it('resolves immediately when no journal writes are pending', async () => {
    await expect(flushReviewStatusJournalWrites()).resolves.toBeUndefined();
  });

  it('waits for an in-flight journal write to land before resolving', async () => {
    let resolveWrite!: (landed: boolean) => void;
    mockUpdateIssueRecordForIssue.mockReturnValue(
      new Promise<boolean>((resolve) => { resolveWrite = resolve; }),
    );

    updateIssueRecordForReviewStatusSync('PAN-2689', status);

    let flushed = false;
    const flush = flushReviewStatusJournalWrites().then(() => { flushed = true; });

    await new Promise((r) => setImmediate(r));
    expect(flushed).toBe(false);

    resolveWrite(true);
    await flush;
    expect(flushed).toBe(true);
    expect(mockUpdateIssueRecordForIssue).toHaveBeenCalledWith('PAN-2689', status);
  });

  it('drains multiple pending writes', async () => {
    const resolvers: Array<(landed: boolean) => void> = [];
    mockUpdateIssueRecordForIssue.mockImplementation(
      () => new Promise<boolean>((resolve) => { resolvers.push(resolve); }),
    );

    updateIssueRecordForReviewStatusSync('PAN-2689', status);
    updateIssueRecordForReviewStatusSync('PAN-2690', status);

    let flushed = false;
    const flush = flushReviewStatusJournalWrites().then(() => { flushed = true; });

    resolvers[0](true);
    await new Promise((r) => setImmediate(r));
    expect(flushed).toBe(false);

    resolvers[1](true);
    await flush;
    expect(flushed).toBe(true);
  });

  it('resolves even when the journal write rejects (fallback ran via catch)', async () => {
    mockUpdateIssueRecordForIssue.mockRejectedValue(new Error('EROFS: sandbox'));

    updateIssueRecordForReviewStatusSync('PAN-2689', status);

    await expect(flushReviewStatusJournalWrites()).resolves.toBeUndefined();
  });
});
