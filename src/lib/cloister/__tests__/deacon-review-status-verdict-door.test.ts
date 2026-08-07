/**
 * PAN-3512 — the two orphan-restore terminal verdict writes in
 * deacon-review-status.ts route through the verdict write door.
 *
 * Before PAN-3512 these paths wrote the review row directly, so a restore whose
 * evidence head disagreed with the row anchor was dropped by the old guard with
 * no event and no honest next step. The restore also has to carry its
 * stuck-clearing and retry-counter fields into the same atomic write — dropping
 * them deadlocks the issue at passed+stuck.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  recordReviewVerdict: vi.fn(),
  getReviewStatusSync: vi.fn(),
  isIssueClosed: vi.fn(),
}));

vi.mock('../review-verdict-writer.js', () => ({
  recordReviewVerdict: mocks.recordReviewVerdict,
}));

const { recordOrphanRestoreVerdict } = await import('../orphan-restore-verdict.js');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recordReviewVerdict.mockResolvedValue({ landed: true, classification: 'no-evidence' });
});

describe('orphan-restore verdict door adapter (PAN-3512)', () => {
  it('records the restored verdict with writer "orphan-restore" and its notes', async () => {
    await recordOrphanRestoreVerdict('PAN-1577', {
      reviewStatus: 'passed',
      reviewNotes: 'Review approved before the coordinator exited',
    });

    expect(mocks.recordReviewVerdict).toHaveBeenCalledTimes(1);
    const [issueId, input] = mocks.recordReviewVerdict.mock.calls[0]!;
    expect(issueId).toBe('PAN-1577');
    expect(input.verdict).toBe('passed');
    expect(input.notes).toBe('Review approved before the coordinator exited');
    expect(input.writer).toBe('orphan-restore');
  });

  it('carries the stuck-clearing and retry fields through as extra so the row cannot deadlock at passed+stuck', async () => {
    await recordOrphanRestoreVerdict('PAN-1577', {
      reviewStatus: 'passed',
      reviewNotes: 'restored',
      stuck: false,
      stuckReason: undefined,
      stuckAt: undefined,
      stuckDetails: undefined,
      testStatus: 'passed',
      testNotes: 'tests green',
      reviewRetryCount: 0,
      mergeStatus: 'pending',
    });

    const { extra } = mocks.recordReviewVerdict.mock.calls[0]![1];
    expect(extra).toMatchObject({
      stuck: false,
      testStatus: 'passed',
      testNotes: 'tests green',
      reviewRetryCount: 0,
      mergeStatus: 'pending',
    });
    expect('stuckReason' in extra).toBe(true);
    // The verdict fields are consumed by the door, not smuggled through extra.
    expect(extra).not.toHaveProperty('reviewStatus');
    expect(extra).not.toHaveProperty('reviewNotes');
  });

  it('promotes a snapshotted reviewedAtCommit to the door evidence head', async () => {
    await recordOrphanRestoreVerdict('PAN-1577', {
      reviewStatus: 'passed',
      reviewNotes: 'restored',
      reviewedAtCommit: 'abc123def456',
    });

    const input = mocks.recordReviewVerdict.mock.calls[0]![1];
    expect(input.evidenceHead).toBe('abc123def456');
    expect(input.extra).not.toHaveProperty('reviewedAtCommit');
  });

  it('omits the evidence head entirely when the restore has no anchor', async () => {
    await recordOrphanRestoreVerdict('PAN-1577', { reviewStatus: 'passed', reviewNotes: 'restored' });

    expect(mocks.recordReviewVerdict.mock.calls[0]![1].evidenceHead).toBeUndefined();
  });

  it('returns the door outcome unchanged so callers can report a rejection', async () => {
    mocks.recordReviewVerdict.mockResolvedValue({ landed: false, reason: 'stale-evidence-head' });

    const outcome = await recordOrphanRestoreVerdict('PAN-1577', { reviewStatus: 'passed' });

    expect(outcome).toEqual({ landed: false, reason: 'stale-evidence-head' });
  });
});

describe('handleReviewCoordinatorDied restore (PAN-3512)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function loadHandler() {
    vi.doMock('../../review-status.js', () => ({
      getReviewStatusSync: mocks.getReviewStatusSync,
      loadReviewStatuses: vi.fn(() => ({})),
      setReviewStatusSync: vi.fn(),
    }));
    vi.doMock('../issue-closed.js', () => ({ isIssueClosed: mocks.isIssueClosed }));
    vi.doMock('../orphan-restore-verdict.js', () => ({
      recordOrphanRestoreVerdict: mocks.recordReviewVerdict,
    }));
    return import('../deacon-review-status.js');
  }

  it('reports the restore as landed when the door accepts it', async () => {
    mocks.isIssueClosed.mockResolvedValue(false);
    mocks.getReviewStatusSync.mockReturnValue({
      history: [
        { type: 'review', status: 'passed', notes: 'approved' },
        { type: 'test', status: 'passed', notes: 'green' },
      ],
    });
    mocks.recordReviewVerdict.mockResolvedValue({ landed: true, classification: 'no-evidence' });

    const { handleReviewCoordinatorDied } = await loadHandler();
    const actions = await handleReviewCoordinatorDied('PAN-1577', 'agent-pan-1577-review', 'exited');

    expect(mocks.recordReviewVerdict).toHaveBeenCalledTimes(1);
    expect(actions.some(a => a.includes('Restored completed review'))).toBe(true);
  });

  it('reports the rejection reason instead of claiming a restore when the door refuses', async () => {
    mocks.isIssueClosed.mockResolvedValue(false);
    mocks.getReviewStatusSync.mockReturnValue({
      history: [{ type: 'review', status: 'passed', notes: 'approved' }],
    });
    mocks.recordReviewVerdict.mockResolvedValue({ landed: false, reason: 'stale-evidence-head' });

    const { handleReviewCoordinatorDied } = await loadHandler();
    const actions = await handleReviewCoordinatorDied('PAN-1577', 'agent-pan-1577-review', 'exited');

    expect(actions.some(a => a.includes('not recorded (stale-evidence-head)'))).toBe(true);
    expect(actions.some(a => a.includes('Restored completed review'))).toBe(false);
  });
});
