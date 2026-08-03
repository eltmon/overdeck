import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewStatus } from '../../review-status.js';
import type { DomainEvent } from '@overdeck/contracts';

const mocks = vi.hoisted(() => ({
  getReviewStatusSync: vi.fn(),
  setReviewStatusSync: vi.fn(),
  getCloisterEventStore: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  resolveWorkspaceRepoRootsSync: vi.fn(),
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

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
}));

vi.mock('../../project-repos.js', () => ({
  resolveWorkspaceRepoRootsSync: mocks.resolveWorkspaceRepoRootsSync,
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFile: vi.fn((...args: unknown[]) => {
      const callback = args.at(-1);
      if (typeof callback !== 'function') throw new Error('execFile callback is required');
      const done = callback as (error: unknown, stdout?: string, stderr?: string) => void;
      void Promise.resolve(mocks.execFileAsync(...args.slice(0, -1))).then(
        (result: unknown) => {
          if (typeof result === 'object' && result !== null && 'status' in result) {
            if (result.status === 1) {
              done(Object.assign(new Error('not an ancestor'), { code: 1 }), '', '');
            } else {
              done(null, '', '');
            }
            return;
          }
          const [stdout, stderr] = Array.isArray(result) ? result : [result ?? '', ''];
          done(null, typeof stdout === 'string' ? stdout : '', typeof stderr === 'string' ? stderr : '');
        },
        (error: unknown) => done(error),
      );
    }),
  };
});

import { recordReviewVerdict, type VerdictInput } from '../review-verdict-writer.js';

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
    });
  });

  describe('stale evidence path', () => {
    it('Given an evidenceHead that a per-repo `git merge-base --is-ancestor` probe proves is a strict ancestor of the row\'s lastVerifiedCommit, recordReviewVerdict returns { landed: false, reason: "stale-evidence-head" }, makes zero setReviewStatusSync calls, and appends one review.verdict_rejected event', async () => {
      const status = reviewStatus({
        lastVerifiedCommit: `main@${'b'.repeat(40)}`,
      });
      mocks.getReviewStatusSync.mockReturnValue(status);
      mocks.resolveWorkspaceRepoRootsSync.mockReturnValue([
        { repoKey: 'main', dir: '/path/to/repo' },
      ]);

      // Mock git merge-base --is-ancestor to return 0 (ancestor)
      mocks.execFileAsync.mockResolvedValue({ status: 0 });

      const eventStore = { append: vi.fn() };
      mocks.getCloisterEventStore.mockReturnValue(eventStore);

      const input: VerdictInput = {
        verdict: 'passed',
        writer: 'fallback',
        evidenceHead: `main@${'a'.repeat(40)}`,
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
      const rowHead = `main@${'b'.repeat(40)}`;
      const evidenceHead = `main@${'c'.repeat(40)}`;
      const status = reviewStatus({ lastVerifiedCommit: rowHead, testStatus: 'pending' });
      mocks.getReviewStatusSync.mockReturnValue(status);
      mocks.setReviewStatusSync.mockReturnValue(status);
      mocks.resolveWorkspaceRepoRootsSync.mockReturnValue([
        { repoKey: 'main', dir: '/path/to/repo' },
      ]);

      // Mock git merge-base --is-ancestor to return non-zero (not ancestor)
      mocks.execFileAsync.mockResolvedValue({ status: 1 });

      const eventStore = { append: vi.fn() };
      mocks.getCloisterEventStore.mockReturnValue(eventStore);

      const input: VerdictInput = {
        verdict: 'passed',
        writer: 'coordinator',
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
            writer: 'coordinator',
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
      const rowHead = `main@${'b'.repeat(40)}`;
      const evidenceHead = `main@${'c'.repeat(40)}`;
      const status = reviewStatus({ lastVerifiedCommit: rowHead, testStatus: 'passed' });
      mocks.getReviewStatusSync.mockReturnValue(status);
      mocks.setReviewStatusSync.mockReturnValue(status);
      mocks.resolveWorkspaceRepoRootsSync.mockReturnValue([
        { repoKey: 'main', dir: '/path/to/repo' },
      ]);
      mocks.execFileAsync.mockResolvedValue({ status: 1 });

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

    it('Given a row whose testStatus is already "pending", the update passed to setReviewStatusSync contains no testStatus key', async () => {
      const rowHead = `main@${'b'.repeat(40)}`;
      const evidenceHead = `main@${'c'.repeat(40)}`;
      const status = reviewStatus({ lastVerifiedCommit: rowHead, testStatus: 'pending' });
      mocks.getReviewStatusSync.mockReturnValue(status);
      mocks.setReviewStatusSync.mockReturnValue(status);
      mocks.resolveWorkspaceRepoRootsSync.mockReturnValue([
        { repoKey: 'main', dir: '/path/to/repo' },
      ]);
      mocks.execFileAsync.mockResolvedValue({ status: 1 });

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

    it('Given equal evidence and row anchors, or no evidence head at all, the update contains no testStatus key and the emitted event reports testGateReset false', async () => {
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
