import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewStatus } from '../../review-status-reconcile.js';

const mocks = vi.hoisted(() => ({
  getReviewStatusSync: vi.fn(),
  setReviewStatusSync: vi.fn(),
  getCloisterEventStore: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  resolveWorkspaceRepoRootsSync: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  execFileAsync: vi.fn(),
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

vi.mock('child_process', () => ({
  execFileAsync: mocks.execFileAsync,
}));

import { recordReviewVerdict, type VerdictInput } from '../review-verdict-writer.js';

function reviewStatus(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'PAN-3512',
    reviewStatus: 'pending',
    testStatus: 'pending',
    verificationStatus: 'pending',
    mergeStatus: 'pending',
    readyForMerge: false,
    lastVerifiedCommit: 'a'.repeat(40),
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  } as ReviewStatus;
}

describe('recordReviewVerdict', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCloisterEventStore.mockReturnValue(null);
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/projects/overdeck' } as any);
    mocks.resolveWorkspaceRepoRootsSync.mockReturnValue([
      { repoKey: 'main', dir: '/path/to/repo' },
    ]);
  });

  describe('no-evidence path', () => {
    it('Given a VerdictInput with no evidenceHead, recordReviewVerdict calls setReviewStatusSync once', async () => {
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
    });
  });

  describe('anchor-match path', () => {
    it('When evidenceHead equals lastVerifiedCommit, the door lands and returns anchor-match', async () => {
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
    });
  });

  describe('stale evidence path', () => {
    it('Given stale evidence, recordReviewVerdict returns rejected and appends verdict_rejected event', async () => {
      const status = reviewStatus({ lastVerifiedCommit: 'b'.repeat(40) });
      mocks.getReviewStatusSync.mockReturnValue(status);
      mocks.execFileAsync.mockResolvedValue({ status: 0 });

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
    });
  });

  describe('fresh evidence path', () => {
    it('Given fresh evidence, the door lands the verdict with correct classification', async () => {
      const status = reviewStatus({ lastVerifiedCommit: 'b'.repeat(40), testStatus: 'pending' });
      mocks.getReviewStatusSync.mockReturnValue(status);
      mocks.setReviewStatusSync.mockReturnValue(status);
      mocks.execFileAsync.mockResolvedValue({ status: 1 });

      const eventStore = { append: vi.fn() };
      mocks.getCloisterEventStore.mockReturnValue(eventStore);

      const input: VerdictInput = {
        verdict: 'passed',
        writer: 'coordinator',
        evidenceHead: 'c'.repeat(40),
      };

      const result = await recordReviewVerdict('PAN-3512', input);

      expect(result).toEqual({ landed: true, classification: 'dispatched' });
      expect(mocks.setReviewStatusSync).toHaveBeenCalledOnce();
      expect(eventStore.append).toHaveBeenCalledOnce();
    });
  });
});

  describe('test-gate reset', () => {
    it('Given a row with testStatus "passed" and a fresh evidence head, the update carries testStatus "pending"', async () => {
      const status = reviewStatus({ lastVerifiedCommit: 'b'.repeat(40), testStatus: 'passed' });
      mocks.getReviewStatusSync.mockReturnValue(status);
      mocks.setReviewStatusSync.mockReturnValue(status);
      mocks.execFileAsync.mockResolvedValue({ status: 1 });

      const eventStore = { append: vi.fn() };
      mocks.getCloisterEventStore.mockReturnValue(eventStore);

      const input: VerdictInput = {
        verdict: 'passed',
        writer: 'unsignaled-recovery',
        evidenceHead: 'c'.repeat(40),
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

    it('Given a row whose testStatus is already "pending", the update contains no testStatus key', async () => {
      const status = reviewStatus({ lastVerifiedCommit: 'b'.repeat(40), testStatus: 'pending' });
      mocks.getReviewStatusSync.mockReturnValue(status);
      mocks.setReviewStatusSync.mockReturnValue(status);
      mocks.execFileAsync.mockResolvedValue({ status: 1 });

      const eventStore = { append: vi.fn() };
      mocks.getCloisterEventStore.mockReturnValue(eventStore);

      const input: VerdictInput = {
        verdict: 'passed',
        writer: 'coordinator',
        evidenceHead: 'c'.repeat(40),
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

    it('Given equal evidence and row anchors, the update contains no testStatus key and event reports testGateReset false', async () => {
      const rowHead = 'b'.repeat(40);
      const status = reviewStatus({ lastVerifiedCommit: rowHead, testStatus: 'passed' });
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
        }),
        status,
      );
      expect(eventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            testGateReset: false,
          }),
        }),
      );
    });
  });
});
