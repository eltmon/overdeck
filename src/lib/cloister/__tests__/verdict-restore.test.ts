import { describe, expect, it, vi } from 'vitest';

import {
  convergeRowFromVerdictOfRecord,
  observeActiveReviewArtifact,
  restoreWouldTripHeadGuard,
  type VerdictOfRecordConvergenceDeps,
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

describe('convergeRowFromVerdictOfRecord', () => {
  function convergenceDeps(overrides: Partial<VerdictOfRecordConvergenceDeps> = {}) {
    return {
      readArtifact: vi.fn(async () => artifact),
      snapshotWorkspaceHeads: vi.fn(async () => artifact.headSha),
      recordVerdict: vi.fn(async () => ({ landed: true as const, classification: 'anchor-match' as const })),
      ...overrides,
    };
  }

  it('records a fresh active-run artifact at the workspace head through the verdict write door', async () => {
    const convergenceDepsForTest = convergenceDeps();

    const result = await convergeRowFromVerdictOfRecord('PAN-1', {
      runId: artifact.runId,
      workspacePath: '/workspace',
      writer: 'dispatch-converge',
      deps: convergenceDepsForTest,
    });

    expect(result).toMatchObject({ converged: true, artifact });
    expect(convergenceDepsForTest.recordVerdict).toHaveBeenCalledWith('PAN-1', {
      verdict: 'passed',
      notes: 'all checks passed',
      evidenceHead: artifact.headSha,
      runId: artifact.runId,
      writer: 'dispatch-converge',
    });
  });

  it('does not converge an artifact older than the freshness bound', async () => {
    const convergenceDepsForTest = convergenceDeps({
      readArtifact: vi.fn(async () => ({
        ...artifact,
        mtimeMs: Date.now() - (31 * 60_000),
      })),
    });

    await expect(convergeRowFromVerdictOfRecord('PAN-1', {
      runId: artifact.runId,
      workspacePath: '/workspace',
      writer: 'dispatch-converge',
      deps: convergenceDepsForTest,
    })).resolves.toEqual({ converged: false });
    expect(convergenceDepsForTest.snapshotWorkspaceHeads).not.toHaveBeenCalled();
    expect(convergenceDepsForTest.recordVerdict).not.toHaveBeenCalled();
  });

  it('does not converge an artifact whose head differs from the workspace head', async () => {
    const convergenceDepsForTest = convergenceDeps({
      snapshotWorkspaceHeads: vi.fn(async () => 'b'.repeat(40)),
    });

    await expect(convergeRowFromVerdictOfRecord('PAN-1', {
      runId: artifact.runId,
      workspacePath: '/workspace',
      writer: 'dispatch-converge',
      deps: convergenceDepsForTest,
    })).resolves.toEqual({ converged: false });
    expect(convergenceDepsForTest.recordVerdict).not.toHaveBeenCalled();
  });

  it('does not converge when the write door rejects stale evidence', async () => {
    const convergenceDepsForTest = convergenceDeps({
      recordVerdict: vi.fn(async () => ({ landed: false as const, reason: 'stale-evidence-head' })),
    });

    await expect(convergeRowFromVerdictOfRecord('PAN-1', {
      runId: artifact.runId,
      workspacePath: '/workspace',
      writer: 'dispatch-converge',
      deps: convergenceDepsForTest,
    })).resolves.toEqual({ converged: false });
  });
});

describe('restoreWouldTripHeadGuard', () => {
  it('only refuses when both anchors are present and differ', () => {
    expect(restoreWouldTripHeadGuard({ artifactHead: 'a', rowHead: 'b' })).toBe(true);
    expect(restoreWouldTripHeadGuard({ artifactHead: 'a', rowHead: 'a' })).toBe(false);
    expect(restoreWouldTripHeadGuard({ artifactHead: 'a' })).toBe(false);
  });
});
