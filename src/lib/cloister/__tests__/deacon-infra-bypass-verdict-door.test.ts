/**
 * PAN-3512 — the review-infrastructure bypass routes its terminal verdict
 * through the write door.
 *
 * The bypass resolves a review-infra failure for an issue whose verification
 * already passed. It carries a LIVE workspace head, so under dispatch-not-drop
 * it lands and re-gates instead of being silently rejected against a stale row
 * anchor — that behavior change is intended. Its four stuck-clearing fields must
 * ride in the same atomic write or the issue deadlocks at passed+stuck.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  recordReviewVerdict: vi.fn(),
  loadReviewStatuses: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  snapshotWorkspaceHeadsPromise: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('../review-verdict-writer.js', () => ({ recordReviewVerdict: mocks.recordReviewVerdict }));
vi.mock('../../review-status.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadReviewStatuses: mocks.loadReviewStatuses,
}));
vi.mock('../../projects.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
}));
vi.mock('../../git-utils.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  snapshotWorkspaceHeadsPromise: mocks.snapshotWorkspaceHeadsPromise,
}));
vi.mock('fs', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  existsSync: mocks.existsSync,
}));

const { checkVerificationReviewContradiction } = await import('../deacon.js');

const ISSUE = 'PAN-1577';
const LIVE_HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

/** The only shape the bypass acts on: verified, still 'reviewing', infra-stuck. */
const CONTRADICTED = {
  verificationStatus: 'passed',
  reviewStatus: 'reviewing',
  stuckReason: 'review_infrastructure_failure',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadReviewStatuses.mockReturnValue({ [ISSUE]: CONTRADICTED });
  mocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/projects/overdeck' });
  mocks.existsSync.mockReturnValue(true);
  mocks.snapshotWorkspaceHeadsPromise.mockResolvedValue(LIVE_HEAD);
  mocks.recordReviewVerdict.mockResolvedValue({ landed: true, classification: 'dispatched' });
});

describe('review-infrastructure bypass — verdict write door (PAN-3512)', () => {
  it('records the bypass with writer "infra-bypass" and the live head as evidence', async () => {
    const actions = await checkVerificationReviewContradiction();

    expect(mocks.recordReviewVerdict).toHaveBeenCalledTimes(1);
    const [issueId, input] = mocks.recordReviewVerdict.mock.calls[0]!;
    expect(issueId).toBe(ISSUE);
    expect(input.verdict).toBe('passed');
    expect(input.writer).toBe('infra-bypass');
    expect(input.evidenceHead).toBe(LIVE_HEAD);
    expect(actions.some(a => a.includes('Bypassed review'))).toBe(true);
  });

  it('carries all four stuck-clearing fields so the issue cannot deadlock at passed+stuck', async () => {
    await checkVerificationReviewContradiction();

    const { extra } = mocks.recordReviewVerdict.mock.calls[0]![1];
    expect(extra.stuck).toBe(false);
    for (const field of ['stuckReason', 'stuckAt', 'stuckDetails']) {
      expect(field in extra).toBe(true);
      expect(extra[field]).toBeUndefined();
    }
  });

  it('omits the evidence head when the workspace head cannot be snapshotted', async () => {
    mocks.existsSync.mockReturnValue(false);

    await checkVerificationReviewContradiction();

    expect(mocks.recordReviewVerdict.mock.calls[0]![1].evidenceHead).toBeUndefined();
  });

  it('reports the rejection reason instead of claiming a bypass that did not land', async () => {
    mocks.recordReviewVerdict.mockResolvedValue({ landed: false, reason: 'stale-evidence-head' });

    const actions = await checkVerificationReviewContradiction();

    expect(actions.some(a => a.includes('not recorded (stale-evidence-head)'))).toBe(true);
    expect(actions.some(a => a.includes('Bypassed review'))).toBe(false);
  });

  it('leaves an issue alone when it is not in the verified-but-infra-stuck contradiction', async () => {
    mocks.loadReviewStatuses.mockReturnValue({
      [ISSUE]: { ...CONTRADICTED, stuckReason: 'verification_stuck' },
    });

    const actions = await checkVerificationReviewContradiction();

    expect(mocks.recordReviewVerdict).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });
});
