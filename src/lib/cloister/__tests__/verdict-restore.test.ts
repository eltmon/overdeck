import { describe, expect, it, vi } from 'vitest';

import {
  observeActiveReviewArtifact,
  restoreWouldTripHeadGuard,
} from '../verdict-restore.js';

const artifact = {
  runId: 'host-recorded-run',
  verdict: 'passed' as const,
  notes: 'all checks passed',
  headSha: 'a'.repeat(40),
  mtimeMs: Date.now(),
};

function deps(overrides: Partial<Parameters<typeof observeActiveReviewArtifact>[1]['deps']> = {}) {
  return {
    readArtifact: vi.fn(async () => artifact),
    emitEvent: vi.fn(),
    emitActivity: vi.fn(async () => ({ emitted: true })),
    ...overrides,
  };
}

describe('observeActiveReviewArtifact', () => {
  it('does not read an artifact without the host-recorded run identity', async () => {
    const observationDeps = deps();

    await expect(observeActiveReviewArtifact('PAN-1', { deps: observationDeps })).resolves.toEqual({ outcome: 'no-artifact' });
    expect(observationDeps.readArtifact).not.toHaveBeenCalled();
  });

  it('preserves a mismatched artifact and emits the blocked-restore event without writing a verdict', async () => {
    const observationDeps = deps();

    const result = await observeActiveReviewArtifact('PAN-1', {
      runId: artifact.runId,
      rowHead: 'b'.repeat(40),
      caller: 'orphan-review-recovery',
      deps: observationDeps,
    });

    expect(result).toMatchObject({ outcome: 'blocked-by-head-guard', artifact });
    expect(observationDeps.emitEvent).toHaveBeenCalledWith('review.verdict_restore_blocked', expect.objectContaining({
      issueId: 'PAN-1',
      reason: 'artifact-head-mismatch',
    }));
  });

  it('returns matching active-run evidence as diagnostic observation only', async () => {
    const observationDeps = deps();

    const result = await observeActiveReviewArtifact('PAN-1', {
      runId: artifact.runId,
      rowHead: artifact.headSha,
      deps: observationDeps,
    });

    expect(result).toMatchObject({ outcome: 'observed', artifact });
    expect(observationDeps.emitEvent).not.toHaveBeenCalled();
  });
});

describe('restoreWouldTripHeadGuard', () => {
  it('only refuses when both anchors are present and differ', () => {
    expect(restoreWouldTripHeadGuard({ artifactHead: 'a', rowHead: 'b' })).toBe(true);
    expect(restoreWouldTripHeadGuard({ artifactHead: 'a', rowHead: 'a' })).toBe(false);
    expect(restoreWouldTripHeadGuard({ artifactHead: 'a' })).toBe(false);
  });
});
