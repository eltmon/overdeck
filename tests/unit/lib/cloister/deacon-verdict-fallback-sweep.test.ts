/**
 * PAN-3092: the stranded-verdict-fallback sweep.
 *
 * The drain that folds `<workspace>/.overdeck/pipeline-verdict.json` back into
 * the record is scheduled on unref'd timers by the process that wrote it — and
 * `pan admin specialists done` exits in under a second, so those timers usually
 * never fire. This patrol is the external retry, plus the one-shot escalation
 * for a verdict the record lock has kept stuck for ten minutes (MIN-902).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadReviewStatuses: vi.fn(),
  readWorkspaceVerdictFallback: vi.fn(),
  drainWorkspaceVerdictFallback: vi.fn(),
  recordRecoveryFailure: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  readOwner: vi.fn(),
  findWorkspacePath: vi.fn(),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  loadReviewStatuses: mocks.loadReviewStatuses,
}));

vi.mock('../../../../src/lib/overdeck/review-status-record-sync.js', () => ({
  readWorkspaceVerdictFallback: mocks.readWorkspaceVerdictFallback,
  drainWorkspaceVerdictFallback: mocks.drainWorkspaceVerdictFallback,
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: (issueId: string) =>
    (issueId.startsWith('PAN-') ? { projectKey: 'overdeck', projectPath: '/project' } : null),
  getProjectSync: () => ({ key: 'overdeck', path: '/project', name: 'overdeck' }),
}));

vi.mock('../../../../src/lib/pan-dir/fs-lock.js', () => ({
  readOwner: mocks.readOwner,
  recordLockPath: () => '/locks/records/overdeck/PAN-9999.lock',
}));

vi.mock('../../../../src/lib/lifecycle/archive-planning.js', () => ({
  findWorkspacePath: mocks.findWorkspacePath,
}));

vi.mock('../../../../src/lib/cloister/recovery-trip.js', () => ({
  recordRecoveryFailure: mocks.recordRecoveryFailure,
}));

vi.mock('../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntrySync: mocks.emitActivityEntrySync,
}));

import {
  sweepStrandedVerdictFallbacks,
  VERDICT_CONTENTION_SURFACE_MS,
} from '../../../../src/lib/cloister/deacon-verdict-fallback-sweep.js';

const ISSUE = 'PAN-9999';
const NOW = Date.parse('2026-07-27T01:00:00.000Z');

function fallbackWrittenMsAgo(ms: number): { issueId: string; updatedAt: string; pipeline: Record<string, unknown> } {
  return {
    issueId: ISSUE,
    updatedAt: new Date(NOW - ms).toISOString(),
    pipeline: { reviewStatus: 'passed', reviewNotes: 'APPROVED' },
  };
}

describe('sweepStrandedVerdictFallbacks (PAN-3092)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadReviewStatuses.mockReturnValue({ [ISSUE]: { issueId: ISSUE, reviewStatus: 'reviewing' } });
    mocks.readWorkspaceVerdictFallback.mockResolvedValue(null);
    mocks.drainWorkspaceVerdictFallback.mockResolvedValue(true);
    mocks.readOwner.mockResolvedValue({ description: 'pan-cli pid=4242 acquiredAt=2026-07-27T00:45:00.000Z' });
    mocks.findWorkspacePath.mockReturnValue('/project/workspaces/feature-pan-9999');
    mocks.recordRecoveryFailure.mockResolvedValue({ emitNeedsYou: true, trip: { tripCount: 1 } });
  });

  it('folds a stranded fallback whose writing process is long gone', async () => {
    mocks.readWorkspaceVerdictFallback.mockResolvedValue(fallbackWrittenMsAgo(30_000));

    const actions = await sweepStrandedVerdictFallbacks(NOW);

    expect(mocks.drainWorkspaceVerdictFallback).toHaveBeenCalledWith(ISSUE);
    expect(actions).toEqual([`Drained stranded verdict fallback for ${ISSUE}`]);
    expect(mocks.recordRecoveryFailure).not.toHaveBeenCalled();
  });

  it('does nothing at all for an issue with no fallback', async () => {
    const actions = await sweepStrandedVerdictFallbacks(NOW);

    expect(mocks.drainWorkspaceVerdictFallback).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it('surfaces a verdict the lock has held past ten minutes exactly once', async () => {
    mocks.readWorkspaceVerdictFallback.mockResolvedValue(
      fallbackWrittenMsAgo(VERDICT_CONTENTION_SURFACE_MS + 60_000),
    );
    mocks.drainWorkspaceVerdictFallback.mockResolvedValue(false);
    // The trip dedups by the fallback's updatedAt: only the first sweep opens it.
    mocks.recordRecoveryFailure
      .mockResolvedValueOnce({ emitNeedsYou: true, trip: { tripCount: 1 } })
      .mockResolvedValue({ emitNeedsYou: false, trip: { tripCount: 1 } });

    const first = await sweepStrandedVerdictFallbacks(NOW);
    const second = await sweepStrandedVerdictFallbacks(NOW + 60_000);
    const third = await sweepStrandedVerdictFallbacks(NOW + 120_000);

    expect(first).toHaveLength(1);
    expect(first[0]).toContain(`needs-you ${ISSUE}`);
    expect(first[0]).toContain('11min');
    expect(first[0]).toContain('pid=4242');
    expect(second).toEqual([]);
    expect(third).toEqual([]);

    expect(mocks.emitActivityEntrySync).toHaveBeenCalledTimes(1);
    const entry = mocks.emitActivityEntrySync.mock.calls[0]![0] as Record<string, unknown>;
    expect(entry.source).toBe('cloister');
    expect(entry.level).toBe('warn');
    expect(entry.issueId).toBe(ISSUE);
    expect(String(entry.message)).toContain('record lock is contended');

    // Every sweep still retried the drain — the escalation is on top, not instead.
    expect(mocks.drainWorkspaceVerdictFallback).toHaveBeenCalledTimes(3);
    const [, , recoveryPath, generation, threshold] =
      mocks.recordRecoveryFailure.mock.calls[0] as [string, string, string, string, number];
    expect(recoveryPath).toBe('verdict-fallback-contention');
    expect(generation).toBe(fallbackWrittenMsAgo(VERDICT_CONTENTION_SURFACE_MS + 60_000).updatedAt);
    expect(threshold).toBe(1);
  });

  it('stays quiet about a fallback younger than the contention threshold', async () => {
    mocks.readWorkspaceVerdictFallback.mockResolvedValue(
      fallbackWrittenMsAgo(VERDICT_CONTENTION_SURFACE_MS - 1_000),
    );
    mocks.drainWorkspaceVerdictFallback.mockResolvedValue(false);

    const actions = await sweepStrandedVerdictFallbacks(NOW);

    expect(actions).toEqual([]);
    expect(mocks.recordRecoveryFailure).not.toHaveBeenCalled();
    expect(mocks.emitActivityEntrySync).not.toHaveBeenCalled();
  });

  it('keeps draining stuck and deacon-ignored issues without adding a second voice', async () => {
    mocks.loadReviewStatuses.mockReturnValue({
      'PAN-1111': { issueId: 'PAN-1111', stuck: true },
      'PAN-2222': { issueId: 'PAN-2222', deaconIgnored: true },
    });
    mocks.readWorkspaceVerdictFallback.mockResolvedValue(
      fallbackWrittenMsAgo(VERDICT_CONTENTION_SURFACE_MS * 3),
    );
    mocks.drainWorkspaceVerdictFallback.mockResolvedValue(false);

    const actions = await sweepStrandedVerdictFallbacks(NOW);

    expect(mocks.drainWorkspaceVerdictFallback).toHaveBeenCalledTimes(2);
    expect(actions).toEqual([]);
    expect(mocks.recordRecoveryFailure).not.toHaveBeenCalled();
    expect(mocks.emitActivityEntrySync).not.toHaveBeenCalled();
  });

  it('skips merged and closed-out issues entirely', async () => {
    mocks.loadReviewStatuses.mockReturnValue({
      'PAN-1111': { issueId: 'PAN-1111', mergeStatus: 'merged' },
      'PAN-2222': { issueId: 'PAN-2222', closedOut: true },
    });

    const actions = await sweepStrandedVerdictFallbacks(NOW);

    expect(mocks.readWorkspaceVerdictFallback).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it('lets one unreadable workspace not stop the rest of the sweep', async () => {
    mocks.loadReviewStatuses.mockReturnValue({
      'PAN-1111': { issueId: 'PAN-1111' },
      'PAN-2222': { issueId: 'PAN-2222' },
    });
    mocks.readWorkspaceVerdictFallback
      .mockRejectedValueOnce(new Error('EACCES'))
      .mockResolvedValue(fallbackWrittenMsAgo(30_000));

    const actions = await sweepStrandedVerdictFallbacks(NOW);

    expect(actions).toEqual(['Drained stranded verdict fallback for PAN-2222']);
  });
});
