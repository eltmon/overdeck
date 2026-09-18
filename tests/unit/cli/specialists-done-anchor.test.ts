/**
 * PAN-3847 W9 — `pan admin specialists done review` writes the verdict and its
 * anchor in ONE write. A blocked verdict must produce a single setReviewStatusSync
 * call carrying both reviewStatus: 'blocked' and reviewedAtCommit; the old second
 * best-effort write after feedback delivery is gone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import type { ReviewStatus } from '../../../src/lib/review-status.js';

const HEAD = 'c'.repeat(40);

const mocks = vi.hoisted(() => ({
  getReviewStatusSync: vi.fn(),
  setReviewStatusSync: vi.fn(),
  snapshotWorkspaceHeadsPromise: vi.fn(),
  rehydrateHeadAnchor: vi.fn((head: unknown) => head),
  resolveProjectFromIssueSync: vi.fn(),
  existsSync: vi.fn(),
  getCloisterEventStore: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  deliverReviewVerdictFeedback: vi.fn(),
}));

vi.mock('../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: mocks.getReviewStatusSync,
  setReviewStatusSync: mocks.setReviewStatusSync,
}));

vi.mock('../../../src/lib/git-utils.js', () => ({
  rehydrateHeadAnchor: mocks.rehydrateHeadAnchor,
  snapshotWorkspaceHeadsPromise: mocks.snapshotWorkspaceHeadsPromise,
}));

vi.mock('../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
}));

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: mocks.existsSync,
}));

vi.mock('../../../src/lib/cloister/event-store-provider.js', () => ({
  getCloisterEventStore: mocks.getCloisterEventStore,
}));

vi.mock('../../../src/lib/activity-logger.js', () => ({
  emitActivityEntrySync: mocks.emitActivityEntrySync,
}));

vi.mock('../../../src/lib/cloister/review-verdict-feedback.js', () => ({
  deliverReviewVerdictFeedback: mocks.deliverReviewVerdictFeedback,
}));

import { doneCommand } from '../../../src/cli/commands/specialists/done.js';

function row(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'PAN-3847',
    reviewStatus: 'reviewing',
    testStatus: 'pending',
    verificationStatus: 'pending',
    mergeStatus: 'pending',
    readyForMerge: false,
    workspaceDir: '/project/workspaces/feature-pan-3847',
    lastVerifiedCommit: HEAD,
    updatedAt: '2026-09-17T00:00:00.000Z',
    ...overrides,
  };
}

describe('specialists done review — verdict and anchor are one write (PAN-3847)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/project' });
    mocks.existsSync.mockReturnValue(true);
    mocks.snapshotWorkspaceHeadsPromise.mockResolvedValue(HEAD);
    mocks.getCloisterEventStore.mockReturnValue(null);
    mocks.deliverReviewVerdictFeedback.mockReturnValue(Effect.succeed({
      feedbackPath: undefined,
      synthesisPath: undefined,
      prCommentPosted: false,
    }));
  });

  it('a blocked verdict lands as one setReviewStatusSync call carrying reviewStatus blocked and reviewedAtCommit', async () => {
    const status = row();
    mocks.getReviewStatusSync.mockReturnValue(status);
    mocks.setReviewStatusSync.mockReturnValue(status);

    await doneCommand('review', 'pan-3847', { status: 'blocked', notes: 'changes requested' });

    expect(mocks.setReviewStatusSync).toHaveBeenCalledTimes(1);
    expect(mocks.setReviewStatusSync).toHaveBeenCalledWith(
      'PAN-3847',
      expect.objectContaining({
        reviewStatus: 'blocked',
        reviewedAtCommit: HEAD,
      }),
      status,
    );
  });

  it('a passed verdict lands with reviewedAtCommit equal to the snapshotted workspace head', async () => {
    const status = row();
    mocks.getReviewStatusSync.mockReturnValue(status);
    mocks.setReviewStatusSync.mockReturnValue(status);

    await doneCommand('review', 'PAN-3847', { status: 'passed', notes: 'looks good' });

    expect(mocks.setReviewStatusSync).toHaveBeenCalledTimes(1);
    expect(mocks.setReviewStatusSync).toHaveBeenCalledWith(
      'PAN-3847',
      expect.objectContaining({
        reviewStatus: 'passed',
        reviewedAtCommit: HEAD,
      }),
      status,
    );
  });
});
