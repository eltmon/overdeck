import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReviewStatus } from '../../review-status.js';

const mocks = vi.hoisted(() => ({
  resolveProjectFromIssueSync: vi.fn(),
  getProjectSync: vi.fn(),
  readIssueRecordSync: vi.fn(),
  updateIssueRecordForIssue: vi.fn(),
}));

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
  getProjectSync: mocks.getProjectSync,
}));
vi.mock('../../pan-dir/record.js', () => ({
  readIssueRecordSync: mocks.readIssueRecordSync,
}));
vi.mock('../../pan-dir/records.js', () => ({
  updateIssueRecordForIssue: mocks.updateIssueRecordForIssue,
}));

import { enrichReviewNotesFromRecordSync, readJournalStatusSync } from '../review-status-record-sync.js';

const baseStatus: ReviewStatus = {
  issueId: 'PAN-1866',
  reviewStatus: 'blocked',
  testStatus: 'pending',
  updatedAt: '2026-06-20T00:00:00.000Z',
  readyForMerge: false,
};

describe('enrichReviewNotesFromRecordSync (PAN-1988)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectKey: 'overdeck' });
    mocks.getProjectSync.mockReturnValue({ key: 'overdeck', path: '/repo' });
  });

  it('overlays feedback notes from the journal record onto a DB-sourced status', () => {
    mocks.readIssueRecordSync.mockReturnValue({
      pipeline: {
        reviewNotes: 'Sequencer scope regression — blocking',
        testNotes: '3 failing',
        verificationNotes: 'gate failed',
      },
    });

    const enriched = enrichReviewNotesFromRecordSync('PAN-1866', { ...baseStatus });

    expect(enriched.reviewNotes).toBe('Sequencer scope regression — blocking');
    expect(enriched.testNotes).toBe('3 failing');
    expect(enriched.verificationNotes).toBe('gate failed');
    // Status flags are untouched — they remain the DB's job.
    expect(enriched.reviewStatus).toBe('blocked');
  });

  it('keeps the passed-in status unchanged when no record exists (best-effort)', () => {
    mocks.readIssueRecordSync.mockReturnValue(null);
    const input = { ...baseStatus, reviewNotes: 'legacy db note' };
    const enriched = enrichReviewNotesFromRecordSync('PAN-1866', input);
    expect(enriched.reviewNotes).toBe('legacy db note');
  });

  it('never throws — returns the input status if project resolution fails', () => {
    mocks.resolveProjectFromIssueSync.mockImplementation(() => { throw new Error('boom'); });
    const input = { ...baseStatus, reviewNotes: 'kept' };
    expect(() => enrichReviewNotesFromRecordSync('PAN-1866', input)).not.toThrow();
    expect(enrichReviewNotesFromRecordSync('PAN-1866', input).reviewNotes).toBe('kept');
  });
});

describe('readJournalStatusSync terminal markers (PAN-2054)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectKey: 'overdeck' });
    mocks.getProjectSync.mockReturnValue({ key: 'overdeck', path: '/repo' });
  });

  it('projects closedOut and closedOutAt from the pipeline block', () => {
    mocks.readIssueRecordSync.mockReturnValue({
      pipeline: {
        issueId: 'PAN-2054',
        reviewStatus: 'passed',
        testStatus: 'passed',
        verificationStatus: 'running',
        mergeStatus: 'pending',
        readyForMerge: false,
        closedOut: true,
        closedOutAt: '2026-06-27T00:00:00.000Z',
        updatedAt: '2026-06-27T00:00:00.000Z',
      },
    });

    const journal = readJournalStatusSync('PAN-2054');

    expect(journal?.durable.closedOut).toBe(true);
    expect(journal?.durable.closedOutAt).toBe('2026-06-27T00:00:00.000Z');
  });
});
