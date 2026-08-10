import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewStatus } from '../../review-status.js';

const mocks = vi.hoisted(() => ({
  getReviewStatusSync: vi.fn(),
  setReviewStatusSync: vi.fn(),
  getCloisterEventStore: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  resolveWorkspaceRepoRootsSync: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock('../../review-status.js', () => ({
  getReviewStatusSync: mocks.getReviewStatusSync,
  setReviewStatusSync: mocks.setReviewStatusSync,
}));

vi.mock('../event-store-provider.js', () => ({
  getCloisterEventStore: mocks.getCloisterEventStore,
}));

vi.mock('../../activity-logger.js', () => ({
  emitActivityEntrySync: mocks.emitActivityEntrySync,
}));

vi.mock('../../project-repos.js', () => ({
  resolveWorkspaceRepoRootsSync: mocks.resolveWorkspaceRepoRootsSync,
}));

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
}));

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  execFile: mocks.execFile,
}));

import { recordReviewVerdict, type VerdictInput } from '../review-verdict-writer.js';

function mockAncestorProbe(isAncestor: boolean): void {
  mocks.execFile.mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error | null, stdout: string, stderr: string) => void;
    if (isAncestor) {
      callback(null, '', '');
    } else {
      callback(Object.assign(new Error('not an ancestor'), { code: 1 }), '', '');
    }
    return undefined;
  });
}

function reviewStatus(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'PAN-3512',
    reviewStatus: 'pending',
    testStatus: 'pending',
    verificationStatus: 'pending',
    mergeStatus: 'pending',
    readyForMerge: false,
    workspaceDir: '/workspaces/feature-pan-3512',
    lastVerifiedCommit: 'a'.repeat(40),
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('recordReviewVerdict', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCloisterEventStore.mockReturnValue(null);
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/project' });
  });

  describe('no-evidence path', () => {
    it('Given a VerdictInput with no evidenceHead, recordReviewVerdict calls setReviewStatusSync once with the verdict fields and returns { landed: true, classification: "no-evidence" }', async () => {
      const status = reviewStatus();
      mocks.getReviewStatusSync.mockReturnValue(status);
      mocks.setReviewStatusSync.mockReturnValue(status);

      const input: VerdictInput = {
        verdict: 'passed',
        notes: 'looks good',
        writer: 'coordinator',
      };

      const result = await recordReviewVerdict('PAN-3512', input);

      expect(result).toEqual({ landed: true, classification: 'no-evidence' });
      expect(mocks.setReviewStatusSync).toHaveBeenCalledOnce();
      expect(mocks.setReviewStatusSync).toHaveBeenCalledWith(
        'PAN-3512',
        expect.objectContaining({
          reviewStatus: 'passed',
          reviewNotes: 'looks good',
        }),
        status,
      );
    });

    it('Given no existing row, the door creates it and lands the verdict', async () => {
      mocks.getReviewStatusSync.mockReturnValue(undefined);
      mocks.setReviewStatusSync.mockReturnValue(reviewStatus({ reviewStatus: 'blocked' }));

      const result = await recordReviewVerdict('PAN-3512', {
        verdict: 'blocked',
        notes: 'first verdict',
        writer: 'coordinator',
      });

      expect(result).toEqual({ landed: true, classification: 'no-evidence' });
      expect(mocks.setReviewStatusSync).toHaveBeenCalledWith('PAN-3512', {
        reviewStatus: 'blocked',
        reviewNotes: 'first verdict',
      });
    });

    it('Given no lastVerifiedCommit on the row, the door takes the no-evidence path and returns { landed: true, classification: "no-evidence" }', async () => {
      const status = reviewStatus({ lastVerifiedCommit: undefined });
      mocks.getReviewStatusSync.mockReturnValue(status);
      mocks.setReviewStatusSync.mockReturnValue(status);

      const input: VerdictInput = {
        verdict: 'blocked',
        writer: 'fallback',
        evidenceHead: 'b'.repeat(40),
      };

      const result = await recordReviewVerdict('PAN-3512', input);

      expect(result).toEqual({ landed: true, classification: 'no-evidence' });
      expect(mocks.setReviewStatusSync).toHaveBeenCalledOnce();
    });

    it('Given a fallback blocked verdict with evidence and no verified row head, the door preserves its reviewed anchor through extra fields', async () => {
      const evidenceHead = 'b'.repeat(40);
      const status = reviewStatus({ lastVerifiedCommit: undefined });
      mocks.getReviewStatusSync.mockReturnValue(status);
      mocks.setReviewStatusSync.mockReturnValue(status);

      await recordReviewVerdict('PAN-3512', {
        verdict: 'blocked',
        writer: 'fallback',
        evidenceHead,
        extra: { reviewedAtCommit: evidenceHead },
      });

      expect(mocks.setReviewStatusSync).toHaveBeenCalledWith('PAN-3512', expect.objectContaining({
        reviewStatus: 'blocked',
        reviewedAtCommit: evidenceHead,
      }), status);
    });
  });

  describe('anchor-match path', () => {
    it('When evidenceHead equals lastVerifiedCommit, the door lands the verdict and returns { landed: true, classification: "anchor-match" }', async () => {
      const commitSha = 'c'.repeat(40);
      const status = reviewStatus({ lastVerifiedCommit: commitSha });
      mocks.getReviewStatusSync.mockReturnValue(status);
      mocks.setReviewStatusSync.mockReturnValue(status);

      const input: VerdictInput = {
        verdict: 'passed',
        writer: 'quick-signal',
        evidenceHead: commitSha,
      };

      const result = await recordReviewVerdict('PAN-3512', input);

      expect(result).toEqual({ landed: true, classification: 'anchor-match' });
      expect(mocks.setReviewStatusSync).toHaveBeenCalledOnce();
      expect(mocks.setReviewStatusSync).toHaveBeenCalledWith('PAN-3512', expect.objectContaining({
        reviewStatus: 'passed',
        reviewedAtCommit: commitSha,
      }), status);
    });
  });

  describe('stale evidence path', () => {
    it('Given an evidenceHead that a per-repo `git merge-base --is-ancestor` probe proves is a strict ancestor of the row\'s lastVerifiedCommit, recordReviewVerdict returns { landed: false, reason: "stale-evidence-head" }, makes zero setReviewStatusSync calls, and appends one review.verdict_rejected event', async () => {
      const status = reviewStatus({
        lastVerifiedCommit: 'b'.repeat(40),
      });
      mocks.getReviewStatusSync.mockReturnValue(status);
      mocks.resolveWorkspaceRepoRootsSync.mockReturnValue([
        { repoKey: 'main', dir: '/path/to/repo' },
      ]);

      // Mock git merge-base --is-ancestor to return 0 (ancestor)
      mockAncestorProbe(true);

      const eventStore = { append: vi.fn() };
      mocks.getCloisterEventStore.mockReturnValue(eventStore);

      const input: VerdictInput = {
        verdict: 'passed',
        writer: 'fallback',
        evidenceHead: 'a'.repeat(40),
      };

      const result = await recordReviewVerdict('PAN-3512', input);

      expect(result).toEqual({ landed: false, reason: 'stale-evidence-head' });
      expect(mocks.setReviewStatusSync).not.toHaveBeenCalled();
      expect(eventStore.append).toHaveBeenCalledOnce();
      expect(eventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'review.verdict_rejected',
          payload: expect.objectContaining({
            issueId: 'PAN-3512',
            writer: 'fallback',
            verdict: 'passed',
            reason: 'stale-evidence-head',
          }),
        }),
      );
    });
  });

  describe('fresh evidence path', () => {
    it('Given an evidenceHead the probe shows is NOT an ancestor of the row head, recordReviewVerdict lands the verdict with reviewedAtCommit set to that evidenceHead, appends one review.verdict_dispatched event, and returns { landed: true, classification: "dispatched" }', async () => {
      const rowHead = 'b'.repeat(40);
      const evidenceHead = 'c'.repeat(40);
      const status = reviewStatus({ lastVerifiedCommit: rowHead, testStatus: 'pending' });
      mocks.getReviewStatusSync.mockReturnValue(status);
      mocks.setReviewStatusSync.mockReturnValue(status);
      mocks.resolveWorkspaceRepoRootsSync.mockReturnValue([
        { repoKey: 'main', dir: '/path/to/repo' },
      ]);

      // Mock git merge-base --is-ancestor to return non-zero (not ancestor)
      mockAncestorProbe(false);

      const eventStore = { append: vi.fn() };
      mocks.getCloisterEventStore.mockReturnValue(eventStore);

      const input: VerdictInput = {
        verdict: 'passed',
        writer: 'dispatch-converge',
        evidenceHead,
      };

      const result = await recordReviewVerdict('PAN-3512', input);

      expect(result).toEqual({ landed: true, classification: 'dispatched' });
      expect(mocks.setReviewStatusSync).toHaveBeenCalledOnce();
      expect(mocks.setReviewStatusSync).toHaveBeenCalledWith(
        'PAN-3512',
        expect.objectContaining({
          reviewStatus: 'passed',
          reviewedAtCommit: evidenceHead,
        }),
        status,
      );
      expect(eventStore.append).toHaveBeenCalledOnce();
      expect(eventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'review.verdict_dispatched',
          payload: expect.objectContaining({
            issueId: 'PAN-3512',
            writer: 'dispatch-converge',
            verdict: 'passed',
            classification: 'fresh',
            testGateReset: false,
          }),
        }),
      );
    });
  });

  describe('test-gate reset', () => {
    it('Given a row with testStatus "passed" and a fresh evidence head, the update passed to setReviewStatusSync carries testStatus "pending" and a testNotes string naming both shortened head anchors and the writer', async () => {
      const rowHead = 'b'.repeat(40);
      const evidenceHead = 'c'.repeat(40);
      const status = reviewStatus({ lastVerifiedCommit: rowHead, testStatus: 'passed' });
      mocks.getReviewStatusSync.mockReturnValue(status);
      mocks.setReviewStatusSync.mockReturnValue(status);
      mocks.resolveWorkspaceRepoRootsSync.mockReturnValue([
        { repoKey: 'main', dir: '/path/to/repo' },
      ]);
      mockAncestorProbe(false);

      const eventStore = { append: vi.fn() };
      mocks.getCloisterEventStore.mockReturnValue(eventStore);

      const input: VerdictInput = {
        verdict: 'passed',
        writer: 'unsignaled-recovery',
        evidenceHead,
      };

      await recordReviewVerdict('PAN-3512', input);

      expect(mocks.setReviewStatusSync).toHaveBeenCalledWith(
        'PAN-3512',
        expect.objectContaining({
          testStatus: 'pending',
          testNotes: expect.stringContaining('Verdict re-gated'),
        }),
        status,
      );
    });

    it('Given an orphan restore whose extra carries a historical passed test result at a different evidence head, the persisted testStatus stays "pending"', async () => {
      // The orphan-restore adapter forwards the restored snapshot's historical
      // testStatus/testNotes as `extra`. If those landed after the door's
      // re-gate, a newer reviewed head would look verified with no new test run
      // and the merge gate could admit it.
      const rowHead = 'b'.repeat(40);
      const evidenceHead = 'c'.repeat(40);
      const status = reviewStatus({ lastVerifiedCommit: rowHead, testStatus: 'passed' });
      mocks.getReviewStatusSync.mockReturnValue(status);
      mocks.setReviewStatusSync.mockReturnValue(status);
      mocks.resolveWorkspaceRepoRootsSync.mockReturnValue([
        { repoKey: 'main', dir: '/path/to/repo' },
      ]);
      mockAncestorProbe(false);

      const input: VerdictInput = {
        verdict: 'passed',
        writer: 'orphan-restore',
        evidenceHead,
        extra: { testStatus: 'passed', testNotes: 'tests green on the restored snapshot' },
      };

      await recordReviewVerdict('PAN-3512', input);

      const update = mocks.setReviewStatusSync.mock.calls[0]![1];
      expect(update.testStatus).toBe('pending');
      expect(update.testNotes).toContain('Verdict re-gated');
    });

    it.each(['passed', 'skipped'] as const)(
      'Given a row already at testStatus "pending" and an extra carrying a historical "%s" test result at a different evidence head, the persisted testStatus stays "pending"',
      async (historicalTestStatus) => {
        // The re-gate must key off what the write would PERSIST, not just what is
        // already on the row: a 'pending' row makes the row-only check false, so
        // the forwarded historical result would otherwise land against fresh
        // evidence and advance with no new test run.
        const rowHead = 'b'.repeat(40);
        const evidenceHead = 'c'.repeat(40);
        const status = reviewStatus({ lastVerifiedCommit: rowHead, testStatus: 'pending' });
        mocks.getReviewStatusSync.mockReturnValue(status);
        mocks.setReviewStatusSync.mockReturnValue(status);
        mocks.resolveWorkspaceRepoRootsSync.mockReturnValue([
          { repoKey: 'main', dir: '/path/to/repo' },
        ]);
        mockAncestorProbe(false);

        const input: VerdictInput = {
          verdict: 'passed',
          writer: 'orphan-restore',
          evidenceHead,
          extra: { testStatus: historicalTestStatus, testNotes: 'historical result from the restored snapshot' },
        };

        await recordReviewVerdict('PAN-3512', input);

        const update = mocks.setReviewStatusSync.mock.calls[0]![1];
        expect(update.testStatus).toBe('pending');
        expect(update.testNotes).toContain('Verdict re-gated');
      },
    );

    it('Given a row whose testStatus is already "pending", the update passed to setReviewStatusSync contains no testStatus key', async () => {
      const rowHead = 'b'.repeat(40);
      const evidenceHead = 'c'.repeat(40);
      const status = reviewStatus({ lastVerifiedCommit: rowHead, testStatus: 'pending' });
      mocks.getReviewStatusSync.mockReturnValue(status);
      mocks.setReviewStatusSync.mockReturnValue(status);
      mocks.resolveWorkspaceRepoRootsSync.mockReturnValue([
        { repoKey: 'main', dir: '/path/to/repo' },
      ]);
      mockAncestorProbe(false);

      const eventStore = { append: vi.fn() };
      mocks.getCloisterEventStore.mockReturnValue(eventStore);

      const input: VerdictInput = {
        verdict: 'passed',
        writer: 'coordinator',
        evidenceHead,
      };

      await recordReviewVerdict('PAN-3512', input);

      expect(mocks.setReviewStatusSync).toHaveBeenCalledWith(
        'PAN-3512',
        expect.not.objectContaining({
          testStatus: expect.anything(),
        }),
        status,
      );
    });

    it('Given a passed test verdict at the same evidence head, the update preserves its notes and the event reports testGateReset false', async () => {
      const rowHead = 'b'.repeat(40);
      const status = reviewStatus({
        lastVerifiedCommit: rowHead,
        testStatus: 'passed',
        testNotes: 'CI passed at current head',
      });
      mocks.getReviewStatusSync.mockReturnValue(status);
      mocks.setReviewStatusSync.mockReturnValue(status);

      const eventStore = { append: vi.fn() };
      mocks.getCloisterEventStore.mockReturnValue(eventStore);

      const input: VerdictInput = {
        verdict: 'passed',
        writer: 'coordinator',
        evidenceHead: rowHead,
      };

      await recordReviewVerdict('PAN-3512', input);

      expect(mocks.setReviewStatusSync).toHaveBeenCalledWith(
        'PAN-3512',
        expect.not.objectContaining({
          testStatus: expect.anything(),
          testNotes: expect.anything(),
        }),
        status,
      );
      expect(eventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'review.verdict_dispatched',
          payload: expect.objectContaining({
            classification: 'anchor-match',
            testGateReset: false,
          }),
        }),
      );
    });
  });

  describe('indeterminate classification', () => {
    it('Given a bare-SHA evidenceHead against a composite "repoKey@sha" row anchor, the classifier produces "indeterminate" and the verdict still lands — it is never rejected as stale', async () => {
      const status = reviewStatus({
        lastVerifiedCommit: 'main@' + 'b'.repeat(40) + ' other@' + 'd'.repeat(40),
      });
      mocks.getReviewStatusSync.mockReturnValue(status);
      mocks.setReviewStatusSync.mockReturnValue(status);
      mocks.resolveWorkspaceRepoRootsSync.mockReturnValue([
        { repoKey: 'main', dir: '/path/to/repo' },
      ]);

      const eventStore = { append: vi.fn() };
      mocks.getCloisterEventStore.mockReturnValue(eventStore);

      const input: VerdictInput = {
        verdict: 'passed',
        writer: 'unsignaled-recovery',
        evidenceHead: 'c'.repeat(40),
      };

      const result = await recordReviewVerdict('PAN-3512', input);

      expect(result).toEqual({ landed: true, classification: 'dispatched' });
      expect(mocks.setReviewStatusSync).toHaveBeenCalledOnce();
      expect(eventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            classification: 'indeterminate',
          }),
        }),
      );
    });
  });
});
