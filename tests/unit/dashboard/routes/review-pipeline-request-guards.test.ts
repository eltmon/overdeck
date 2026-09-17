/**
 * PAN-3847 W18 — re-review is refused on a dirty working tree or when HEAD
 * already equals the approved anchor; it proceeds on a clean tree with a new
 * HEAD.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  snapshotWorkspaceHeadsPromise: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const exec = mocks.exec;
  Object.assign(exec, {
    [Symbol.for('nodejs.util.promisify.custom')]: (command: string, options: unknown) =>
      Promise.resolve(mocks.exec(command, options)),
  });
  return { ...actual, exec };
});

vi.mock('../../../../src/lib/git-utils.js', () => ({
  snapshotWorkspaceHeadsPromise: mocks.snapshotWorkspaceHeadsPromise,
}));

import { reReviewGuardError, buildReviewRequestReset, buildReviewRerunReset } from '../../../../src/dashboard/server/routes/workspaces/review-pipeline.js';

const workspaceInfo = { isRemote: false } as never;
const workspacePath = '/project/workspaces/feature-pan-3847';

function approvedStatus(overrides: Record<string, unknown> = {}) {
  return {
    reviewStatus: 'passed' as const,
    reviewedAtCommit: 'a'.repeat(40),
    ...overrides,
  };
}

describe('reReviewGuardError (PAN-3847)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exec.mockReturnValue({ stdout: '', stderr: '' });
    mocks.snapshotWorkspaceHeadsPromise.mockResolvedValue('b'.repeat(40));
  });

  it('dirty tree → 409 shape with the committed-HEAD hint, snapshot never consulted', async () => {
    mocks.exec.mockReturnValue({ stdout: ' M src/foo.ts\n', stderr: '' });

    const guard = await reReviewGuardError('PAN-3847', workspacePath, workspaceInfo, approvedStatus());

    expect(guard).not.toBeNull();
    expect(guard!.error).toBe('working tree is dirty');
    expect(guard!.hint).toContain('Reviewers only see committed HEAD');
    expect(mocks.snapshotWorkspaceHeadsPromise).not.toHaveBeenCalled();
  });

  it('clean tree, HEAD equals the approved anchor and the row is not stale → 409 shape', async () => {
    mocks.snapshotWorkspaceHeadsPromise.mockResolvedValue('a'.repeat(40));

    const guard = await reReviewGuardError('PAN-3847', workspacePath, workspaceInfo, approvedStatus());

    expect(guard).not.toBeNull();
    expect(guard!.error).toBe('HEAD already approved');
    expect(guard!.hint).toContain('aaaaaaaa');
  });

  it('clean tree, new HEAD → no guard (proceeds)', async () => {
    const guard = await reReviewGuardError('PAN-3847', workspacePath, workspaceInfo, approvedStatus());

    expect(guard).toBeNull();
    expect(mocks.snapshotWorkspaceHeadsPromise).toHaveBeenCalledWith('PAN-3847', workspacePath);
  });

  it('clean tree, same HEAD but the row is stale → no guard (staleness demands re-review)', async () => {
    mocks.snapshotWorkspaceHeadsPromise.mockResolvedValue('a'.repeat(40));

    const guard = await reReviewGuardError(
      'PAN-3847',
      workspacePath,
      workspaceInfo,
      approvedStatus({ reviewStaleSince: '2026-09-17T00:00:00.000Z' }),
    );

    expect(guard).toBeNull();
  });
});

describe('review reset shapes keep the per-issue verification counter (PAN-3847 W19)', () => {
  it('neither reset shape carries verificationCycleCount', () => {
    for (const reset of [buildReviewRequestReset(), buildReviewRerunReset()]) {
      expect(reset).not.toHaveProperty('verificationCycleCount');
      expect(reset).toHaveProperty('reviewStaleSince', undefined);
      expect(reset.reviewStatus).toBe('pending');
    }
  });
});
