import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReviewStatus } from '../review-status.js';

const uatFeedback = vi.hoisted(() => ({
  relay: vi.fn(),
  clearAnchor: vi.fn(),
}));
const db = vi.hoisted(() => ({
  upsert: vi.fn(),
  delete: vi.fn(),
  getFromDb: vi.fn(),
  getManyFromDb: vi.fn(),
}));
const journal = vi.hoisted(() => ({
  readJournalStatusSync: vi.fn(),
  enrichReviewNotesFromRecordSync: vi.fn((_id: string, status: ReviewStatus) => status),
  updateIssueRecordForReviewStatusSync: vi.fn(),
}));

vi.mock('../cloister/uat-failure-feedback.js', () => ({
  relayUatFailureFeedbackPromise: uatFeedback.relay,
  clearUatFailureFeedbackAnchor: uatFeedback.clearAnchor,
}));
vi.mock('../overdeck/review-status-sync.js', () => ({
  upsertReviewStatusSync: db.upsert,
  getReviewStatusFromDbSync: db.getFromDb,
  deleteReviewStatus: db.delete,
  getAllReviewStatusesFromDb: vi.fn(() => ({})),
  getReviewStatusesFromDb: db.getManyFromDb,
  markWorkspaceStuck: vi.fn(),
  clearWorkspaceStuck: vi.fn(),
  setDeaconIgnored: vi.fn(),
  setAutoMerge: vi.fn(),
}));
vi.mock('../overdeck/review-status-record-sync.js', () => ({
  readJournalStatusSync: journal.readJournalStatusSync,
  enrichReviewNotesFromRecordSync: journal.enrichReviewNotesFromRecordSync,
  updateIssueRecordForReviewStatusSync: journal.updateIssueRecordForReviewStatusSync,
}));
vi.mock('../pipeline-notifier.js', () => ({ notifyPipelineSync: vi.fn() }));
vi.mock('../activity-logger.js', () => ({ emitActivityEntrySync: vi.fn(), emitActivityTtsSync: vi.fn() }));

import { clearReviewStatus, setReviewStatusSync } from '../review-status.js';

const existingStatus = (overrides: Partial<ReviewStatus> = {}): ReviewStatus => ({
  issueId: 'PAN-3575',
  reviewStatus: 'passed',
  testStatus: 'passed',
  verificationStatus: 'passed',
  readyForMerge: false,
  updatedAt: '2026-08-06T07:00:00.000Z',
  ...overrides,
});

const flushUatRelay = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('setReviewStatusSync UAT failure feedback (PAN-3575)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uatFeedback.relay.mockResolvedValue({ agentMessageSent: true });
    uatFeedback.clearAnchor.mockReturnValue(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('routes failed UAT notes through the relay', async () => {
    setReviewStatusSync('pan-3575', {
      uatStatus: 'failed',
      uatNotes: 'AC-3 save operation does not persist',
    }, existingStatus());
    await flushUatRelay();

    expect(uatFeedback.relay).toHaveBeenCalledWith({
      issueId: 'PAN-3575',
      uatNotes: 'AC-3 save operation does not persist',
      anchor: undefined,
    });
  });

  it('passes the reviewed commit as the UAT relay anchor', async () => {
    setReviewStatusSync('PAN-3575', { uatStatus: 'failed' }, existingStatus({ reviewedAtCommit: 'abc123' }));
    await flushUatRelay();

    expect(uatFeedback.relay).toHaveBeenCalledWith(expect.objectContaining({ anchor: 'abc123' }));
  });

  it('clears the UAT feedback anchor on a non-failed UAT verdict without relaying', async () => {
    setReviewStatusSync('PAN-3575', { uatStatus: 'passed' }, existingStatus({ uatStatus: 'failed' }));
    await flushUatRelay();

    expect(uatFeedback.clearAnchor).toHaveBeenCalledWith('PAN-3575');
    expect(uatFeedback.relay).not.toHaveBeenCalled();
  });

  it('clears the UAT feedback anchor when terminal lifecycle clears review status', async () => {
    clearReviewStatus('PAN-3575');
    await flushUatRelay();

    expect(uatFeedback.clearAnchor).toHaveBeenCalledWith('PAN-3575');
  });

  it('preserves the UAT failure status when the relay rejects', async () => {
    uatFeedback.relay.mockRejectedValue(new Error('feedback write unavailable'));

    const status = setReviewStatusSync('PAN-3575', { uatStatus: 'failed' }, existingStatus());
    await flushUatRelay();

    expect(status.uatStatus).toBe('failed');
    expect(uatFeedback.relay).toHaveBeenCalledOnce();
  });

  it('keeps the UAT relay dynamically imported to avoid the feedback-target cycle', async () => {
    const source = await readFile(new URL('../review-status.ts', import.meta.url), 'utf8');

    expect(source).toContain("await import('./cloister/uat-failure-feedback.js')");
    expect(source).not.toMatch(/^import\s+.*from\s+['"]\.\/cloister\/uat-failure-feedback\.js['"];?$/m);
  });
});
