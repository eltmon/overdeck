import { describe, expect, it, vi } from 'vitest';
import {
  buildRealConflictGateDeps,
  resolveConflictGate,
} from '../conflict-gate.js';
import type { ReviewStatus } from '../../review-status.js';

function status(fields: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'PAN-3668',
    reviewStatus: 'passed',
    testStatus: 'passed',
    mergeStatus: 'pending',
    readyForMerge: false,
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...fields,
  } as ReviewStatus;
}

describe('PAN-3764 conflict gate', () => {
  it('does not dispatch conflict recovery for failed checks on a clean branch', async () => {
    const failing = status({
      blockerReasons: [{
        type: 'failing_checks',
        summary: 'Required checks are failing',
        detectedAt: '2026-08-22T00:00:00.000Z',
      }],
    });
    const dispatchResolver = vi.fn();
    const probeMergeability = vi.fn(async () => 'clean' as const);

    await expect(resolveConflictGate('PAN-3668', '/workspace', 'main', {
      getReviewStatus: vi.fn(() => failing),
      setReviewStatus: vi.fn(),
      probeMergeability,
      dispatchResolver,
    })).resolves.toEqual({ gated: false });

    expect(probeMergeability).not.toHaveBeenCalled();
    expect(dispatchResolver).not.toHaveBeenCalled();
  });

  it('uses the sanctioned main-sync command for legitimate conflict recovery', async () => {
    const spawnRun = vi.fn(async () => ({ sessionName: 'agent-pan-3668' })) as never;
    const deps = buildRealConflictGateDeps({
      spawnRun,
      getReviewStatus: vi.fn(() => status()),
      setReviewStatus: vi.fn((_, update) => status(update)),
      emitActivityEntry: vi.fn(),
    });

    await deps.dispatchResolver({
      issueId: 'PAN-3668',
      workspacePath: '/workspace',
      targetBranch: 'main',
      blockerReasons: [{
        type: 'merge_conflict',
        summary: 'Branch conflicts with main',
        detectedAt: '2026-08-22T00:00:00.000Z',
      }],
      reason: 'merge conflict with main must be resolved before review dispatch',
    });

    const prompt = vi.mocked(spawnRun).mock.calls[0]?.[2]?.prompt;
    expect(prompt).toContain('pan sync-main PAN-3668');
    expect(prompt).not.toContain('Rebase this branch');
    expect(prompt).not.toContain('git rebase');
  });
});
