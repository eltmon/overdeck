/**
 * PAN-2989: proactive drain of the workspace verdict fallback. Before this,
 * nothing ever folded `pipeline-verdict.json` back into the canonical record —
 * the journal could lag the truth for ~an hour. The drain folds a pending
 * fallback into the record (newer-wins on ISO updatedAt) and deletes the file,
 * triggered after every landed journal write and on scheduled retries after a
 * fallback write.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const state = vi.hoisted(() => ({
  projectPath: '',
  pipeline: null as Record<string, unknown> | null,
}));

const mockUpdateIssueRecordForIssue = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: (issueId: string) =>
    issueId.startsWith('PAN-')
      ? { projectKey: 'overdeck', projectName: 'overdeck', projectPath: state.projectPath }
      : null,
  getProjectSync: () => ({ key: 'overdeck', path: state.projectPath }),
}));

vi.mock('../../../../src/lib/pan-dir/record.js', () => ({
  readIssueRecordSync: () => (state.pipeline ? { pipeline: state.pipeline } : null),
}));

vi.mock('../../../../src/lib/pan-dir/records.js', () => ({
  updateIssueRecordForIssue: mockUpdateIssueRecordForIssue,
}));

import {
  drainWorkspaceVerdictFallback,
  flushReviewStatusJournalWrites,
  readJournalStatusSync,
  updateIssueRecordForReviewStatusSync,
  workspaceVerdictFallbackPath,
} from '../../../../src/lib/overdeck/review-status-record-sync.js';
import type { ReviewStatus } from '../../../../src/lib/review-status.js';

const ISSUE = 'PAN-9999';

function fallbackPathOrThrow(): string {
  const p = workspaceVerdictFallbackPath(ISSUE);
  if (!p) throw new Error('expected a fallback path');
  return p;
}

function writeFallback(
  updatedAt: string,
  pipeline: Record<string, unknown>,
  clearedFields?: string[],
): void {
  const p = fallbackPathOrThrow();
  mkdirSync(join(state.projectPath, 'workspaces', 'feature-pan-9999', '.overdeck'), { recursive: true });
  writeFileSync(p, JSON.stringify({ issueId: ISSUE, updatedAt, pipeline, clearedFields }));
}

function verdict(updatedAt: string): ReviewStatus {
  return {
    issueId: ISSUE,
    reviewStatus: 'passed',
    testStatus: 'passed',
    readyForMerge: false,
    updatedAt,
  } as ReviewStatus;
}

describe('workspace verdict fallback drain (PAN-2989)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.projectPath = mkdtempSync(join(tmpdir(), 'pan-2989-drain-'));
    state.pipeline = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(state.projectPath, { recursive: true, force: true });
  });

  it('deletes the fallback without a record write when the journal is newer and already carries the verdict', async () => {
    state.pipeline = { reviewStatus: 'passed', testStatus: 'passed', updatedAt: '2026-07-22T10:00:00.000Z' };
    writeFallback('2026-07-22T09:00:00.000Z', { reviewStatus: 'passed' });

    await expect(drainWorkspaceVerdictFallback(ISSUE)).resolves.toBe(true);

    expect(mockUpdateIssueRecordForIssue).not.toHaveBeenCalled();
    expect(existsSync(fallbackPathOrThrow())).toBe(false);
  });

  it('folds the verdict when the journal is newer but verdict-free (PAN-3092 / MIN-902)', async () => {
    // The contended reviewer's `passed` went to the fallback; a bookkeeping
    // write landed a minute later with a newer timestamp and no verdict. The
    // timestamp-only supersede check used to delete the only surviving copy.
    state.pipeline = { reviewStatus: 'reviewing', testStatus: 'pending', updatedAt: '2026-07-22T10:00:00.000Z' };
    writeFallback('2026-07-22T09:00:00.000Z', { reviewStatus: 'passed', reviewNotes: 'APPROVED' });
    mockUpdateIssueRecordForIssue.mockResolvedValue(true);

    await expect(drainWorkspaceVerdictFallback(ISSUE)).resolves.toBe(true);

    expect(mockUpdateIssueRecordForIssue).toHaveBeenCalledTimes(1);
    const [, status] = mockUpdateIssueRecordForIssue.mock.calls[0] as [string, ReviewStatus];
    expect(status.reviewStatus).toBe('passed');
    expect(status.reviewNotes).toBe('APPROVED');
    expect(existsSync(fallbackPathOrThrow())).toBe(false);
  });

  it('deletes the fallback without a record write when the journal moved to a newer review cycle', async () => {
    state.pipeline = {
      reviewStatus: 'reviewing',
      testStatus: 'pending',
      reviewSpawnedAt: '2026-07-22T11:00:00.000Z',
      updatedAt: '2026-07-22T11:00:01.000Z',
    };
    writeFallback('2026-07-22T09:00:00.000Z', { reviewStatus: 'passed', reviewNotes: 'APPROVED (previous cycle)' });

    await expect(drainWorkspaceVerdictFallback(ISSUE)).resolves.toBe(true);

    expect(mockUpdateIssueRecordForIssue).not.toHaveBeenCalled();
    expect(existsSync(fallbackPathOrThrow())).toBe(false);
  });

  it('folds a newer fallback into the record and deletes the file', async () => {
    state.pipeline = { reviewStatus: 'reviewing', testStatus: 'pending', updatedAt: '2026-07-22T09:00:00.000Z' };
    writeFallback('2026-07-22T10:00:00.000Z', { reviewStatus: 'blocked', reviewNotes: 'changes requested' });
    mockUpdateIssueRecordForIssue.mockResolvedValue(true);

    await expect(drainWorkspaceVerdictFallback(ISSUE)).resolves.toBe(true);

    expect(mockUpdateIssueRecordForIssue).toHaveBeenCalledTimes(1);
    const [issueId, status] = mockUpdateIssueRecordForIssue.mock.calls[0] as [string, ReviewStatus];
    expect(issueId).toBe(ISSUE);
    expect(status.reviewStatus).toBe('blocked');
    expect(status.reviewNotes).toBe('changes requested');
    expect(status.updatedAt).toBe('2026-07-22T10:00:00.000Z');
    expect(existsSync(fallbackPathOrThrow())).toBe(false);

    // With the fallback gone, reads return the record's data — no overlay.
    const result = readJournalStatusSync(ISSUE);
    expect(result?.durable.reviewStatus).toBe('reviewing');
  });

  it('does not resurrect cleared strike fields in the drained status', async () => {
    state.pipeline = {
      reviewStatus: 'reviewing',
      testStatus: 'pending',
      strikeTransportRetryCount: 4,
      strikeNextAttemptAt: '2026-07-22T12:30:00.000Z',
      updatedAt: '2026-07-22T09:00:00.000Z',
    };
    writeFallback(
      '2026-07-22T10:00:00.000Z',
      { reviewStatus: 'passed' },
      ['strikeTransportRetryCount', 'strikeNextAttemptAt'],
    );
    mockUpdateIssueRecordForIssue.mockResolvedValue(true);

    await expect(drainWorkspaceVerdictFallback(ISSUE)).resolves.toBe(true);

    const [, status] = mockUpdateIssueRecordForIssue.mock.calls[0] as [string, ReviewStatus];
    expect(status.strikeTransportRetryCount).toBeUndefined();
    expect(status.strikeNextAttemptAt).toBeUndefined();
  });

  it('removes reviewRequestedAt from the record when the drained fallback clears it', async () => {
    state.pipeline = {
      reviewStatus: 'reviewing',
      testStatus: 'pending',
      reviewRequestedAt: '2026-07-22T09:00:00.000Z',
      updatedAt: '2026-07-22T09:00:00.000Z',
    };
    writeFallback(
      '2026-07-22T10:00:00.000Z',
      { reviewStatus: 'passed', testStatus: 'pending' },
      ['reviewRequestedAt'],
    );
    mockUpdateIssueRecordForIssue.mockImplementation(async (_issueId, status: ReviewStatus) => {
      state.pipeline = JSON.parse(JSON.stringify(status));
      return true;
    });

    await expect(drainWorkspaceVerdictFallback(ISSUE)).resolves.toBe(true);

    expect(state.pipeline).not.toHaveProperty('reviewRequestedAt');
    const [, status] = mockUpdateIssueRecordForIssue.mock.calls[0] as [string, ReviewStatus];
    expect(status.reviewRequestedAt).toBeUndefined();
  });

  it('preserves reviewRequestedAt when the drained fallback still carries it', async () => {
    state.pipeline = {
      reviewStatus: 'reviewing',
      testStatus: 'pending',
      reviewRequestedAt: '2026-07-22T09:00:00.000Z',
      updatedAt: '2026-07-22T09:00:00.000Z',
    };
    writeFallback('2026-07-22T10:00:00.000Z', {
      reviewStatus: 'failed',
      testStatus: 'pending',
      reviewRequestedAt: '2026-07-22T10:30:00.000Z',
    });
    mockUpdateIssueRecordForIssue.mockImplementation(async (_issueId, status: ReviewStatus) => {
      state.pipeline = JSON.parse(JSON.stringify(status));
      return true;
    });

    await expect(drainWorkspaceVerdictFallback(ISSUE)).resolves.toBe(true);

    expect(state.pipeline?.reviewRequestedAt).toBe('2026-07-22T10:30:00.000Z');
    const [, status] = mockUpdateIssueRecordForIssue.mock.calls[0] as [string, ReviewStatus];
    expect(status.reviewRequestedAt).toBe('2026-07-22T10:30:00.000Z');
  });

  it('keeps the fallback when the record write does not land', async () => {
    writeFallback('2026-07-22T10:00:00.000Z', { reviewStatus: 'blocked' });
    mockUpdateIssueRecordForIssue.mockResolvedValue(false);

    await expect(drainWorkspaceVerdictFallback(ISSUE)).resolves.toBe(false);
    expect(existsSync(fallbackPathOrThrow())).toBe(true);
  });

  it('never deletes a newer fallback written while the drain awaits the record write', async () => {
    state.pipeline = { reviewStatus: 'reviewing', testStatus: 'pending', updatedAt: '2026-07-22T09:00:00.000Z' };
    writeFallback('2026-07-22T10:00:00.000Z', { reviewStatus: 'blocked', reviewNotes: 'generation A' });

    // Drain A claims generation A and suspends inside the record write.
    let resolveFold!: (landed: boolean) => void;
    mockUpdateIssueRecordForIssue.mockImplementation(
      () => new Promise<boolean>((resolve) => { resolveFold = resolve; }),
    );
    const drainA = drainWorkspaceVerdictFallback(ISSUE);

    // A concurrent failed verdict write replaces the live path with generation B.
    writeFallback('2026-07-22T11:00:00.000Z', { reviewStatus: 'passed', reviewNotes: 'generation B' });

    resolveFold(true);
    await expect(drainA).resolves.toBe(true);

    // Generation B survives at the live path — drain A deleted only its claim.
    const live = JSON.parse(readFileSync(fallbackPathOrThrow(), 'utf8')) as { updatedAt: string };
    expect(live.updatedAt).toBe('2026-07-22T11:00:00.000Z');

    // And generation B is folded into the record on the next drain.
    mockUpdateIssueRecordForIssue.mockResolvedValue(true);
    await expect(drainWorkspaceVerdictFallback(ISSUE)).resolves.toBe(true);
    const [, status] = mockUpdateIssueRecordForIssue.mock.calls[1] as [string, ReviewStatus];
    expect(status.reviewNotes).toBe('generation B');
    expect(existsSync(fallbackPathOrThrow())).toBe(false);
  });

  it('drops the older claim when the fold fails and a newer generation arrived meanwhile', async () => {
    writeFallback('2026-07-22T10:00:00.000Z', { reviewStatus: 'blocked', reviewNotes: 'generation A' });

    let resolveFold!: (landed: boolean) => void;
    mockUpdateIssueRecordForIssue.mockImplementation(
      () => new Promise<boolean>((resolve) => { resolveFold = resolve; }),
    );
    const drainA = drainWorkspaceVerdictFallback(ISSUE);

    writeFallback('2026-07-22T11:00:00.000Z', { reviewStatus: 'passed', reviewNotes: 'generation B' });
    resolveFold(false);
    await expect(drainA).resolves.toBe(false);

    // The failed drain does not restore its older generation over the newer one.
    const live = JSON.parse(readFileSync(fallbackPathOrThrow(), 'utf8')) as { updatedAt: string };
    expect(live.updatedAt).toBe('2026-07-22T11:00:00.000Z');
  });

  it('keeps a failed fold winner that is newer than a live generation written during the await', async () => {
    writeFallback('2026-07-22T10:00:00.000Z', { reviewStatus: 'blocked', reviewNotes: 'generation A' });

    let resolveFold!: (landed: boolean) => void;
    mockUpdateIssueRecordForIssue.mockImplementation(
      () => new Promise<boolean>((resolve) => { resolveFold = resolve; }),
    );
    const drainA = drainWorkspaceVerdictFallback(ISSUE);

    // A concurrent writer replaces the live path with an OLDER verdict while
    // the drain is suspended. The failed fold must not discard its newer
    // winner just because the no-replace publish found a live file.
    writeFallback('2026-07-22T09:00:00.000Z', { reviewStatus: 'passed', reviewNotes: 'older generation B' });
    resolveFold(false);
    await expect(drainA).resolves.toBe(false);

    // The newer claimed generation survives and still wins the read overlay.
    const read = readJournalStatusSync(ISSUE);
    expect(read?.updatedAt).toBe('2026-07-22T10:00:00.000Z');
    expect(read?.durable.reviewNotes).toBe('generation A');

    // And the next drain folds the newer generation, cleaning up both files.
    mockUpdateIssueRecordForIssue.mockResolvedValue(true);
    await expect(drainWorkspaceVerdictFallback(ISSUE)).resolves.toBe(true);
    const [, status] = mockUpdateIssueRecordForIssue.mock.calls[1] as [string, ReviewStatus];
    expect(status.reviewNotes).toBe('generation A');
    expect(existsSync(fallbackPathOrThrow())).toBe(false);
    const remaining = readdirSync(join(state.projectPath, 'workspaces', 'feature-pan-9999', '.overdeck'))
      .filter((entry) => entry.startsWith('pipeline-verdict.json'));
    expect(remaining).toEqual([]);
  });

  it('keeps the claimed verdict visible to status reads while the drain awaits the record write', async () => {
    state.pipeline = { reviewStatus: 'reviewing', testStatus: 'pending', updatedAt: '2026-07-22T09:00:00.000Z' };
    writeFallback('2026-07-22T10:00:00.000Z', { reviewStatus: 'blocked', reviewNotes: 'changes requested' });

    // The drain claims the fallback and suspends inside the record write.
    let resolveFold!: (landed: boolean) => void;
    mockUpdateIssueRecordForIssue.mockImplementation(
      () => new Promise<boolean>((resolve) => { resolveFold = resolve; }),
    );
    const drain = drainWorkspaceVerdictFallback(ISSUE);

    // The claim owns the only copy (the live path is renamed aside), yet the
    // read overlay must still surface it over the older journal.
    expect(existsSync(fallbackPathOrThrow())).toBe(false);
    const read = readJournalStatusSync(ISSUE);
    expect(read?.updatedAt).toBe('2026-07-22T10:00:00.000Z');
    expect(read?.durable.reviewStatus).toBe('blocked');
    expect(read?.durable.reviewNotes).toBe('changes requested');

    resolveFold(true);
    await expect(drain).resolves.toBe(true);
  });

  it('never recovers a dead process claim over a newer live fallback', async () => {
    // Process A claimed generation A and crashed; process B then wrote the
    // newer generation B to the live path.
    writeFallback('2026-07-22T11:00:00.000Z', { reviewStatus: 'passed', reviewNotes: 'generation B' });
    const live = fallbackPathOrThrow();
    writeFileSync(`${live}.drain-2147483647-1`, JSON.stringify({
      issueId: ISSUE,
      updatedAt: '2026-07-22T10:00:00.000Z',
      pipeline: { reviewStatus: 'blocked', reviewNotes: 'stale generation A' },
    }));
    mockUpdateIssueRecordForIssue.mockResolvedValue(true);

    await expect(drainWorkspaceVerdictFallback(ISSUE)).resolves.toBe(true);

    // The newer live verdict is the one folded — the stale claim is discarded,
    // not renamed over the live path.
    const [, status] = mockUpdateIssueRecordForIssue.mock.calls[0] as [string, ReviewStatus];
    expect(status.reviewStatus).toBe('passed');
    expect(status.reviewNotes).toBe('generation B');
    expect(existsSync(`${live}.drain-2147483647-1`)).toBe(false);
  });

  it('recovers a stranded claim that is newer than the live fallback', async () => {
    writeFallback('2026-07-22T10:00:00.000Z', { reviewStatus: 'blocked', reviewNotes: 'stale live' });
    const live = fallbackPathOrThrow();
    writeFileSync(`${live}.drain-2147483647-1`, JSON.stringify({
      issueId: ISSUE,
      updatedAt: '2026-07-22T11:00:00.000Z',
      pipeline: { reviewStatus: 'passed', reviewNotes: 'newer stranded claim' },
    }));
    mockUpdateIssueRecordForIssue.mockResolvedValue(true);

    await expect(drainWorkspaceVerdictFallback(ISSUE)).resolves.toBe(true);

    const [, status] = mockUpdateIssueRecordForIssue.mock.calls[0] as [string, ReviewStatus];
    expect(status.reviewStatus).toBe('passed');
    expect(status.reviewNotes).toBe('newer stranded claim');
  });

  it('recovers a stranded drain claim left behind by a dead process', async () => {
    const live = fallbackPathOrThrow();
    mkdirSync(dirname(live), { recursive: true });
    writeFileSync(`${live}.drain-2147483647-1`, JSON.stringify({
      issueId: ISSUE,
      updatedAt: '2026-07-22T10:00:00.000Z',
      pipeline: { reviewStatus: 'blocked' },
    }));
    mockUpdateIssueRecordForIssue.mockResolvedValue(true);

    await expect(drainWorkspaceVerdictFallback(ISSUE)).resolves.toBe(true);

    expect(mockUpdateIssueRecordForIssue).toHaveBeenCalledTimes(1);
    expect(existsSync(`${live}.drain-2147483647-1`)).toBe(false);
  });

  it('drains a pending fallback after the next landed journal write', async () => {
    state.pipeline = { reviewStatus: 'reviewing', testStatus: 'pending', updatedAt: '2026-07-22T09:00:00.000Z' };
    writeFallback('2026-07-22T10:00:00.000Z', { reviewStatus: 'blocked' });
    mockUpdateIssueRecordForIssue.mockResolvedValue(true);

    updateIssueRecordForReviewStatusSync(ISSUE, verdict('2026-07-22T11:00:00.000Z'));
    await flushReviewStatusJournalWrites();

    // One call for the verdict itself, one for the drain.
    expect(mockUpdateIssueRecordForIssue).toHaveBeenCalledTimes(2);
    expect(existsSync(fallbackPathOrThrow())).toBe(false);
  });

  it('retries a failed journal write on the 5s/30s/120s schedule and stops after success', async () => {
    // Initial verdict write fails (fallback written); the first two drain
    // attempts fail too, the third lands.
    mockUpdateIssueRecordForIssue
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);

    updateIssueRecordForReviewStatusSync(ISSUE, verdict('2026-07-22T10:00:00.000Z'));
    await vi.advanceTimersByTimeAsync(0);
    expect(existsSync(fallbackPathOrThrow())).toBe(true);
    expect(mockUpdateIssueRecordForIssue).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockUpdateIssueRecordForIssue).toHaveBeenCalledTimes(2);
    expect(existsSync(fallbackPathOrThrow())).toBe(true);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockUpdateIssueRecordForIssue).toHaveBeenCalledTimes(3);
    expect(existsSync(fallbackPathOrThrow())).toBe(true);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(mockUpdateIssueRecordForIssue).toHaveBeenCalledTimes(4);
    expect(existsSync(fallbackPathOrThrow())).toBe(false);

    // Schedule exhausted after success — nothing further fires.
    await vi.advanceTimersByTimeAsync(600_000);
    expect(mockUpdateIssueRecordForIssue).toHaveBeenCalledTimes(4);
  });

  it('stops retrying once the schedule is exhausted', async () => {
    mockUpdateIssueRecordForIssue.mockResolvedValue(false);

    updateIssueRecordForReviewStatusSync(ISSUE, verdict('2026-07-22T10:00:00.000Z'));
    await vi.advanceTimersByTimeAsync(0);
    expect(mockUpdateIssueRecordForIssue).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mockUpdateIssueRecordForIssue).toHaveBeenCalledTimes(4);

    // A fourth advance fires nothing — the schedule is exhausted and the
    // fallback remains for the next successful journal write to drain.
    await vi.advanceTimersByTimeAsync(600_000);
    expect(mockUpdateIssueRecordForIssue).toHaveBeenCalledTimes(4);
    expect(existsSync(fallbackPathOrThrow())).toBe(true);
  });
});
