import { describe, expect, it, vi } from 'vitest';

import {
  attemptArtifactVerdictRestore,
  restoreWouldTripHeadGuard,
} from '../verdict-restore.js';

const artifact = {
  runId: 'host-recorded-run',
  verdict: 'passed' as const,
  notes: 'all checks passed',
  headSha: 'a'.repeat(40),
  mtimeMs: Date.now(),
};

function deps(overrides: Partial<Parameters<typeof attemptArtifactVerdictRestore>[1]['deps']> = {}) {
  return {
    readArtifact: vi.fn(async () => artifact),
    recordVerdict: vi.fn(async () => ({ landed: true as const, classification: 'anchor-match' as const })),
    emitEvent: vi.fn(),
    emitActivity: vi.fn(async () => ({ emitted: true })),
    ...overrides,
  };
}

describe('attemptArtifactVerdictRestore', () => {
  it('does not read an artifact without the host-recorded run identity', async () => {
    const recoveryDeps = deps();

    await expect(attemptArtifactVerdictRestore('PAN-1', { deps: recoveryDeps })).resolves.toEqual({ outcome: 'no-artifact' });
    expect(recoveryDeps.readArtifact).not.toHaveBeenCalled();
    expect(recoveryDeps.recordVerdict).not.toHaveBeenCalled();
  });

  it('preserves a mismatched artifact and emits the blocked-restore event', async () => {
    const recoveryDeps = deps();

    const result = await attemptArtifactVerdictRestore('PAN-1', {
      runId: artifact.runId,
      rowHead: 'b'.repeat(40),
      caller: 'orphan-review-recovery',
      deps: recoveryDeps,
    });

    expect(result).toMatchObject({ outcome: 'blocked-by-head-guard', artifact });
    expect(recoveryDeps.recordVerdict).not.toHaveBeenCalled();
    expect(recoveryDeps.emitEvent).toHaveBeenCalledWith('review.verdict_restore_blocked', expect.objectContaining({
      issueId: 'PAN-1',
      reason: 'artifact-head-mismatch',
    }));
  });

  it('routes a matching artifact through the canonical verdict writer', async () => {
    const recoveryDeps = deps();

    const result = await attemptArtifactVerdictRestore('PAN-1', {
      runId: artifact.runId,
      rowHead: artifact.headSha,
      clearStuckReason: 'review_infrastructure_failure',
      deps: recoveryDeps,
    });

    expect(result).toMatchObject({ outcome: 'restored', artifact });
    expect(recoveryDeps.recordVerdict).toHaveBeenCalledWith('PAN-1', expect.objectContaining({
      verdict: 'passed',
      evidenceHead: artifact.headSha,
      clearStuckReason: 'review_infrastructure_failure',
      writer: 'orphan-restore',
    }));
  });
});

describe('restoreWouldTripHeadGuard', () => {
  it('only refuses when both anchors are present and differ', () => {
    expect(restoreWouldTripHeadGuard({ artifactHead: 'a', rowHead: 'b' })).toBe(true);
    expect(restoreWouldTripHeadGuard({ artifactHead: 'a', rowHead: 'a' })).toBe(false);
    expect(restoreWouldTripHeadGuard({ artifactHead: 'a' })).toBe(false);
  });
});
